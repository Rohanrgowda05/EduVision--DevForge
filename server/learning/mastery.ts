import type { QuestionResult } from "@shared/schema";
import { storage } from "../storage";

export type MasteryStatus = "weak" | "strong" | "unknown";

export interface ConceptMastery {
  concept: string;
  mastery: number; // Laplace-smoothed mastery: (weightedCorrect + 1) / (weightedAttempts + 2)
  evidence: number; // weighted attempts
  status: MasteryStatus;
  rawCorrect: number;
  rawAttempts: number;
}

export interface LearnerProfile {
  topicId: string;
  topicName?: string;
  concepts: ConceptMastery[];
  lastActivity: Date | null;
  totalAttempts: number;
}

export const DEFAULT_HALF_LIFE_DAYS = 14;
export const DEFAULT_MIN_EVIDENCE = 3;

/**
 * Pure function computing concept mastery from raw question_results.
 *
 * Uses:
 * 1. Exponential recency decay: weight = 0.5 ^ (ageDays / halfLifeDays)
 * 2. Laplace smoothing: (weightedCorrect + 1) / (weightedAttempts + 2)
 * 3. Threshold classification:
 *    - weak: evidence >= MIN_EVIDENCE (default 3) and mastery < 0.6
 *    - strong: evidence >= MIN_EVIDENCE (default 3) and mastery >= 0.8
 *    - unknown: insufficient evidence or intermediate mastery
 */
export function computeMastery(
  results: QuestionResult[],
  now: Date = new Date(),
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
  minEvidence: number = DEFAULT_MIN_EVIDENCE
): ConceptMastery[] {
  if (!results || results.length === 0) {
    return [];
  }

  interface ConceptAccumulator {
    weightedCorrect: number;
    weightedAttempts: number;
    rawCorrect: number;
    rawAttempts: number;
  }

  const map = new Map<string, ConceptAccumulator>();

  for (const r of results) {
    const concept = r.concept;
    if (!map.has(concept)) {
      map.set(concept, {
        weightedCorrect: 0,
        weightedAttempts: 0,
        rawCorrect: 0,
        rawAttempts: 0,
      });
    }

    const acc = map.get(concept)!;
    const createdAtTime = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
    const ageDays = Math.max(0, (now.getTime() - createdAtTime) / (1000 * 60 * 60 * 24));
    const weight = Math.pow(0.5, ageDays / halfLifeDays);

    acc.rawAttempts += 1;
    acc.weightedAttempts += weight;

    if (r.correct) {
      acc.rawCorrect += 1;
      acc.weightedCorrect += weight;
    }
  }

  const summaries: ConceptMastery[] = [];

  Array.from(map.entries()).forEach(([concept, acc]) => {
    const evidence = parseFloat(acc.weightedAttempts.toFixed(3));
    // Laplace smoothing: (weightedCorrect + 1) / (weightedAttempts + 2)
    const rawMastery = (acc.weightedCorrect + 1) / (acc.weightedAttempts + 2);
    const mastery = parseFloat(rawMastery.toFixed(3));

    let status: MasteryStatus = "unknown";
    if (evidence >= minEvidence) {
      if (mastery < 0.6) {
        status = "weak";
      } else if (mastery >= 0.8) {
        status = "strong";
      }
    }

    summaries.push({
      concept,
      mastery,
      evidence,
      status,
      rawCorrect: acc.rawCorrect,
      rawAttempts: acc.rawAttempts,
    });
  });

  // Sort lowest mastery first (weakest concepts at the top)
  summaries.sort((a, b) => a.mastery - b.mastery);

  return summaries;
}

/**
 * Retrieves the comprehensive learner mastery profile for a user and topic.
 */
export async function getLearnerProfile(
  userId: string,
  topicId: string,
  now: Date = new Date()
): Promise<LearnerProfile> {
  const topic = await storage.getTopicById(topicId);
  const results = await storage.getQuestionResultsForUser(userId, topicId);

  let lastActivity: Date | null = null;
  if (results.length > 0) {
    const latest = results[0].createdAt;
    lastActivity = latest instanceof Date ? latest : new Date(latest);
  }

  const concepts = computeMastery(results, now);

  return {
    topicId,
    topicName: topic?.canonicalName,
    concepts,
    lastActivity,
    totalAttempts: results.length,
  };
}
