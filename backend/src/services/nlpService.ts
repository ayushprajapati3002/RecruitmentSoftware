import Groq from 'groq-sdk';
import { findClosestStage } from '../utils/stageUtils';
import { parseRelativeDate } from '../utils/dateUtils';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SearchFilters {
  // Text searches (fuzzy / LIKE)
  nameQuery?: string;
  emailQuery?: string;
  phoneQuery?: string;
  vacancyQuery?: string;
  locationQuery?: string;
  addressQuery?: string;
  skillsQuery?: string;      // comma-separated skills to match
  notesQuery?: string;
  dobQuery?: string;
  generalQuery?: string;      // fallback free text across all fields

  // Existence filters
  hasLinkedin?: boolean;
  hasGithub?: boolean;

  // Numeric filters
  experienceMin?: number;
  experienceMax?: number;
  experienceExact?: number;

  // Stage filters
  currentStage?: string;
  excludeStage?: string;

  // Duration filter
  minDaysInStage?: number;

  // History-based
  movedToStage?: string;
  movedSince?: string;        // ISO date string
  reachedStage?: string;
  notReachedStage?: string;
}

export interface GeminiSearchResult {
  filters: SearchFilters;
  explanation: string;
  intent: 'search' | 'filter' | 'unclear';
  suggestions?: string[];
  message?: string;
}

// ─── GEMINI SYSTEM PROMPT ─────────────────────────────────────────────────────
// This prompt is the ENTIRE brain of the search system.
// No hardcoded word lists, no regex patterns — Gemini handles everything.

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  return `You are a recruiter AI. Convert natural-language search queries into JSON.
CRITICAL RULE: Output ONLY raw JSON. No markdown, no <think> blocks, no reasoning. Keep "explanation" under 10 words.

JSON SCHEMA:
{
  "intent": "search" | "filter" | "unclear",
  "explanation": "Short summary",
  "nameQuery": string | null,
  "vacancyQuery": string | null,
  "locationQuery": string | null,
  "skillsQuery": string | null,
  "experienceMin": number | null,
  "experienceMax": number | null,
  "currentStage": "Applied" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected" | null,
  "minDaysInStage": number | null,
  "movedToStage": string | null,
  "movedSince": "YYYY-MM-DD" | null,
  "reachedStage": string | null,
  "notReachedStage": string | null,
  "suggestions": string[] | null
}

RULES:
- "everyone" or empty -> intent: filter (all null)
- "software engineer" -> vacancyQuery: "Software Engineer"
- "data engineer" -> vacancyQuery: "Data Engineer"
- "rejected" -> currentStage: "Rejected"
- "applied" -> currentStage: "Applied"
- "React" -> skillsQuery: "React"
- "stuck for 5 days" -> minDaysInStage: 5
- "reached Interview but not Offer" -> reachedStage: "Interview", notReachedStage: "Offer"
- A bare role/job-title phrase with no search verb ("data engineer", "business analyst") -> vacancyQuery, NOT nameQuery.
- If unclear, give 3 suggestions.`;
}

// ─── VALIDATE & BUILD RESULT ──────────────────────────────────────────────────
// Sanitizes Gemini's JSON output — whitelists fields, validates stages,
// resolves date placeholders, and strips invalid values.

function validateAndBuildResult(obj: any): GeminiSearchResult {
  if (!obj) {
    return {
      filters: {},
      explanation: '',
      intent: 'unclear',
      message: 'Failed to parse search query.',
      suggestions: ['Try searching by candidate name', 'Show Interview candidates'],
    };
  }

  // ── Validate stage fields ──────────────────────────────────────────
  const validStages = new Set(['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected']);
  const stageFields = ['currentStage', 'excludeStage', 'movedToStage', 'reachedStage', 'notReachedStage'];
  for (const field of stageFields) {
    if (obj[field] && typeof obj[field] === 'string') {
      if (!validStages.has(obj[field])) {
        // Try to fix typos with closest stage match
        const closest = findClosestStage(obj[field]);
        obj[field] = closest || null;
      }
    }
  }

  // ── Resolve relative dates in movedSince ───────────────────────────
  if (obj.movedSince && typeof obj.movedSince === 'string') {
    // First try our local date parser (handles "Monday", "yesterday", etc.)
    const localParsed = parseRelativeDate(obj.movedSince);
    if (localParsed) {
      obj.movedSince = localParsed;
    } else {
      // Try parsing as ISO date
      const d = new Date(obj.movedSince);
      obj.movedSince = isNaN(d.getTime()) ? null : d.toISOString();
    }
  }

  // ── Validate numeric fields ────────────────────────────────────────
  const numericFields = ['experienceMin', 'experienceMax', 'experienceExact', 'minDaysInStage'];
  for (const field of numericFields) {
    if (obj[field] !== null && obj[field] !== undefined) {
      const num = Number(obj[field]);
      if (isNaN(num) || num < 0) {
        obj[field] = null;
      } else {
        obj[field] = num;
      }
    }
  }

  // ── Build safe filters object (whitelist only known fields) ────────
  const filters: SearchFilters = {};

  // String fields
  const stringFields: (keyof SearchFilters)[] = [
    'nameQuery', 'emailQuery', 'phoneQuery', 'vacancyQuery',
    'locationQuery', 'addressQuery', 'skillsQuery', 'notesQuery',
    'dobQuery', 'currentStage', 'excludeStage', 'movedToStage',
    'movedSince', 'reachedStage', 'notReachedStage', 'generalQuery',
  ];
  for (const f of stringFields) {
    if (typeof obj[f] === 'string' && obj[f].trim()) {
      (filters as any)[f] = obj[f].trim();
    }
  }

  // Numeric fields
  for (const f of numericFields) {
    if (typeof obj[f] === 'number' && obj[f] >= 0) {
      (filters as any)[f] = obj[f];
    }
  }

  // Boolean fields
  const boolFields: (keyof SearchFilters)[] = ['hasLinkedin', 'hasGithub'];
  for (const f of boolFields) {
    if (typeof obj[f] === 'boolean') {
      (filters as any)[f] = obj[f];
    }
  }

  // ── Build result ───────────────────────────────────────────────────
  const intent = obj.intent === 'search' || obj.intent === 'filter' || obj.intent === 'unclear'
    ? obj.intent
    : 'unclear';

  return {
    filters,
    explanation: typeof obj.explanation === 'string' ? obj.explanation : '',
    intent,
    suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.filter((s: any) => typeof s === 'string').slice(0, 5) : undefined,
    message: typeof obj.message === 'string' ? obj.message : undefined,
  };
}

// ─── MAIN EXPORT: INTERPRET WITH GROQ ─────────────────────────────────────────

export async function interpretWithAI(query: string): Promise<GeminiSearchResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groq = new Groq({ apiKey });

  try {
    const result = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: `Query: "${query}"` },
      ],
      model: 'qwen/qwen3.8-27b',
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    
    const text = result.choices[0]?.message?.content?.trim() || '';

    // Extract JSON from response (handle possible markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Groq returned no JSON:', text);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[NLP] Raw parsed JSON for query "${query}":\n`, JSON.stringify(parsed, null, 2));
    return validateAndBuildResult(parsed);
  } catch (err: any) {
    // Log a shorter warning instead of full stack trace to keep the terminal clean during overload
    console.warn(`[NLP Fallback] Groq API unavailable: ${err.message || 'Unknown error'}`);
    return null;
  }
}

