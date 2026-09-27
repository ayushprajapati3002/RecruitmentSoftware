import { Prisma, Candidate, CandidateHistory } from '@prisma/client';
import prisma from '../config/database';
import {
  SearchFilters,
  AISearchResult,
  ComparisonOperator,
  interpretWithAI as nlpInterpret,
} from './nlpService';
import { normalizePhone, parseRelativeDate } from '../utils/dateUtils';
import { ALL_STAGES } from '../utils/stageUtils';

// Re-export SearchFilters and AISearchResult for consumers
export type { SearchFilters, AISearchResult } from './nlpService';

export interface CandidateWithHistory extends Candidate {
  history: CandidateHistory[];
}

export interface RankedCandidate extends CandidateWithHistory {
  _score: number;
  relevance_score?: number;
  match_reason?: string;
}

export interface SearchResult {
  type: 'results' | 'no_matches' | 'invalid_query';
  results?: RankedCandidate[];
  message?: string;
  explanation?: string;
  suggestions?: string[];
  queryParsed?: SearchFilters;
  isFuzzyRelaxed?: boolean;
}

// ─── TIER 1: PATTERN SHORTCUTS (Instant for raw emails / phones) ──────────────

function detectPatternShortcut(q: string): SearchFilters | null {
  if (q.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
    return { emailQuery: q.toLowerCase() };
  }
  // Phone numbers (e.g. "+91 6397752343", "6397752343", "6397", "+91")
  const trimmed = q.trim();
  const digitsOnly = normalizePhone(trimmed);
  // If the query consists primarily of digits, plus, hyphens, spaces and has at least 4 digits
  if (/^[\d\s\-+()]+$/.test(trimmed) && digitsOnly.length >= 4) {
    return { phoneQuery: digitsOnly };
  }
  return null;
}

// ─── PARSE EXPERIENCE YEARS ───────────────────────────────────────────────────

function parseExperienceYears(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

// ─── HISTORY RESOLUTION ───────────────────────────────────────────────────────

/**
 * Resolves candidate IDs based on historical audit events:
 * 1. movedToStage + movedSince: candidate transitioned to a stage after a date.
 * 2. reachedStage: candidate entered this stage at least once.
 * 3. notReachedStage: candidate NEVER entered this stage in their history.
 */
async function resolveHistoryCandidateIds(filters: SearchFilters): Promise<number[] | null> {
  const hasHistoryConditions =
    (filters.movedToStage && filters.movedSince) ||
    filters.reachedStage ||
    filters.notReachedStage;

  if (!hasHistoryConditions) return null;

  let candidateIdFilter: number[] | null = null;

  // 1. Movement into stage since date
  if (filters.movedToStage && filters.movedSince) {
    const sinceDate = new Date(filters.movedSince);
    const rows = await prisma.candidateHistory.findMany({
      where: {
        toStage: filters.movedToStage,
        createdAt: { gte: sinceDate },
      },
      select: { candidateId: true },
    });
    const movedIds = [...new Set(rows.map((r) => r.candidateId))];
    candidateIdFilter = movedIds;
  }

  // 2. Reached stage at least once
  if (filters.reachedStage) {
    const rows = await prisma.candidateHistory.findMany({
      where: { toStage: filters.reachedStage },
      select: { candidateId: true },
    });
    const reachedIds = new Set(rows.map((r) => r.candidateId));

    if (candidateIdFilter === null) {
      candidateIdFilter = [...reachedIds];
    } else {
      candidateIdFilter = candidateIdFilter.filter((id) => reachedIds.has(id));
    }
  }

  // 3. Candidate NEVER reached this stage
  if (filters.notReachedStage) {
    const rows = await prisma.candidateHistory.findMany({
      where: { toStage: filters.notReachedStage },
      select: { candidateId: true },
    });
    const forbiddenIds = new Set(rows.map((r) => r.candidateId));

    if (candidateIdFilter === null) {
      // Fetch all candidate IDs not in forbidden set
      const allCandidates = await prisma.candidate.findMany({
        where: { isArchived: false },
        select: { id: true },
      });
      candidateIdFilter = allCandidates
        .map((c) => c.id)
        .filter((id) => !forbiddenIds.has(id));
    } else {
      candidateIdFilter = candidateIdFilter.filter((id) => !forbiddenIds.has(id));
    }
  }

  return candidateIdFilter;
}

// ─── FUZZY SIMILARITY HELPERS (PostgreSQL pg_trgm) ────────────────────────────

interface TrigramMatch {
  id: number;
  sim: number;
}

async function getTrigramScores(
  field: 'name' | 'vacancy' | 'location',
  queryStr: string,
  minThreshold: number = 0.25
): Promise<Map<number, number>> {
  if (!queryStr || queryStr.trim().length === 0) return new Map();

  const safeQuery = queryStr.trim();
  let rows: TrigramMatch[] = [];

  try {
    if (field === 'name') {
      rows = await prisma.$queryRaw<TrigramMatch[]>`
        SELECT id, similarity(name, ${safeQuery}) AS sim
        FROM candidates
        WHERE is_archived = false AND similarity(name, ${safeQuery}) >= ${minThreshold}
        ORDER BY sim DESC
      `;
    } else if (field === 'vacancy') {
      rows = await prisma.$queryRaw<TrigramMatch[]>`
        SELECT id, similarity(vacancy, ${safeQuery}) AS sim
        FROM candidates
        WHERE is_archived = false AND similarity(vacancy, ${safeQuery}) >= ${minThreshold}
        ORDER BY sim DESC
      `;
    } else if (field === 'location') {
      rows = await prisma.$queryRaw<TrigramMatch[]>`
        SELECT id, similarity(location, ${safeQuery}) AS sim
        FROM candidates
        WHERE is_archived = false AND location IS NOT NULL AND similarity(location, ${safeQuery}) >= ${minThreshold}
        ORDER BY sim DESC
      `;
    }
  } catch (err) {
    console.error(`[Search] Error running trigram query on ${field}:`, err);
  }

  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.id, Number(r.sim) || 0);
  }
  return map;
}

