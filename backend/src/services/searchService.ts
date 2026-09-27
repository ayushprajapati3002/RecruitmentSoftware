import { Prisma, Candidate } from '@prisma/client';
import prisma from '../config/database';
import { SearchFilters, GeminiSearchResult } from './nlpService';
import { normalizePhone } from '../utils/dateUtils';

// Re-export SearchFilters for consumers
export type { SearchFilters } from './nlpService';

export interface RankedCandidate extends Candidate {
  _score: number;
}

export interface SearchResult {
  type: 'results' | 'no_matches' | 'invalid_query';
  results?: RankedCandidate[];
  message?: string;
  explanation?: string;
  suggestions?: string[];
  queryParsed?: SearchFilters;
}

// ─── TIER 1: PATTERN SHORTCUTS (no AI needed) ─────────────────────────────────

function detectPatternShortcut(q: string): SearchFilters | null {
  if (q.includes('@')) return { emailQuery: q };
  if (/^[\d\s\-+()]{6,}$/.test(q)) return { phoneQuery: normalizePhone(q) };
  
  const words = q.split(/\s+/);
  const looksLikeName = words.length <= 3
    && words.every(w => /^[a-zA-Z\u0900-\u097F'-]+$/.test(w))
    && q.length >= 2
    && q.length <= 60;
    
  if (looksLikeName) return { nameQuery: q };
  return null;
}

// ─── TIER 2: GEMINI INTERPRETATION ───────────────────────────────────────────

async function interpretWithAI(q: string): Promise<GeminiSearchResult | null> {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const { interpretWithAI: interpretWithNLP } = await import('./nlpService');
    return await interpretWithNLP(q);
  } catch (err) {
    console.error('AI interpretation failed:', err);
    return null;
  }
}

// ─── QUERY HELPERS ────────────────────────────────────────────────────────────

function parseExperienceYears(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

async function resolveHistoryIntersection(filters: SearchFilters): Promise<number[] | null> {
  const idSets: Set<number>[] = [];

  if (filters.movedToStage && filters.movedSince) {
    const rows = await prisma.candidateHistory.findMany({
      where: { toStage: filters.movedToStage, createdAt: { gte: new Date(filters.movedSince) } },
      select: { candidateId: true },
    });
    idSets.push(new Set(rows.map((r) => r.candidateId)));
  }

  if (filters.reachedStage) {
    const rows = await prisma.candidateHistory.findMany({
      where: { toStage: filters.reachedStage },
      select: { candidateId: true },
    });
    idSets.push(new Set(rows.map((r) => r.candidateId)));
  }

  if (idSets.length === 0) return null;

  const [first, ...rest] = idSets;
  return [...first].filter((id) => rest.every((s) => s.has(id)));
}

async function resolveFuzzyNameIds(nameQuery: string): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<{ id: number; score: number }[]>`
    SELECT id, similarity(name, ${nameQuery}) AS score
    FROM candidates
    WHERE is_archived = false AND similarity(name, ${nameQuery}) > 0.25
    ORDER BY score DESC
  `;
  return new Map(rows.map((r) => [r.id, r.score]));
}

// ─── EXECUTE SEARCH WITH PRISMA ──────────────────────────────────────────────

export async function executeSearch(filters: SearchFilters): Promise<{ results: RankedCandidate[], message?: string }> {
  const where: Prisma.CandidateWhereInput = { isArchived: false };

  if (filters.currentStage) where.currentStage = filters.currentStage;
  else if (filters.excludeStage) where.currentStage = { not: filters.excludeStage };

  if (filters.vacancyQuery) where.vacancy = { contains: filters.vacancyQuery, mode: 'insensitive' };
  if (filters.locationQuery) where.location = { contains: filters.locationQuery, mode: 'insensitive' };
  if (filters.addressQuery) where.address = { contains: filters.addressQuery, mode: 'insensitive' };
  if (filters.notesQuery) where.notes = { contains: filters.notesQuery, mode: 'insensitive' };
  if (filters.emailQuery) where.email = { contains: filters.emailQuery, mode: 'insensitive' };
  if (filters.dobQuery) where.dob = { contains: filters.dobQuery };

  if (filters.phoneQuery) {
    const digits = filters.phoneQuery.replace(/\D/g, '');
    if (digits) where.phoneNorm = { contains: digits };
  }

  if (filters.skillsQuery) {
    const skills = filters.skillsQuery.split(',').map((s) => s.trim()).filter(Boolean);
    if (skills.length) where.skills = { hasEvery: skills }; // Required: hasEvery
  }

  if (filters.hasLinkedin !== undefined) where.linkedin = filters.hasLinkedin ? { not: null } : null;
  if (filters.hasGithub !== undefined) where.github = filters.hasGithub ? { not: null } : null;

  // History narrowing
  const historyIds = await resolveHistoryIntersection(filters);
  if (historyIds !== null) {
    if (historyIds.length === 0) return { results: [] };
    where.id = { in: historyIds };
  }

  if (filters.notReachedStage) where.currentStage = { not: filters.notReachedStage };

  // Fuzzy name narrowing
  let nameScores = new Map<number, number>();
  if (filters.nameQuery) {
    nameScores = await resolveFuzzyNameIds(filters.nameQuery);
    if (nameScores.size === 0) return { results: [] };
    where.id = { in: [...nameScores.keys()] };
  }
  
  if (filters.generalQuery) {
      // General search logic across fields since fuzzy name didn't catch it
      where.OR = [
          { name: { contains: filters.generalQuery, mode: 'insensitive' } },
          { vacancy: { contains: filters.generalQuery, mode: 'insensitive' } },
          { location: { contains: filters.generalQuery, mode: 'insensitive' } },
          { address: { contains: filters.generalQuery, mode: 'insensitive' } },
          { notes: { contains: filters.generalQuery, mode: 'insensitive' } },
          { email: { contains: filters.generalQuery, mode: 'insensitive' } },
          // Prisma hasSome for array string match
          { skills: { hasSome: [filters.generalQuery] } }
      ]
  }

  // Fetch candidates
  const needsLatestHistory = !!filters.minDaysInStage;
  const candidates = await prisma.candidate.findMany({
    where,
    include: {
      history: { orderBy: { createdAt: 'desc' } } // Fetch all history to populate UI properly!
    },
  });

  // Post-filtering for experience & days in stage
  let filtered = candidates;

  if (filters.minDaysInStage) {
    const cutoffMs = filters.minDaysInStage * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((c: any) => {
      const latest = c.history?.[0];
      return latest ? Date.now() - latest.createdAt.getTime() >= cutoffMs : false;
    });
  }

  if (filters.experienceMin !== undefined || filters.experienceMax !== undefined || filters.experienceExact !== undefined) {
    filtered = filtered.filter((c) => {
      const years = parseExperienceYears(c.experience);
      if (years === null) return false;
      if (filters.experienceExact !== undefined) return years === filters.experienceExact;
      if (filters.experienceMin !== undefined && years < filters.experienceMin) return false;
      if (filters.experienceMax !== undefined && years > filters.experienceMax) return false;
      return true;
    });
  }

  if (filtered.length === 0) return { results: [] };

  // Ranking
  const ranked: RankedCandidate[] = filtered.map((c) => {
    let score = 0;
    const nameScore = nameScores.get(c.id);
    if (nameScore !== undefined) score += nameScore >= 0.99 ? 10 : nameScore * 6;
    if (filters.currentStage && c.currentStage === filters.currentStage) score += 2;
    if (filters.skillsQuery) {
      const wanted = filters.skillsQuery.split(',').map((s) => s.trim().toLowerCase());
      score += c.skills.filter((s) => wanted.includes(s.toLowerCase())).length;
    }
    if (filters.vacancyQuery) score += 1;
    if (filters.locationQuery) score += 1;
    return { ...c, _score: score };
  });

  ranked.sort((a, b) => b._score - a._score);
  return { results: ranked };
}


// ─── MAIN SEARCH ENTRY POINT ─────────────────────────────────────────────────

export async function search(rawQuery: string, stageOverride?: string): Promise<SearchResult> {
  const q = rawQuery.trim();

  if (q.length < 2) {
    return { type: 'invalid_query', message: 'Please enter at least 2 characters to search.', explanation: 'Query too short.' };
  }

  // TIER 1: Pattern shortcuts
  const patternFilters = detectPatternShortcut(q);
  if (patternFilters) {
    if (stageOverride) patternFilters.currentStage = stageOverride;
    const res = await executeSearch(patternFilters);
    
    let explanation = 'Matched by pattern';
    if (patternFilters.emailQuery) explanation = `Searching by email: "${q}"`;
    else if (patternFilters.phoneQuery) explanation = `Searching by phone number: "${q}"`;
    else if (patternFilters.nameQuery) explanation = `Searching for candidate named "${q}"`;

    if (res.results.length === 0) return { type: 'no_matches', message: 'No candidates matched your search criteria.', explanation, queryParsed: patternFilters };
    return { type: 'results', results: res.results, explanation, queryParsed: patternFilters };
  }

  // TIER 2: Gemini / AI 
  const ai = await interpretWithAI(q);
  
  if (ai) {
    if (ai.intent === 'unclear') {
      return { type: 'invalid_query', message: ai.message || "I couldn't understand that search.", explanation: ai.explanation, suggestions: ai.suggestions || [] };
    }

    const filters = ai.filters;
    if (stageOverride) filters.currentStage = stageOverride;

    const res = await executeSearch(filters);
    
    if (res.results.length === 0) {
       return { type: 'no_matches', message: `${ai.explanation} — but no candidates matched.`, explanation: ai.explanation, suggestions: ai.suggestions || [], queryParsed: filters };
    }
    return { type: 'results', results: res.results, explanation: ai.explanation, queryParsed: filters };
  }

  // TIER 3: Fallback general search
  const fallbackFilters: SearchFilters = { generalQuery: q };
  if (stageOverride) fallbackFilters.currentStage = stageOverride;
  const res = await executeSearch(fallbackFilters);
  if (res.results.length === 0) return { type: 'no_matches', message: 'No candidates matched your search criteria.', explanation: 'General text search', queryParsed: fallbackFilters };
  
  return { type: 'results', results: res.results, explanation: 'General text search', queryParsed: fallbackFilters };
}
