import Groq from 'groq-sdk';
import { ALL_STAGES, findClosestStage } from '../utils/stageUtils';
import { parseRelativeDate } from '../utils/dateUtils';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ComparisonOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export interface StageDurationFilter {
  operator: ComparisonOperator;
  days: number;
}

export interface SearchFilters {
  // Text searches (fuzzy / trigram / LIKE)
  nameQuery?: string;
  emailQuery?: string;
  phoneQuery?: string;
  vacancyQuery?: string;
  locationQuery?: string;
  addressQuery?: string;
  skills?: string[];          // List of skills to match
  notesQuery?: string;
  dobQuery?: string;
  generalQuery?: string;      // Fallback free-text query

  // Existence filters
  hasLinkedin?: boolean;
  hasGithub?: boolean;

  // Numeric experience filters
  experienceMin?: number;
  experienceMax?: number;
  experienceExact?: number;

  // Current stage vs exclusions
  currentStage?: string;
  excludeStage?: string;

  // Stage duration condition (e.g. > 7 days in current stage)
  stageDuration?: StageDurationFilter;

  // Historical stage movement filters
  movedToStage?: string;
  movedSince?: string;        // ISO date string

  // Reached vs not reached stage conditions
  reachedStage?: string;
  notReachedStage?: string;
}

