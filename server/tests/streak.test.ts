import { calculateStreak } from "../streak";

function runTests() {
  const ref = new Date("2026-11-09T12:00:00Z");

  // Test 1: Empty dates
  console.assert(calculateStreak([], ref) === 0, "Test 1 failed");

  // Test 2: Activity today only
  console.assert(calculateStreak(["2026-11-09T08:00:00Z"], ref) === 1, "Test 2 failed");

  // Test 3: Activity yesterday only (active streak of 1 day)
  console.assert(calculateStreak(["2026-11-08T20:00:00Z"], ref) === 1, "Test 3 failed");

  // Test 4: Activity today and yesterday (streak of 2)
  console.assert(calculateStreak(["2026-11-09T01:00:00Z", "2026-11-08T15:00:00Z"], ref) === 2, "Test 4 failed");

  // Test 5: Activity today, yesterday, and 2 days ago (streak of 3)
  console.assert(calculateStreak([
    "2026-11-09T01:00:00Z",
    "2026-11-08T15:00:00Z",
    "2026-11-07T10:00:00Z"
  ], ref) === 3, "Test 5 failed");

  // Test 6: Activity yesterday and 2 days ago, nothing today (streak of 2 preserved from yesterday)
  console.assert(calculateStreak([
    "2026-11-08T15:00:00Z",
    "2026-11-07T10:00:00Z"
  ], ref) === 2, "Test 6 failed");

  // Test 7: Activity 2 days ago, nothing yesterday or today (streak broken -> 0)
  console.assert(calculateStreak([
    "2026-11-07T10:00:00Z",
    "2026-11-06T10:00:00Z"
  ], ref) === 0, "Test 7 failed");

  // Test 8: Multiple activities on the same day (deduplication)
  console.assert(calculateStreak([
    "2026-11-09T01:00:00Z",
    "2026-11-09T05:00:00Z",
    "2026-11-09T22:00:00Z",
    "2026-11-08T15:00:00Z"
  ], ref) === 2, "Test 8 failed");

  // Test 9: Gap in consecutive days
  console.assert(calculateStreak([
    "2026-11-09T01:00:00Z",
    "2026-11-08T15:00:00Z",
    // 2026-11-07 missed
    "2026-11-06T10:00:00Z"
  ], ref) === 2, "Test 9 failed");

  console.log("All streak unit tests passed successfully!");
}

runTests();

