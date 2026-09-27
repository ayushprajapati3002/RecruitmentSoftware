import prisma from '../config/database';

// ⚠️ This model has NO update() or delete() methods.
// The candidate_history table is APPEND-ONLY and IMMUTABLE by design.
// Once a history record is created, it must never be altered or removed.

export const CandidateHistoryModel = {
  /**
   * Append a new history record (stage transition event).
   * Intended to be called inside a transaction alongside candidate.update.
   */
  async create(
    candidateId: number,
    fromStage: string | null,
    toStage: string,
    action: 'create' | 'advance' | 'reject',
    notes?: string
  ) {
    return prisma.candidateHistory.create({
      data: {
        candidateId,
        fromStage,
        toStage,
        action,
        notes: notes || null,
      },
    });
  },

  /**
   * Get all history records for a candidate, oldest first.
   */
  async findByCandidateId(candidateId: number) {
    return prisma.candidateHistory.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'asc' },
    });
  },

  // ❌ NO update() method — history is immutable
  // ❌ NO delete() method — history is immutable
};
