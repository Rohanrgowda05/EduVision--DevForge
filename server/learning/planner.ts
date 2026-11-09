import { z } from "zod";
import { getLearnerProfile, type LearnerProfile } from "./mastery";

export type StudyAction = "generate_new" | "reuse_existing" | "remedial" | "advanced";
export type StudyDifficulty = "intro" | "standard" | "challenging";

export interface StudyPlan {
  action: StudyAction;
  focusConcepts: string[]; // max 3, from weak concepts, lowest mastery first
  difficulty: StudyDifficulty;
  includeYoutube: boolean;
  rationale: string; // plain-language, shown to the user
  reusedVideoUrl?: string | null;
}

export interface PlanStudyOptions {
  now?: Date;
  recentVideo?: { videoUrl: string; createdAt: Date } | null;
}

/**
 * Deterministic baseline study planner.
 *
 * Rules:
 * 1. Weak concepts exist: "remedial" action, focus on up to 3 weakest concepts.
 * 2. Same topic generated in the last 24h and nothing weak: "reuse_existing".
 * 3. All known concepts strong with enough evidence: "advanced" action, challenging difficulty.
 * 4. No history for this topic: "generate_new" action, standard difficulty, no focus.
 */
export function planStudy(
  profile: LearnerProfile,
  options: PlanStudyOptions = {}
): StudyPlan {
  const now = options.now || new Date();
  const weakConcepts = profile.concepts
    .filter((c) => c.status === "weak")
    .map((c) => c.concept);

  // Rule 1: Weak concepts exist -> remedial focus
  if (weakConcepts.length > 0) {
    const focusConcepts = weakConcepts.slice(0, 3);
    return {
      action: "remedial",
      focusConcepts,
      difficulty: "standard",
      includeYoutube: true,
      rationale: `Focusing on: ${focusConcepts.join(", ")}, because you have lower mastery on these concepts recently.`,
    };
  }

  // Rule 2: Same topic generated in the last 24h and nothing weak -> reuse existing
  if (options.recentVideo) {
    const videoAgeMs = now.getTime() - new Date(options.recentVideo.createdAt).getTime();
    const isWithin24h = videoAgeMs >= 0 && videoAgeMs <= 24 * 60 * 60 * 1000;
    if (isWithin24h) {
      return {
        action: "reuse_existing",
        focusConcepts: [],
        difficulty: "standard",
        includeYoutube: false,
        rationale: "You generated an animation for this topic in the last 24 hours. Reusing existing visualization.",
        reusedVideoUrl: options.recentVideo.videoUrl,
      };
    }
  }

  // Rule 3: All known concepts strong with enough evidence -> advanced
  const allStrong =
    profile.concepts.length > 0 &&
    profile.concepts.every((c) => c.status === "strong");

  if (allStrong) {
    return {
      action: "advanced",
      focusConcepts: [],
      difficulty: "challenging",
      includeYoutube: true,
      rationale: "You have demonstrated strong mastery across all concepts for this topic. Creating an advanced challenge visualization.",
    };
  }

  // Rule 4: No history for this topic (or mixed without weak concepts) -> generate new
  return {
    action: "generate_new",
    focusConcepts: [],
    difficulty: "standard",
    includeYoutube: false,
    rationale: profile.concepts.length === 0
      ? "First time exploring this topic. Creating standard visualization and foundational study material."
      : "Continuing topic exploration with standard visualization.",
  };
}

/**
 * Orchestrates study planning respecting the PLANNER env flag (rules | agent).
 * Defaults to "rules" (deterministic baseline).
 * If "agent" is active, queries the Google ADK Python service at Flask POST /plan,
 * seamlessly falling back to deterministic plan if agent errors or times out.
 */
export async function getStudyPlan(
  userId: string,
  topicId: string,
  prompt: string,
  options: PlanStudyOptions = {}
): Promise<StudyPlan & { fallbackUsed: boolean; agentUsed: boolean }> {
  const profile = topicId
    ? await getLearnerProfile(userId, topicId)
    : { topicId: "", concepts: [], lastActivity: null, totalAttempts: 0 };

  const baselinePlan = planStudy(profile, options);

  const plannerMode = (process.env.PLANNER || "rules").toLowerCase().trim();
  if (plannerMode !== "agent") {
    return {
      ...baselinePlan,
      fallbackUsed: false,
      agentUsed: false,
    };
  }

  const flaskUrl = process.env.FLASK_URL || "http://127.0.0.1:5000";
  const internalToken = process.env.INTERNAL_AUTH_TOKEN || "eduvision-internal-secret-token-key";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

  try {
    const res = await fetch(`${flaskUrl}/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      body: JSON.stringify({
        userId,
        promptText: prompt,
        topicHint: profile.topicName || null,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const planSchema = z.object({
        action: z.enum(["generate_new", "reuse_existing", "remedial", "advanced"]),
        focusConcepts: z.array(z.string()).default([]),
        difficulty: z.enum(["intro", "standard", "challenging"]).default("standard"),
        includeYoutube: z.boolean().default(false),
        rationale: z.string().default("Agent proposed personalized plan."),
        reusedVideoUrl: z.string().nullable().optional(),
        fallback_used: z.boolean().optional(),
      });

      const parsed = planSchema.safeParse(data);
      if (parsed.success) {
        return {
          action: parsed.data.action,
          focusConcepts: parsed.data.focusConcepts.slice(0, 3),
          difficulty: parsed.data.difficulty,
          includeYoutube: parsed.data.includeYoutube,
          rationale: parsed.data.rationale,
          reusedVideoUrl: parsed.data.reusedVideoUrl ?? null,
          fallbackUsed: parsed.data.fallback_used ?? false,
          agentUsed: true,
        };
      }
    }
  } catch (err: any) {
    console.warn("[Study Planner] Agent planner failed, using rule-based baseline:", err.message);
  } finally {
    clearTimeout(timeoutId);
  }

  // Graceful fallback to deterministic plan
  return {
    ...baselinePlan,
    fallbackUsed: true,
    agentUsed: true,
  };
}
