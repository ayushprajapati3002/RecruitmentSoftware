// Stage pipeline definition — the source of truth
export const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'] as const;
export type Stage = typeof STAGES[number] | 'Rejected';

export const TERMINAL_STAGES = new Set<string>(['Hired', 'Rejected']);

export const ALL_STAGES: string[] = [...STAGES, 'Rejected'];

/**
 * Returns the next stage for a given current stage.
 * Throws if the current stage is terminal or invalid.
 */
export function getNextStage(currentStage: string): string {
  if (TERMINAL_STAGES.has(currentStage)) {
    throw new Error(`Cannot advance from "${currentStage}" — it is a final stage.`);
  }
  const idx = STAGES.indexOf(currentStage as typeof STAGES[number]);
  if (idx === -1) {
    throw new Error(`Unknown stage: "${currentStage}".`);
  }
  if (idx === STAGES.length - 1) {
    throw new Error(`"${currentStage}" is the last active stage. Use the reject action or it becomes Hired.`);
  }
  return STAGES[idx + 1];
}

/**
 * Validates that a reject action is allowed from the current stage.
 * Throws if terminal.
 */
export function validateReject(currentStage: string): void {
  if (TERMINAL_STAGES.has(currentStage)) {
    throw new Error(`Cannot reject from "${currentStage}" — it is already a final stage.`);
  }
}

/**
 * Validates that a transition from → to is valid.
 * Used for strict backend enforcement.
 */
export function validateTransition(from: string, to: string): void {
  if (TERMINAL_STAGES.has(from)) {
    throw new Error(`Cannot transition from "${from}" — final stage.`);
  }
  if (to === 'Rejected') {
    return; // Reject is always valid from non-terminal
  }
  const nextStage = getNextStage(from);
  if (nextStage !== to) {
    throw new Error(
      `Invalid transition: "${from}" → "${to}". Only allowed: "${from}" → "${nextStage}" or "Rejected".`
    );
  }
}

/**
 * Finds the closest stage name to an input (for search suggestions).
 */
export function findClosestStage(input: string): string | null {
  const lower = input.toLowerCase();
  // Exact match
  const exact = ALL_STAGES.find(s => s.toLowerCase() === lower);
  if (exact) return exact;
  // Prefix match
  const prefix = ALL_STAGES.find(s => s.toLowerCase().startsWith(lower));
  if (prefix) return prefix;
  // Contains match
  const contains = ALL_STAGES.find(s => s.toLowerCase().includes(lower));
  if (contains) return contains;
  return null;
}
