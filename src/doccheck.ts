/**
 * doccheck.ts
 * Rule-based doc/contract/spec check (NO LLM)
 *
 * Config-driven: rules are defined in .reviewagent.yml (DocCheckConfig).
 * When any file in trigger_globs changes, at least one file in require_any_of_globs
 * must also change; otherwise a Finding is emitted.
 */

import crypto from 'node:crypto';
import { minimatch } from 'minimatch';

import type { Finding, Severity, Category } from './review_result';

// ── Public types ───────────────────────────────────────────────────────────────

export interface DocCheckConfig {
  enable: boolean;

  rules: Array<{
    id: string;
    enable: boolean;
    severity: Severity;
    category: Category;
    title: string;

    trigger_globs: string[];
    require_any_of_globs: string[];

    /** Ignore trigger matches if they also match these globs */
    exclude_trigger_globs?: string[];

    /** Optional hint text */
    detail?: string;
    suggestion?: string;
  }>;

  /**
   * If only doc files changed, emit an informational NIT finding.
   */
  doc_only_detection?: {
    enable: boolean;
    doc_globs: string[];
    severity: Severity;
  };
}

export interface DocCheckResult {
  passed: boolean;
  findings: Finding[];
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function runDocCheck(changedFiles: string[], config: DocCheckConfig): DocCheckResult {
  if (!config?.enable) return { passed: true, findings: [] };

  const findings: Finding[] = [];
  const uniqueFiles = Array.from(new Set(changedFiles)).sort();

  const matchesAny = (p: string, globs: string[] | undefined): boolean => {
    if (!globs || globs.length === 0) return false;
    return globs.some(g => minimatch(p, g, { dot: true, nocase: false }));
  };

  const filterMatches = (globs: string[]): string[] =>
    uniqueFiles.filter(p => matchesAny(p, globs));

  // Optional: doc-only detection (informational)
  if (config.doc_only_detection?.enable) {
    const docGlobs     = config.doc_only_detection.doc_globs ?? [];
    const docChanged   = filterMatches(docGlobs);
    const nonDocChanged = uniqueFiles.filter(p => !matchesAny(p, docGlobs));

    if (docChanged.length > 0 && nonDocChanged.length === 0) {
      findings.push(
        makeFinding({
          ruleId:     'DOC_ONLY',
          severity:   config.doc_only_detection.severity ?? 'NIT',
          category:   'doc',
          title:      '문서만 변경됨',
          detail:
            '변경 파일이 문서 범위로만 감지되었습니다. (코드 리뷰 강도를 낮추는 모드가 있다면 적용 가능)',
          suggestion: null,
          references: docChanged,
        }),
      );
    }
  }

  // Main rules
  for (const rule of config.rules ?? []) {
    if (!rule.enable) continue;

    const triggered = filterMatches(rule.trigger_globs);
    if (triggered.length === 0) continue;

    // Apply exclude_trigger_globs
    const triggeredAfterExclude =
      rule.exclude_trigger_globs && rule.exclude_trigger_globs.length > 0
        ? triggered.filter(p => !matchesAny(p, rule.exclude_trigger_globs))
        : triggered;

    if (triggeredAfterExclude.length === 0) continue;

    const requiredHits = filterMatches(rule.require_any_of_globs);

    if (requiredHits.length === 0) {
      const detail =
        rule.detail ??
        [
          '트리거 변경이 감지되었지만, 요구 문서/스펙/계약 파일 변경이 함께 감지되지 않았습니다.',
          '',
          `- Trigger matches: ${triggeredAfterExclude.length} file(s)`,
          `- Required doc matches: 0 file(s)`,
        ].join('\n');

      const suggestion =
        rule.suggestion ??
        'README/docs/SPEC/CONTRACT 등 관련 문서를 업데이트하거나, 설정(.reviewagent.yml)에서 요구 경로를 조정하세요.';

      findings.push(
        makeFinding({
          ruleId:     rule.id,
          severity:   rule.severity,
          category:   rule.category ?? 'doc',
          title:      rule.title,
          detail,
          suggestion,
          references: [
            ...triggeredAfterExclude.map(p => `trigger:${p}`),
            ...rule.require_any_of_globs.map(g => `required_glob:${g}`),
          ],
        }),
      );
    }
  }

  const passed = findings.every(f => f.severity !== 'BLOCKER' && f.severity !== 'MAJOR');

  return { passed, findings };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function makeFinding(args: {
  ruleId:     string;
  severity:   Severity;
  category:   Category;
  title:      string;
  detail:     string;
  suggestion: string | null;
  references: string[] | null;
}): Finding {
  const stable = `${args.ruleId}|${args.severity}|${args.category}|${args.title}|${args.detail}`;
  const id     = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);

  return {
    id,
    severity:   args.severity,
    category:   args.category,
    title:      args.title,
    detail:     args.detail,
    suggestion: args.suggestion,
    path:       null,
    line_range: { start: null, end: null },
    patch:      null,
    references: args.references,
  };
}