// ─── STAGE DURATION EVALUATION ────────────────────────────────────────────────

function evaluateDuration(
  daysInCurrentStage: number,
  operator: ComparisonOperator,
  targetDays: number
): boolean {
  switch (operator) {
    case 'gt':
      return daysInCurrentStage > targetDays;
    case 'gte':
      return daysInCurrentStage >= targetDays;
    case 'lt':
      return daysInCurrentStage < targetDays;
    case 'lte':
      return daysInCurrentStage <= targetDays;
    case 'eq':
      return Math.round(daysInCurrentStage) === Math.round(targetDays);
    default:
      return true;
  }
}

// ─── EXECUTE SEARCH (STRICT & FUZZY PASSES) ──────────────────────────────────

export async function executeSearch(
  filters: SearchFilters,
  options: { isFuzzyRelaxed?: boolean } = {}
): Promise<{ results: RankedCandidate[] }> {
  const where: Prisma.CandidateWhereInput = { isArchived: false };

  // 1. HARD FILTERS: Stage & Exclusions (NEVER relaxed)
  if (filters.currentStage) {
    where.currentStage = filters.currentStage;
  } else if (filters.excludeStage) {
    where.currentStage = { not: filters.excludeStage };
  }

  // 2. HARD FILTERS: Social Profiles
  if (filters.hasLinkedin !== undefined) {
    where.linkedin = filters.hasLinkedin ? { not: null } : null;
  }
  if (filters.hasGithub !== undefined) {
    where.github = filters.hasGithub ? { not: null } : null;
  }

  // 3. HARD FILTERS: Date of birth & Phone
  if (filters.dobQuery) {
    where.dob = { contains: filters.dobQuery };
  }
  if (filters.phoneQuery) {
    const digits = normalizePhone(filters.phoneQuery);
    if (digits) where.phoneNorm = { contains: digits };
  }
  if (filters.notesQuery) {
    where.notes = { contains: filters.notesQuery, mode: 'insensitive' };
  }

  // 4. HARD FILTERS: Audit / History
  const historyIds = await resolveHistoryCandidateIds(filters);
  if (historyIds !== null) {
    if (historyIds.length === 0) return { results: [] };
    where.id = { in: historyIds };
  }

  // 5. TEXT CONDITIONS: Exact / Case-insensitive vs Trigram
  let nameScores = new Map<number, number>();
  let vacancyScores = new Map<number, number>();
  let locationScores = new Map<number, number>();

  if (filters.nameQuery) {
    const thresh = options.isFuzzyRelaxed ? 0.2 : 0.25;
    nameScores = await getTrigramScores('name', filters.nameQuery, thresh);

    // Also include exact substring matches
    const exactNameMatches = await prisma.candidate.findMany({
      where: {
        isArchived: false,
        name: { contains: filters.nameQuery, mode: 'insensitive' },
      },
      select: { id: true },
    });
    for (const em of exactNameMatches) {
      if (!nameScores.has(em.id)) {
        nameScores.set(em.id, 0.85);
      }
    }

    if (nameScores.size === 0) {
      return { results: [] };
    }

    // Merge with where.id
    if (where.id && typeof where.id === 'object' && 'in' in where.id) {
      const existingIds = new Set((where.id as any).in as number[]);
      const intersected = [...nameScores.keys()].filter((id) => existingIds.has(id));
      if (intersected.length === 0) return { results: [] };
      where.id = { in: intersected };
    } else {
      where.id = { in: [...nameScores.keys()] };
    }
  }

  // Vacancy
  if (filters.vacancyQuery) {
    if (!options.isFuzzyRelaxed) {
      where.vacancy = { contains: filters.vacancyQuery, mode: 'insensitive' };
    } else {
      vacancyScores = await getTrigramScores('vacancy', filters.vacancyQuery, 0.2);
    }
  }

  // Location
  if (filters.locationQuery) {
    if (!options.isFuzzyRelaxed) {
      where.location = { contains: filters.locationQuery, mode: 'insensitive' };
    } else {
      locationScores = await getTrigramScores('location', filters.locationQuery, 0.2);
    }
  }

  // Skills
  if (filters.skills && filters.skills.length > 0) {
    if (!options.isFuzzyRelaxed) {
      // In strict mode: require every skill or case-insensitive equivalent
      where.skills = { hasSome: filters.skills };
    } else {
      // Relaxed mode: hasSome
      where.skills = { hasSome: filters.skills };
    }
  }

  // Email
  if (filters.emailQuery) {
    where.email = { contains: filters.emailQuery, mode: 'insensitive' };
  }

  // General fallback text
  if (filters.generalQuery) {
    const g = filters.generalQuery;
    where.OR = [
      { name: { contains: g, mode: 'insensitive' } },
      { vacancy: { contains: g, mode: 'insensitive' } },
      { location: { contains: g, mode: 'insensitive' } },
      { notes: { contains: g, mode: 'insensitive' } },
      { email: { contains: g, mode: 'insensitive' } },
      { skills: { hasSome: [g] } },
    ];
  }

  // 6. Query DB with all history for duration calculation
  const candidates = await prisma.candidate.findMany({
    where,
    include: {
      history: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  // 7. In-memory evaluation: Experience & Stage Duration
  let filtered = candidates;

  // Strict skills verification if needed
  if (filters.skills && filters.skills.length > 0 && !options.isFuzzyRelaxed) {
    const requiredSkillsLower = filters.skills.map((s) => s.toLowerCase());
    filtered = filtered.filter((c) => {
      const candSkillsLower = (c.skills || []).map((s) => s.toLowerCase());
      // Check that all required skills are present
      return requiredSkillsLower.every((req) =>
        candSkillsLower.some((candSkill) => candSkill.includes(req) || req.includes(candSkill))
      );
    });
  }

  // Experience filtering
  if (
    filters.experienceMin !== undefined ||
    filters.experienceMax !== undefined ||
    filters.experienceExact !== undefined
  ) {
    filtered = filtered.filter((c) => {
      const years = parseExperienceYears(c.experience);
      if (years === null) return false;
      if (filters.experienceExact !== undefined && years !== filters.experienceExact) return false;
      if (filters.experienceMin !== undefined && years < filters.experienceMin) return false;
      if (filters.experienceMax !== undefined && years > filters.experienceMax) return false;
      return true;
    });
  }

  // Stage Duration filtering
  if (filters.stageDuration) {
    const { operator, days } = filters.stageDuration;
    const now = Date.now();

    filtered = filtered.filter((c) => {
      // Find the most recent timestamp candidate entered currentStage
      const latestHistoryForStage = c.history?.find(
        (h) => h.toStage.toLowerCase() === c.currentStage.toLowerCase()
      );
      const stageEntryDate = latestHistoryForStage
        ? new Date(latestHistoryForStage.createdAt).getTime()
        : new Date(c.createdAt).getTime();

      const daysInStage = (now - stageEntryDate) / (1000 * 60 * 60 * 24);
      return evaluateDuration(daysInStage, operator, days);
    });
  }

  if (filtered.length === 0) {
    return { results: [] };
  }

  // 8. RELEVANCE SCORING
  const ranked: RankedCandidate[] = filtered.map((c) => {
    let score = 0;
    const reasons: string[] = [];

    // Exact or Trigram Name Match
    const nSim = nameScores.get(c.id);
    if (filters.nameQuery) {
      const queryLower = filters.nameQuery.toLowerCase();
      const candNameLower = c.name.toLowerCase();

      if (candNameLower === queryLower) {
        score += 50;
        reasons.push('Exact name match');
      } else if (candNameLower.startsWith(queryLower) || candNameLower.includes(queryLower)) {
        score += 35;
        reasons.push('Name match');
      } else if (nSim !== undefined) {
        score += Math.round(nSim * 30);
        reasons.push(`Fuzzy name match (${Math.round(nSim * 100)}%)`);
      }
    }

    // Current stage match
    if (filters.currentStage && c.currentStage.toLowerCase() === filters.currentStage.toLowerCase()) {
      score += 15;
      reasons.push(`Stage: ${c.currentStage}`);
    }

    // Role / Vacancy match
    if (filters.vacancyQuery) {
      const qVacLower = filters.vacancyQuery.toLowerCase();
      const candVacLower = (c.vacancy || '').toLowerCase();
      if (candVacLower === qVacLower) {
        score += 20;
        reasons.push('Exact vacancy match');
      } else if (candVacLower.includes(qVacLower)) {
        score += 15;
        reasons.push('Vacancy match');
      } else {
        const vSim = vacancyScores.get(c.id);
        if (vSim) {
          score += Math.round(vSim * 15);
          reasons.push(`Fuzzy vacancy match (${Math.round(vSim * 100)}%)`);
        }
      }
    }

    // Skill matches
    if (filters.skills && filters.skills.length > 0) {
      const candSkills = (c.skills || []).map((s) => s.toLowerCase());
      let matchedCount = 0;
      for (const req of filters.skills) {
        if (candSkills.some((s) => s.includes(req.toLowerCase()))) {
          matchedCount += 1;
        }
      }
      score += matchedCount * 8;
      if (matchedCount > 0) {
        reasons.push(`Skills matched (${matchedCount}/${filters.skills.length})`);
      }
    }

    // Location match
    if (filters.locationQuery) {
      const qLoc = filters.locationQuery.toLowerCase();
      const candLoc = (c.location || '').toLowerCase();
      if (candLoc.includes(qLoc)) {
        score += 10;
        reasons.push('Location match');
      }
    }

    // Email match
    if (filters.emailQuery && c.email.toLowerCase().includes(filters.emailQuery.toLowerCase())) {
      score += 40;
      reasons.push('Email match');
    }

    // Experience match bonus
    if (filters.experienceMin !== undefined || filters.experienceMax !== undefined) {
      score += 5;
    }

    return {
      ...c,
      _score: score,
      relevance_score: score,
      match_reason: reasons.join(' • '),
    };
  });

  // Sort by score descending, then most recently updated
  ranked.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return { results: ranked };
}

// ─── FORMAT INTERPRETED CONDITIONS ───────────────────────────────────────────

function formatInterpretedConditions(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.nameQuery) parts.push(`Name: "${f.nameQuery}"`);
  if (f.currentStage) parts.push(`Stage: ${f.currentStage}`);
  if (f.excludeStage) parts.push(`Except: ${f.excludeStage}`);
  if (f.vacancyQuery) parts.push(`Role: ${f.vacancyQuery}`);
  if (f.skills && f.skills.length > 0) parts.push(`Skills: [${f.skills.join(', ')}]`);
  if (f.experienceMin !== undefined && f.experienceMax !== undefined) {
    parts.push(`Experience: ${f.experienceMin}-${f.experienceMax} yrs`);
  } else if (f.experienceMin !== undefined) {
    parts.push(`Experience: ${f.experienceMin}+ yrs`);
  } else if (f.experienceMax !== undefined) {
    parts.push(`Experience: < ${f.experienceMax + 1} yrs`);
  }
  if (f.stageDuration) {
    const symbol =
      f.stageDuration.operator === 'gt'
        ? '>'
        : f.stageDuration.operator === 'gte'
        ? '>='
        : f.stageDuration.operator === 'lt'
        ? '<'
        : f.stageDuration.operator === 'lte'
        ? '<='
        : '=';
    parts.push(`In stage ${symbol} ${f.stageDuration.days} days`);
  }
  if (f.movedToStage && f.movedSince) {
    parts.push(`Moved to ${f.movedToStage} since ${f.movedSince.split('T')[0]}`);
  }
  if (f.reachedStage) parts.push(`Reached: ${f.reachedStage}`);
  if (f.notReachedStage) parts.push(`Never reached: ${f.notReachedStage}`);
  if (f.locationQuery) parts.push(`Location: ${f.locationQuery}`);
  return parts.join(' • ');
}

// ─── MAIN SEARCH ENTRY POINT ─────────────────────────────────────────────────

export async function search(rawQuery: string, stageOverride?: string): Promise<SearchResult> {
  const q = rawQuery.trim();

  if (q.length < 2) {
    return {
      type: 'invalid_query',
      message: 'Please enter at least 2 characters to search.',
      explanation: 'Query too short.',
      suggestions: ['Find Priya Sharma', 'Candidates in Interview', 'React developers with 5+ years'],
    };
  }

  // TIER 1: Pattern shortcuts (emails, clean phone numbers)
  const patternFilters = detectPatternShortcut(q);
  if (patternFilters) {
    if (stageOverride && stageOverride !== 'All Candidates') {
      patternFilters.currentStage = stageOverride;
    }
    const res = await executeSearch(patternFilters);
    const explanation = patternFilters.emailQuery
      ? `Email: ${q}`
      : `Phone: ${q}`;

    if (res.results.length === 0) {
      return {
        type: 'no_matches',
        message: 'No candidates matched your search criteria.',
        explanation,
        queryParsed: patternFilters,
        suggestions: ['Verify the email address or phone number.'],
      };
    }
    return {
      type: 'results',
      results: res.results,
      explanation,
      queryParsed: patternFilters,
    };
  }

  // TIER 2: LLM Interpretation
  const ai = await nlpInterpret(q, ALL_STAGES);

  if (ai) {
    // 1. Unclear / nonsensical query
    if (ai.intent === 'unclear') {
      return {
        type: 'invalid_query',
        message: ai.message || "I couldn't understand that search query.",
        explanation: ai.explanation || "This query doesn't look like an ATS recruitment search.",
        suggestions:
          ai.suggestions && ai.suggestions.length > 0
            ? ai.suggestions
            : ['Find Priya Sharma', 'Who is in Interview right now?', 'React developers with 5+ years'],
      };
    }

    const filters = ai.filters;
    if (stageOverride && stageOverride !== 'All Candidates') {
      filters.currentStage = stageOverride;
    }

    // 2. Strict Search Pass
    let res = await executeSearch(filters, { isFuzzyRelaxed: false });
    let isFuzzyRelaxed = false;

    // 3. Relaxed Text Fallback Pass (ONLY relax text: name, vacancy, location, skills - NEVER stage, experience, history)
    const hasTextComponents = !!(filters.nameQuery || filters.vacancyQuery || filters.locationQuery || (filters.skills && filters.skills.length > 0));
    if (res.results.length === 0 && hasTextComponents) {
      const relaxedRes = await executeSearch(filters, { isFuzzyRelaxed: true });
      if (relaxedRes.results.length > 0) {
        res = relaxedRes;
        isFuzzyRelaxed = true;
      }
    }

    // 4. Return results or structured zero-match response
    if (res.results.length === 0) {
      const conditionSummary = formatInterpretedConditions(filters) || ai.explanation;
      return {
        type: 'no_matches',
        message: `No candidates matched all of your conditions (${conditionSummary}).`,
        explanation: ai.explanation,
        suggestions: ai.suggestions && ai.suggestions.length > 0 ? ai.suggestions : undefined,
        queryParsed: filters,
      };
    }

    const explanation = isFuzzyRelaxed
      ? `${ai.explanation} (Showing closest text matches)`
      : ai.explanation;

    return {
      type: 'results',
      results: res.results,
      explanation,
      suggestions: ai.suggestions && ai.suggestions.length > 0 ? ai.suggestions : undefined,
      queryParsed: filters,
      isFuzzyRelaxed,
    };
  }

  // TIER 3: Fallback general search (if AI service is unavailable)
  const fallbackFilters: SearchFilters = { generalQuery: q };
  if (stageOverride && stageOverride !== 'All Candidates') {
    fallbackFilters.currentStage = stageOverride;
  }
  const res = await executeSearch(fallbackFilters);
  if (res.results.length === 0) {
    return {
      type: 'no_matches',
      message: 'No candidates matched your search criteria.',
      explanation: `General search for "${q}"`,
      queryParsed: fallbackFilters,
    };
  }

  return {
    type: 'results',
    results: res.results,
    explanation: `General text search for "${q}"`,
    queryParsed: fallbackFilters,
  };
}
