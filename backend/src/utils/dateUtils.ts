/**
 * Parses relative date expressions into ISO date strings.
 * Handles: "Monday", "yesterday", "last week", "3 days ago", ISO dates
 */
export function parseRelativeDate(input: string): string | null {
  const lower = input.toLowerCase().trim();
  const now = new Date();

  if (lower === 'today') {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  if (lower === 'yesterday') {
    now.setDate(now.getDate() - 1);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  if (lower === 'last week') {
    now.setDate(now.getDate() - 7);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  // "N days ago"
  const daysAgoMatch = lower.match(/^(\d+)\s+days?\s+ago$/);
  if (daysAgoMatch) {
    now.setDate(now.getDate() - parseInt(daysAgoMatch[1]));
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  // "N weeks ago"
  const weeksAgoMatch = lower.match(/^(\d+)\s+weeks?\s+ago$/);
  if (weeksAgoMatch) {
    now.setDate(now.getDate() - parseInt(weeksAgoMatch[1]) * 7);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  // Day of week: "Monday", "Tuesday", etc.
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIdx = days.indexOf(lower);
  if (dayIdx !== -1) {
    const currentDay = now.getDay();
    let diff = currentDay - dayIdx;
    if (diff <= 0) diff += 7; // go back to last occurrence
    now.setDate(now.getDate() - diff);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  // ISO date string: "2026-09-20"
  const isoMatch = lower.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const d = new Date(lower);
    if (!isNaN(d.getTime())) return d.toISOString();
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
