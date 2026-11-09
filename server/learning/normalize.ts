import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { storage } from "../storage";
import type { Topic } from "@shared/schema";

/**
 * Sanitizes untrusted topic strings to strictly enforce lowercase snake_case
 * and length limits to eliminate prompt-injection risk before storing or reusing.
 */
export function sanitizeTopicLabel(label: unknown, fallback: string = "general_topic"): string {
  if (typeof label !== "string") return fallback;
  const cleaned = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  if (cleaned.length >= 2 && /^[a-z0-9_]{2,60}$/.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

/**
 * Deterministic fallback slugifier when LLM is unavailable, rate-limited, or fails.
 * Strips common prompt prefixes like "visualize", "demonstrate", "animation of", etc.
 */
export function deterministicSlug(prompt: string): string {
  const cleanedPrompt = prompt
    .toLowerCase()
    .replace(/\b(visualize|demonstration of|animation of|explain|demonstrate|show me|understanding|in 3d|3d|introduction to)\b/gi, "")
    .trim();

  const slug = sanitizeTopicLabel(cleanedPrompt, "");
  if (slug.length >= 2) {
    return slug;
  }
  return sanitizeTopicLabel(prompt, "general_topic");
}

/**
 * Topic normalization via single LLM call with existing user topic context.
 *
 * Architecture note:
 * Alternative considered: embedding similarity with pgvector.
 * Rejected for now because the label set per user is small (typically < 100 topics)
 * and direct LLM label classification with existing topic context avoids vector DB overhead
 * and keeps labels stable across variations like "visualize doppler effect" and "doppler shift in sound".
 */
export async function normalizeTopicForUser(
  userId: string,
  rawPrompt: string
): Promise<Topic> {
  const existingTopics = await storage.getUserTopics(userId);
  const existingNames = existingTopics.map((t) => t.canonicalName);

  // If there's an exact deterministic match, reuse immediately without LLM call
  const quickSlug = deterministicSlug(rawPrompt);
  const quickMatch = existingTopics.find(
    (t) => t.canonicalName === quickSlug || t.canonicalName.replace(/_/g, " ") === rawPrompt.toLowerCase().trim()
  );
  if (quickMatch) {
    return quickMatch;
  }

  let canonicalName = quickSlug;
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const system = `You normalize educational topics into consistent, canonical names.
Output STRICT JSON only: {"canonical_topic": "short_snake_case_name", "reuse_existing": true_or_false}
Rules:
1. 'canonical_topic' must be short lowercase snake_case (2-60 chars, [a-z0-9_] only, e.g. "doppler_effect", "pythagorean_theorem").
2. Check the user's existing topics. If the new prompt refers to the SAME underlying subject/concept (e.g. "visualize doppler effect" vs "doppler shift in sound"), reuse the existing canonical topic name and set "reuse_existing": true.
3. If it is genuinely a distinct topic, create a new short canonical name and set "reuse_existing": false.`;

      const user = `User's existing canonical topics: ${JSON.stringify(existingNames)}
New prompt: "${rawPrompt}"
Return canonical topic JSON.`;

      const result = await model.generateContent([system, user]);
      const text = result.response.text().trim();
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      const payload = JSON.parse(cleaned);

      const parsed = z
        .object({
          canonical_topic: z.string(),
          reuse_existing: z.boolean().optional(),
        })
        .safeParse(payload);

      if (parsed.success) {
        canonicalName = sanitizeTopicLabel(parsed.data.canonical_topic, quickSlug);
      }
    } catch (err: any) {
      console.warn("[Topic Normalization] LLM normalization failed or rate-limited, using deterministic slug fallback:", err.message);
      canonicalName = quickSlug;
    }
  }

  // Check if topic with this canonical name already exists for user
  const existing = await storage.getTopicByName(userId, canonicalName);
  if (existing) {
    return existing;
  }

  // Create new topic
  try {
    return await storage.createTopic({
      userId,
      canonicalName,
    });
  } catch (err) {
    // In case of concurrent creation race condition, return existing
    const raceCheck = await storage.getTopicByName(userId, canonicalName);
    if (raceCheck) return raceCheck;
    throw err;
  }
}

