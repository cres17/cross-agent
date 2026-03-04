/**
 * mapper.ts — LLM raw response → LlmReviewSection
 *
 * The LLM prompt returns findings with Severity (BLOCKER/MAJOR/MINOR/NIT)
 * which already matches the unified contract schema.
 * This module parses the raw LLM JSON and returns an LlmReviewSection.
 */
import crypto from 'node:crypto';
import type { Finding, LlmReviewSection } from './review_result';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Raw shape returned by the LLM (may be missing id field) */
interface RawLlmFinding {
  severity:   string;
  category:   string;
  title:      string;
  detail:     string;
  suggestion: string | null;
  path:       string | null;
  line_range: { start: number | null; end: number | null } | null;
  patch:      string | null;
  references: string[] | null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse the LLM raw response object into an LlmReviewSection.
 * Accepts unknown[] because LLM output shape is unverified at runtime.
 * Assigns stable IDs to each finding.
 */
export function parseLlmResponse(
  raw:    { findings: unknown[] },
  model:  string,
  tokens: { prompt: number | null; completion: number | null; total: number | null },
): LlmReviewSection {
  const findings: Finding[] = (raw.findings ?? []).map(f => normalizeFinding(f as RawLlmFinding));

  return {
    findings,
    model,
    tokens,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function normalizeFinding(raw: RawLlmFinding): Finding {
  const severity = normalizeSeverity(raw.severity);
  const category = normalizeCategory(raw.category);

  const stable = `${raw.title}|${severity}|${category}|${raw.detail ?? ''}`;
  const id     = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);

  return {
    id,
    severity,
    category,
    title:      raw.title      ?? '(no title)',
    detail:     raw.detail     ?? '',
    suggestion: raw.suggestion ?? null,
    path:       raw.path       ?? null,
    line_range: raw.line_range ?? { start: null, end: null },
    patch:      raw.patch      ?? null,
    references: raw.references ?? null,
  };
}

function normalizeSeverity(s: string): Finding['severity'] {
  switch ((s ?? '').toUpperCase()) {
    case 'BLOCKER': return 'BLOCKER';
    case 'MAJOR':   return 'MAJOR';
    case 'MINOR':   return 'MINOR';
    case 'NIT':     return 'NIT';
    default:        return 'NIT';
  }
}

function normalizeCategory(c: string): Finding['category'] {
  const valid = ['doc','api','security','bug','performance','test','style','build','other'] as const;
  return (valid as readonly string[]).includes(c) ? c as Finding['category'] : 'other';
}
