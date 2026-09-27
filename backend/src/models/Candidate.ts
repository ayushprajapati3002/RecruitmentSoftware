import prisma from '../config/database';
import { normalizePhone } from '../utils/dateUtils';

export interface CreateCandidateInput {
  name: string;
  email: string;
  phone?: string;
  dob?: string;
  address?: string;
  linkedin?: string;
  github?: string;
  experience?: string;
  skills?: string[];
  vacancy: string;
  resumeUrl?: string;
  location?: string;
  notes?: string;
}

export const CandidateModel = {
  /**
   * Create a new candidate and their initial history record in a transaction.
   * Candidate starts in "Applied" stage.
   */
  async create(data: CreateCandidateInput) {
    const phoneNorm = data.phone ? normalizePhone(data.phone) : null;

    return prisma.$transaction(async (tx) => {
      // Check email uniqueness
      const existing = await tx.candidate.findUnique({ where: { email: data.email } });
      if (existing) {
        throw new Error('DUPLICATE_EMAIL');
      }

      const candidate = await tx.candidate.create({
        data: {
          name: data.name.trim(),
          email: data.email.toLowerCase().trim(),
          phone: data.phone?.trim() || null,
          phoneNorm,
          dob: data.dob?.trim() || null,
          address: data.address?.trim() || null,
          linkedin: data.linkedin?.trim() || null,
          github: data.github?.trim() || null,
          experience: data.experience?.trim() || null,
          skills: data.skills || [],
          vacancy: data.vacancy.trim(),
          resumeUrl: data.resumeUrl?.trim() || null,
          location: data.location?.trim() || null,
          notes: data.notes?.trim() || null,
          currentStage: 'Applied',
        },
      });

      // Create immutable first history record
      await tx.candidateHistory.create({
        data: {
          candidateId: candidate.id,
          fromStage: null, // NULL = initial creation
          toStage: 'Applied',
          action: 'create',
          notes: 'Candidate added to pipeline',
        },
      });

      return candidate;
    });
  },

  /**
   * Get all non-archived candidates.
   * Optional stage filter.
   */
  async findAll(stage?: string) {
    return prisma.candidate.findMany({
      where: {
        isArchived: false,
        ...(stage ? { currentStage: stage } : {}),
      },
      include: {
        history: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Get a single candidate by ID with full history and days-in-stage.
   */
  async findById(id: number) {
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: {
        history: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!candidate) return null;

    // Calculate days in current stage from last history entry
    const lastHistory = candidate.history[candidate.history.length - 1];
    const daysInCurrentStage = lastHistory
      ? Math.floor(
          (Date.now() - new Date(lastHistory.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;

    return { candidate, history: candidate.history, daysInCurrentStage };
  },

  /**
   * Update the current stage of a candidate.
   * Must be called inside a transaction from pipelineService.
   */
  async updateStage(id: number, newStage: string, tx?: Parameters<typeof prisma.$transaction>[0] extends (tx: infer T) => any ? T : never) {
    const client = tx || prisma;
    return (client as typeof prisma).candidate.update({
      where: { id },
      data: { currentStage: newStage },
    });
  },

  /**
   * Soft-delete: archive a candidate (never hard-delete).
   * History remains permanently intact.
   */
  async archive(id: number) {
    return prisma.candidate.update({
      where: { id },
      data: { isArchived: true },
    });
  },

  /**
   * Update personal details of a candidate
   */
  async updateDetails(id: number, data: Partial<CreateCandidateInput>) {
    const updateData: any = {
      name: data.name?.trim(),
      email: data.email?.toLowerCase().trim(),
      phone: data.phone?.trim(),
      dob: data.dob?.trim(),
      address: data.address?.trim(),
      linkedin: data.linkedin?.trim(),
      github: data.github?.trim(),
      experience: data.experience?.trim(),
      vacancy: data.vacancy?.trim(),
    };

    if (data.skills) updateData.skills = data.skills;

    // Remove undefined values so prisma doesn't overwrite with null
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    if (updateData.phone) {
      updateData.phoneNorm = normalizePhone(updateData.phone);
    }

    return prisma.candidate.update({
      where: { id },
      data: updateData
    });
  },
};
