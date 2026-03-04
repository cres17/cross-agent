/**
 * review_result.ts
 * Contract schema v1 type definitions + builder helper
 * Based on docs/contract.md
 */

// ── Shared primitives ──────────────────────────────────────────────────────────

export type Severity = 'BLOCKER' | 'MAJOR' | 'MINOR' | 'NIT';

export type Category =
  | 'doc'
  | 'api'
  | 'security'
  | 'bug'
  | 'performance'
  | 'test'
  | 'style'
  | 'build'
  | 'other';

// ── Finding (unified — used by both DocCheck and LLM Review) ───────────────────

export interface Finding {
  /** Stable hash, e.g. sha256(ruleId|severity|category|title|detail).slice(0,16) */
  id: string;
  severity:   Severity;
  category:   Category;
  title:      string;
  detail:     string;
  suggestion: string | null;
  path:       string | null;
  line_range: { start: number | null; end: number | null };
  patch:      string | null;
  references: string[] | null;
}

// ── Meta ───────────────────────────────────────────────────────────────────────

export interface Meta {
  tool_name:    string;
  tool_version: string;
  run_id:       string;
  timestamp:    string;
  repo:         string | null;
  pr_number:    number | null;
  base_sha:     string;
  head_sha:     string;
  config_path:  string | null;
  mode:         'diff_only' | 'full_files';
  status:       'ok' | 'warning' | 'error';
}

// ── Inputs ─────────────────────────────────────────────────────────────────────

export interface ExcludedReason {
  path:   string;
  reason: 'excluded_glob' | 'too_large' | 'binary' | 'redaction_block' | 'unknown';
}

export interface Inputs {
  changed_files:  number;
  included_files: number;
  excluded_files: number;
  diff_chars:     number;
  limits: {
    max_changed_files: number;
    max_diff_chars:    number;
  };
  excluded_reasons: ExcludedReason[];
}

// ── DocCheck section ───────────────────────────────────────────────────────────

export interface DocCheckSection {
  passed:   boolean;
  findings: Finding[];
}

// ── LLM Review section ─────────────────────────────────────────────────────────

export interface LlmReviewSection {
  findings: Finding[];
  model:    string;
  tokens: {
    prompt:     number | null;
    completion: number | null;
    total:      number | null;
  };
}

// ── Summary ────────────────────────────────────────────────────────────────────

export type RecommendedAction = 'merge_blocked' | 'needs_fix' | 'ok';

export interface Summary {
  counts: {
    blocker: number;
    major:   number;
    minor:   number;
    nit:     number;
  };
  recommended_action: RecommendedAction;
  highlights: string[];
}

// ── Top-level result ──────────────────────────────────────────────────────────

export interface ReviewResult {
  meta:        Meta;
  inputs:      Inputs;
  doccheck:    DocCheckSection;
  llm_review:  LlmReviewSection;
  summary:     Summary;
}

// ── Builder ────────────────────────────────────────────────────────────────────

export function buildSummary(
  doccheckFindings: Finding[],
  llmFindings:      Finding[],
): Summary {
  const all = [...doccheckFindings, ...llmFindings];

  const counts = {
    blocker: all.filter(f => f.severity === 'BLOCKER').length,
    major:   all.filter(f => f.severity === 'MAJOR').length,
    minor:   all.filter(f => f.severity === 'MINOR').length,
    nit:     all.filter(f => f.severity === 'NIT').length,
  };

  let recommended_action: RecommendedAction = 'ok';
  if (counts.blocker > 0) {
    recommended_action = 'merge_blocked';
  } else if (counts.major > 0) {
    recommended_action = 'needs_fix';
  }

  const highlights: string[] = all
    .filter(f => f.severity === 'BLOCKER' || f.severity === 'MAJOR')
    .slice(0, 5)
    .map(f => `[${f.severity}] ${f.title}`);

  return { counts, recommended_action, highlights };
}
