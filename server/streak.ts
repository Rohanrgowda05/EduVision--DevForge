/**
 * Streak computation logic based on distinct calendar days of user activity
 * (e.g., generating an animation or submitting a quiz).
 */

export function toDateStringUTC(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Compute the continuous learning streak given a list of activity dates.
 * A streak is maintained if the user had activity today OR yesterday.
 *
 * @param activityDates Array of Dates or ISO strings representing user actions
 * @param referenceDate Optional anchor date for calculations (defaults to current date)
 * @returns Number of consecutive days in streak (>= 0)
 */
export function calculateStreak(
  activityDates: (Date | string)[],
  referenceDate: Date = new Date()
): number {
  if (!activityDates || activityDates.length === 0) {
    return 0;
  }

  // Convert to unique YYYY-MM-DD strings
  const dateSet = new Set<string>();
  for (const item of activityDates) {
    const d = typeof item === "string" ? new Date(item) : item;
    if (!isNaN(d.getTime())) {
      dateSet.add(toDateStringUTC(d));
    }
  }

  if (dateSet.size === 0) {
    return 0;
  }

  const todayStr = toDateStringUTC(referenceDate);
  const yesterday = new Date(referenceDate);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = toDateStringUTC(yesterday);

  // If there's no activity today and no activity yesterday, streak is broken
  const hasToday = dateSet.has(todayStr);
  const hasYesterday = dateSet.has(yesterdayStr);

  if (!hasToday && !hasYesterday) {
    return 0;
  }

  // Start walking backwards from the most recent active anchor day
  let anchor = new Date(referenceDate);
  if (!hasToday && hasYesterday) {
    anchor = yesterday;
  }

  let currentStreak = 0;
  const cursor = new Date(anchor);

  while (true) {
    const dateStr = toDateStringUTC(cursor);
    if (dateSet.has(dateStr)) {
      currentStreak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }

  return currentStreak;
}

