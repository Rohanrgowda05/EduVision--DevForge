import 'dotenv/config';
import { computeMastery, type ConceptMastery } from '../learning/mastery';
import type { QuestionResult } from '@shared/schema';

function makeResult(
  concept: string,
  correct: boolean,
  daysAgo: number,
  now: Date
): QuestionResult {
  const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: `res_${Math.random()}`,
    attemptId: 'att_1',
    userId: 'user_1',
    topicId: 'topic_1',
    concept,
    questionIndex: 0,
    chosen: correct ? 'a' : 'b',
    correct,
    createdAt,
  };
}

async function main() {
  console.log('\n--- Starting Mastery Model Unit Tests ---');
  const now = new Date('2026-11-09T12:00:00Z');

  // ---------------------------------------------------------------------------
  // TEST 1: No history -> Empty summaries
  // ---------------------------------------------------------------------------
  const emptyResults = computeMastery([], now);
  console.assert(emptyResults.length === 0, 'Empty results should yield empty summaries');
  console.log('✓ Test 1 Passed: Empty history yields empty summaries');

  // ---------------------------------------------------------------------------
  // TEST 2: Single wrong attempt -> Status MUST be "unknown", NOT "weak"!
  // Acceptance criterion: One wrong answer does not mark a concept weak.
  // ---------------------------------------------------------------------------
  const singleWrong = [makeResult('doppler_formula', false, 0, now)];
  const singleWrongSummary = computeMastery(singleWrong, now);
  console.assert(singleWrongSummary.length === 1, 'Expected 1 concept summary');
  const sw = singleWrongSummary[0];
  console.assert(sw.evidence === 1, `Expected evidence=1, got ${sw.evidence}`);
  // mastery = (0 + 1) / (1 + 2) = 0.333
  console.assert(sw.mastery === 0.333, `Expected mastery=0.333, got ${sw.mastery}`);
  console.assert(sw.status === 'unknown', `Expected status='unknown' due to evidence < 3, got '${sw.status}'`);
  console.log('✓ Test 2 Passed: Single wrong attempt yields status="unknown" (not weak due to insufficient evidence)');

  // ---------------------------------------------------------------------------
  // TEST 3: Three consecutive wrong attempts -> Status becomes "weak"
  // Acceptance criterion: 3 or more weighted attempts with low mastery does.
  // ---------------------------------------------------------------------------
  const threeWrong = [
    makeResult('doppler_formula', false, 0, now),
    makeResult('doppler_formula', false, 0, now),
    makeResult('doppler_formula', false, 0, now),
  ];
  const threeWrongSummary = computeMastery(threeWrong, now);
  const tw = threeWrongSummary[0];
  console.assert(tw.evidence === 3, `Expected evidence=3, got ${tw.evidence}`);
  // mastery = (0 + 1) / (3 + 2) = 1/5 = 0.20
  console.assert(tw.mastery === 0.2, `Expected mastery=0.2, got ${tw.mastery}`);
  console.assert(tw.status === 'weak', `Expected status='weak', got '${tw.status}'`);
  console.log('✓ Test 3 Passed: 3 wrong attempts yields evidence=3, mastery=0.20, status="weak"');

  // ---------------------------------------------------------------------------
  // TEST 4: Three consecutive correct attempts -> Status becomes "strong"
  // ---------------------------------------------------------------------------
  const threeCorrect = [
    makeResult('sound_speed', true, 0, now),
    makeResult('sound_speed', true, 0, now),
    makeResult('sound_speed', true, 0, now),
  ];
  const threeCorrectSummary = computeMastery(threeCorrect, now);
  const tc = threeCorrectSummary[0];
  console.assert(tc.evidence === 3, `Expected evidence=3, got ${tc.evidence}`);
  // mastery = (3 + 1) / (3 + 2) = 4/5 = 0.80
  console.assert(tc.mastery === 0.8, `Expected mastery=0.8, got ${tc.mastery}`);
  console.assert(tc.status === 'strong', `Expected status='strong', got '${tc.status}'`);
  console.log('✓ Test 4 Passed: 3 correct attempts yields evidence=3, mastery=0.80, status="strong"');

  // ---------------------------------------------------------------------------
  // TEST 5: Exponential decay over half-life (14 days)
  // An attempt 14 days ago has weight = 0.5.
  // ---------------------------------------------------------------------------
  const staleResults = [
    makeResult('decay_test', true, 14, now), // 14 days old -> weight = 0.5
    makeResult('decay_test', true, 28, now), // 28 days old -> weight = 0.25
  ];
  const staleSummary = computeMastery(staleResults, now);
  const st = staleSummary[0];
  // weightedAttempts = 0.5 + 0.25 = 0.75
  console.assert(Math.abs(st.evidence - 0.75) < 0.01, `Expected evidence ~0.75, got ${st.evidence}`);
  // rawAttempts = 2
  console.assert(st.rawAttempts === 2, `Expected rawAttempts=2, got ${st.rawAttempts}`);
  console.assert(st.status === 'unknown', 'Stale attempts with evidence < 3 should be unknown');
  console.log('✓ Test 5 Passed: Exponential decay accurately discounts old attempts');

  // ---------------------------------------------------------------------------
  // TEST 6: Boundary thresholds: mastery 0.60 boundary and 0.80 boundary
  // ---------------------------------------------------------------------------
  // 3 attempts: 2 correct, 1 wrong.
  // weightedAttempts = 3, weightedCorrect = 2.
  // mastery = (2 + 1) / (3 + 2) = 3/5 = 0.60
  // status should be 'unknown' because 0.60 is neither < 0.60 nor >= 0.80.
  const mixedResults = [
    makeResult('mixed_concept', true, 0, now),
    makeResult('mixed_concept', true, 0, now),
    makeResult('mixed_concept', false, 0, now),
  ];
  const mixedSummary = computeMastery(mixedResults, now);
  const mx = mixedSummary[0];
  console.assert(mx.mastery === 0.6, `Expected mastery=0.6, got ${mx.mastery}`);
  console.assert(mx.status === 'unknown', `Expected status='unknown' for mastery=0.6, got '${mx.status}'`);
  console.log('✓ Test 6 Passed: Boundary threshold (mastery=0.60) classified correctly as unknown');

  console.log('\n>>> All Mastery Model Unit Tests Passed Successfully! <<<\n');
}

main().catch((err) => {
  console.error('Mastery unit tests failed:', err);
  process.exit(1);
});