export interface AISearchResult {
  filters: SearchFilters;
  explanation: string;
  intent: 'search' | 'filter' | 'unclear';
  confidence?: number;
  suggestions?: string[];
  message?: string;
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(validStages: string[] = ALL_STAGES): string {
  const stageListStr = validStages.join(', ');
  const todayIST = new Date().toISOString().split('T')[0];

  return `You are an expert recruitment search query interpreter for an Applicant Tracking System (ATS).
Your task is to convert the recruiter's natural-language search query into a structured JSON search plan.

CRITICAL RULES:
1. Output ONLY a valid JSON object. No markdown backticks, no comments, no reasoning, no think blocks.
2. NEVER invent, fake, or hallucinate candidate names, IDs, or mock database results.
3. NEVER correct or normalize the spelling of names or text queries. If the recruiter searches for "Priya Sharam", you MUST set "nameQuery": "Priya Sharam" exactly. The database handles fuzzy matching.
4. Distinguish between CURRENT STAGE and STAGE HISTORY:
   - "in Interview right now", "Interview candidates" -> currentStage: "Interview"
   - "moved to Interview since Monday" -> movedToStage: "Interview", movedSince: "Monday" (or date)
   - "reached Offer but didn't get hired" -> reachedStage: "Offer", notReachedStage: "Hired"
   - "everyone except rejected" -> excludeStage: "Rejected"
5. Pipeline stages MUST come from this valid list: [${stageListStr}].
   Map mentions to the closest stage name (e.g., "Screening", "Interview", "Offer", "Hired", "Rejected", "Applied").
6. Handle stage duration operators properly:
   - "stuck in Screening for more than a week" / "more than 7 days" -> currentStage: "Screening", stageDuration: {"operator": "gt", "days": 7}
   - "at least a week" -> {"operator": "gte", "days": 7}
   - "less than 3 days in Interview" -> currentStage: "Interview", stageDuration: {"operator": "lt", "days": 3}
   - "no more than 5 days" -> {"operator": "lte", "days": 5}
   - "exactly 5 days" -> {"operator": "eq", "days": 5}
7. Handle experience:
   - "5+ years", "at least 5 years" -> experienceMin: 5
   - "< 3 years", "less than 3 years" -> experienceMax: 2 (or experienceMax: 3 with lt semantics)
   - "between 3 and 6 years" -> experienceMin: 3, experienceMax: 6
8. Handle skills:
   - "React and Python developers" -> skills: ["React", "Python"]
   - "React developers" -> skills: ["React"]
9. A bare role/job-title phrase ("data engineer", "software engineer", "frontend developer") MUST become vacancyQuery, NEVER nameQuery.
10. Handle phone numbers:
    - If the user provides a phone number or partial phone number (e.g., "9876543210", "+91 98765", "phone 6397752343"):
      set phoneQuery to the phone number/digits.
11. DYNAMIC CONTEXTUAL SUGGESTIONS (CRITICAL):
    Always generate 2 to 3 suggestions in "suggestions" that are directly derived from the recruiter's query and its elements:
    - Each suggestion MUST be directly related to the current query, exploring a nearby useful condition, refinement, or alternative search.
    - Each suggestion MUST be valid natural-language recruiter search text that can be typed into the same search box.
    - NEVER use generic meta-instructions like "Search by candidate name", "Filter by role", or "Check pipeline status".
    - NEVER invent fake candidate names, skills, or stages that are completely unrelated to what the recruiter asked.
    - Examples of contextual suggestions:
      * Query: "Priya Sharma"
        -> suggestions: ["Priya Sharma in Interview", "Priya Sharma with 5+ years experience", "Priya Sharma for Software Engineer"]
      * Query: "Who's in Interview right now?"
        -> suggestions: ["Who has been in Interview for more than 7 days?", "Who moved to Interview this week?", "Who reached Interview but didn't get an Offer?"]
      * Query: "Who moved to Interview since Monday?"
        -> suggestions: ["Who moved to Offer since Monday?", "Who has been in Interview for more than a week?", "Who reached Interview but didn't get an Offer?"]
      * Query: "React developers with 5+ years in Interview"
        -> suggestions: ["React developers with 5+ years in Screening", "React developers with 3+ years in Interview", "React developers with 5+ years in Interview in Delhi"]
      * Query: "Everyone except rejected candidates"
        -> suggestions: ["Everyone except rejected and hired candidates", "Everyone currently in Interview", "Everyone who moved to Interview this week"]
      * Query: "Priya Sharma in Interview with Python and 10+ years"
        -> suggestions: ["Priya Sharma in Interview with Python", "Priya Sharma with 10+ years experience", "Priya Sharma in Interview"]
      * Query: "purple elephant moon" (unclear/nonsense):
        -> suggestions: ["Search for a candidate by name", "Search for a job or skill", "Search for candidates by pipeline stage"]
12. Keep "explanation" concise (under 12 words), summarizing the search intent.

JSON SCHEMA:
{
  "intent": "search" | "filter" | "unclear",
  "confidence": number, // 0.0 to 1.0
  "explanation": string,
  "nameQuery": string | null,
  "vacancyQuery": string | null,
  "locationQuery": string | null,
  "skills": string[] | null,
  "experienceMin": number | null,
  "experienceMax": number | null,
  "experienceExact": number | null,
  "currentStage": string | null,
  "excludeStage": string | null,
  "stageDuration": {
    "operator": "gt" | "gte" | "lt" | "lte" | "eq",
    "days": number
  } | null,
  "movedToStage": string | null,
  "movedSince": string | null, // preserve raw date phrase e.g. "Monday", "yesterday", "2026-09-20"
  "reachedStage": string | null,
  "notReachedStage": string | null,
  "suggestions": string[] | null
}`;
}

// ─── VALIDATE AND BUILD RESULT ────────────────────────────────────────────────

export function validateAndBuildResult(obj: any, validStages: string[] = ALL_STAGES): AISearchResult {
  if (!obj || typeof obj !== 'object') {
    return {
      filters: {},
      explanation: 'Could not interpret query',
      intent: 'unclear',
      confidence: 0,
      suggestions: ['Try searching by candidate name', 'Show candidates in Interview', 'Find React developers with 3+ years'],
    };
  }

  const validStageSet = new Set(validStages);

  // 1. Stage fields validation
  const stageFields: (keyof SearchFilters)[] = ['currentStage', 'excludeStage', 'movedToStage', 'reachedStage', 'notReachedStage'];
  for (const field of stageFields) {
    if (obj[field] && typeof obj[field] === 'string') {
      const stageStr = obj[field].trim();
      if (!validStageSet.has(stageStr)) {
        const closest = findClosestStage(stageStr);
        obj[field] = closest || null;
      }
    } else {
      obj[field] = null;
    }
  }

  // 2. Resolve relative dates
  if (obj.movedSince && typeof obj.movedSince === 'string') {
    const parsedDate = parseRelativeDate(obj.movedSince);
    obj.movedSince = parsedDate || null;
  }

  // 3. Stage duration validation
  let stageDuration: StageDurationFilter | undefined = undefined;
  if (obj.stageDuration && typeof obj.stageDuration === 'object') {
    const validOps: ComparisonOperator[] = ['gt', 'gte', 'lt', 'lte', 'eq'];
    const op = obj.stageDuration.operator;
    const days = Number(obj.stageDuration.days);
    if (validOps.includes(op) && !isNaN(days) && days >= 0) {
      stageDuration = { operator: op, days };
    }
  }

  // 4. Skills array validation
  let skills: string[] | undefined = undefined;
  if (Array.isArray(obj.skills)) {
    const cleaned = obj.skills
      .filter((s: any) => typeof s === 'string' && s.trim().length > 0)
      .map((s: string) => s.trim());
    if (cleaned.length > 0) {
      skills = cleaned;
    }
  } else if (typeof obj.skillsQuery === 'string' && obj.skillsQuery.trim()) {
    // Backward compatibility if model produces skillsQuery
    const cleaned = obj.skillsQuery.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (cleaned.length > 0) skills = cleaned;
  }

  // 5. Numeric fields validation
  const numFields = ['experienceMin', 'experienceMax', 'experienceExact'];
  for (const f of numFields) {
    if (obj[f] !== null && obj[f] !== undefined) {
      const n = Number(obj[f]);
      obj[f] = !isNaN(n) && n >= 0 ? n : null;
    } else {
      obj[f] = null;
    }
  }

  // 6. Build filters object
  const filters: SearchFilters = {};

  if (typeof obj.nameQuery === 'string' && obj.nameQuery.trim()) filters.nameQuery = obj.nameQuery.trim();
  if (typeof obj.vacancyQuery === 'string' && obj.vacancyQuery.trim()) filters.vacancyQuery = obj.vacancyQuery.trim();
  if (typeof obj.locationQuery === 'string' && obj.locationQuery.trim()) filters.locationQuery = obj.locationQuery.trim();
  if (typeof obj.addressQuery === 'string' && obj.addressQuery.trim()) filters.addressQuery = obj.addressQuery.trim();
  if (typeof obj.emailQuery === 'string' && obj.emailQuery.trim()) filters.emailQuery = obj.emailQuery.trim();
  if (typeof obj.phoneQuery === 'string' && obj.phoneQuery.trim()) filters.phoneQuery = obj.phoneQuery.trim();
  if (typeof obj.notesQuery === 'string' && obj.notesQuery.trim()) filters.notesQuery = obj.notesQuery.trim();
  if (typeof obj.dobQuery === 'string' && obj.dobQuery.trim()) filters.dobQuery = obj.dobQuery.trim();
  if (typeof obj.generalQuery === 'string' && obj.generalQuery.trim()) filters.generalQuery = obj.generalQuery.trim();

  if (skills && skills.length > 0) filters.skills = skills;
  if (stageDuration) filters.stageDuration = stageDuration;

  if (obj.currentStage) filters.currentStage = obj.currentStage;
  if (obj.excludeStage) filters.excludeStage = obj.excludeStage;
  if (obj.movedToStage) filters.movedToStage = obj.movedToStage;
  if (obj.movedSince) filters.movedSince = obj.movedSince;
  if (obj.reachedStage) filters.reachedStage = obj.reachedStage;
  if (obj.notReachedStage) filters.notReachedStage = obj.notReachedStage;

  if (obj.experienceMin !== null && obj.experienceMin !== undefined) filters.experienceMin = obj.experienceMin;
  if (obj.experienceMax !== null && obj.experienceMax !== undefined) filters.experienceMax = obj.experienceMax;
  if (obj.experienceExact !== null && obj.experienceExact !== undefined) filters.experienceExact = obj.experienceExact;

  if (typeof obj.hasLinkedin === 'boolean') filters.hasLinkedin = obj.hasLinkedin;
  if (typeof obj.hasGithub === 'boolean') filters.hasGithub = obj.hasGithub;

  // 7. Intent and explanation
  const intent: 'search' | 'filter' | 'unclear' =
    obj.intent === 'search' || obj.intent === 'filter' || obj.intent === 'unclear'
      ? obj.intent
      : 'search';

  const suggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 4)
    : undefined;

  return {
    filters,
    explanation: typeof obj.explanation === 'string' && obj.explanation.trim() ? obj.explanation.trim() : 'Search completed',
    intent,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : (intent === 'unclear' ? 0.2 : 0.9),
    suggestions,
    message: typeof obj.message === 'string' ? obj.message : undefined,
  };
}

// ─── MAIN EXPORT: INTERPRET WITH GROQ ─────────────────────────────────────────

export async function interpretWithAI(
  query: string,
  validStages: string[] = ALL_STAGES
): Promise<AISearchResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groq = new Groq({ apiKey });
  const model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

  try {
    const result = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: buildSystemPrompt(validStages) },
        { role: 'user', content: `Query: ${JSON.stringify(query.trim())}` },
      ],
      model,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const text = result.choices[0]?.message?.content?.trim() || '';

    // Extract JSON safely
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[NLP] Groq returned no JSON:', text);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return validateAndBuildResult(parsed, validStages);
  } catch (err: any) {
    console.warn(`[NLP Fallback] Groq API unavailable: ${err.message || 'Unknown error'}`);
    return null;
  }
}
