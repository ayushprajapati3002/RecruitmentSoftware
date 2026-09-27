/**
 * Date and phone utility functions.
 * Timezone-aware for Asia/Kolkata (IST: UTC+5:30).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns a Date object representing the current moment in Asia/Kolkata context.
 */
function getKolkataNow(): Date {
  const utcNow = new Date();
  // Return Date shifted to local Kolkata time representation
  return new Date(utcNow.getTime() + IST_OFFSET_MS);
}

/**
 * Converts a YYYY-MM-DD string in Asia/Kolkata to an ISO string representing 00:00:00 IST (which is 18:30:00 UTC previous day).
 */
function kolkataDateToISO(year: number, monthZeroIndexed: number, day: number): string {
  // Midnight in Kolkata: 00:00:00 IST is (hour - 5.5) in UTC
  const d = new Date(Date.UTC(year, monthZeroIndexed, day, 0, 0, 0, 0) - IST_OFFSET_MS);
  return d.toISOString();
}

/**
 * Parses relative date expressions into ISO date strings.
 * Handles: "Monday", "yesterday", "last week", "this week", "3 days ago", "10 September", ISO dates
 */
export function parseRelativeDate(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const lower = input.toLowerCase().trim();
  const kNow = getKolkataNow();
  const kYear = kNow.getUTCFullYear();
  const kMonth = kNow.getUTCMonth();
  const kDate = kNow.getUTCDate();
  const kDay = kNow.getUTCDay(); // 0 is Sunday, 1 is Monday...

  if (lower === 'today') {
    return kolkataDateToISO(kYear, kMonth, kDate);
  }

  if (lower === 'yesterday') {
    return kolkataDateToISO(kYear, kMonth, kDate - 1);
  }

  if (lower === 'tomorrow') {
    return kolkataDateToISO(kYear, kMonth, kDate + 1);
  }

  if (lower === 'this week') {
    // Start of current week (Monday)
    const diff = (kDay + 6) % 7;
    return kolkataDateToISO(kYear, kMonth, kDate - diff);
  }

  if (lower === 'last week') {
    // 7 days before start of current week
    const diff = ((kDay + 6) % 7) + 7;
    return kolkataDateToISO(kYear, kMonth, kDate - diff);
  }

  // "one week ago" / "1 week ago"
  if (lower === 'one week ago' || lower === '1 week ago') {
    return kolkataDateToISO(kYear, kMonth, kDate - 7);
  }

  // "N days ago"
  const daysAgoMatch = lower.match(/^(\d+)\s+days?\s+ago$/);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    return kolkataDateToISO(kYear, kMonth, kDate - days);
  }

  // "N weeks ago"
  const weeksAgoMatch = lower.match(/^(\d+)\s+weeks?\s+ago$/);
  if (weeksAgoMatch) {
    const weeks = parseInt(weeksAgoMatch[1], 10);
    return kolkataDateToISO(kYear, kMonth, kDate - weeks * 7);
  }

  // Day of week: "Monday", "Tuesday", etc. or "last Monday"
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const isLastPrefix = lower.startsWith('last ');
  const cleanDay = isLastPrefix ? lower.replace(/^last\s+/, '') : lower;
  const targetDayIdx = days.indexOf(cleanDay);

  if (targetDayIdx !== -1) {
    let diff = kDay - targetDayIdx;
    if (isLastPrefix) {
      if (diff <= 0) diff += 7;
      diff += 7; // Go to previous week's occurrence
    } else {
      if (diff <= 0) diff += 7; // Most recent past occurrence
    }
    return kolkataDateToISO(kYear, kMonth, kDate - diff);
  }

  // Month names: "10 September", "September 10"
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthRegex = new RegExp(`(?:(\\d{1,2})\\s+(${months.join('|')})|(${months.join('|')})\\s+(\\d{1,2}))`, 'i');
  const monthMatch = lower.match(monthRegex);
  if (monthMatch) {
    const dayStr = monthMatch[1] || monthMatch[4];
    const monthStr = (monthMatch[2] || monthMatch[3]).toLowerCase();
    const monthIdx = months.indexOf(monthStr);
    const dayNum = parseInt(dayStr, 10);
    if (monthIdx !== -1 && dayNum >= 1 && dayNum <= 31) {
      return kolkataDateToISO(kYear, monthIdx, dayNum);
    }
  }

  // ISO date string: "2026-09-20"
  const isoMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    return kolkataDateToISO(y, m, d);
  }

  // Fallback to standard Date parsing if valid
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return null;
}

/**
 * Calculates days between two dates.
 */
export function daysBetween(from: Date, to: Date = new Date()): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Formats a number of days into a human-readable string.
 */
export function formatDaysInStage(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days < 14) return '1 week';
  if (days < 30) return `${Math.floor(days / 7)} weeks`;
  if (days < 60) return '1 month';
  return `${Math.floor(days / 30)} months`;
}

/**
 * Normalizes a phone number to digits only for search matching.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
