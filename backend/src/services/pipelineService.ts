import prisma from '../config/database';
import { getNextStage, validateReject } from '../utils/stageUtils';
import { CreateCandidateInput, CandidateModel } from '../models/Candidate';

export const PipelineService = {
  /**
   * Create a new candidate — starts in Applied stage.
   */
  async addCandidate(data: CreateCandidateInput) {
    return CandidateModel.create(data);
  },

  /**
   * Advance a candidate to the next stage.
   * Validates state machine rules on the backend.
   * Uses a database transaction — both update + history insert must succeed.
   */
  async advanceCandidate(id: number, notes?: string) {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new Error('NOT_FOUND');
    if (candidate.isArchived) throw new Error('ARCHIVED');

    const nextStage = getNextStage(candidate.currentStage); // throws if invalid

    return prisma.$transaction(async (tx) => {
      await tx.candidate.update({
        where: { id },
        data: { currentStage: nextStage },
      });

      await tx.candidateHistory.create({
        data: {
          candidateId: id,
          fromStage: candidate.currentStage,
          toStage: nextStage,
          action: 'advance',
          notes: notes || null,
        },
      });

      return tx.candidate.findUnique({ where: { id } });
    });
  },

  /**
   * Reject a candidate from their current stage.
   * Validates that they are not already in a terminal stage.
   * Uses a database transaction.
   */
  async rejectCandidate(id: number, notes?: string) {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new Error('NOT_FOUND');
    if (candidate.isArchived) throw new Error('ARCHIVED');

    validateReject(candidate.currentStage); // throws if terminal

    return prisma.$transaction(async (tx) => {
      await tx.candidate.update({
        where: { id },
        data: { currentStage: 'Rejected' },
      });

      await tx.candidateHistory.create({
        data: {
          candidateId: id,
          fromStage: candidate.currentStage,
          toStage: 'Rejected',
          action: 'reject',
          notes: notes || null,
        },
      });

      return tx.candidate.findUnique({ where: { id } });
    });
  },

  /**
   * Archive a candidate (soft-delete).
   * History is preserved permanently. No records are deleted.
   */
  async archiveCandidate(id: number) {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw new Error('NOT_FOUND');

    return prisma.candidate.update({
      where: { id },
      data: { isArchived: true },
    });
  },
};
