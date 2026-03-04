/**
 * config.ts — Agent configuration loader
 *
 * Priority: .reviewagent.yml → environment variables → defaults
 *
 * Key env vars (override YAML values):
 *   REVIEW_MODE          diff_only | full_files
 *   MAX_DIFF_CHARS       max diff length
 *   MAX_CHANGED_FILES    max changed file count
 *   LLM_MODEL            Claude model ID
 *   LLM_ENABLED          false = disable LLM
 *   LLM_FAIL_ON_ERROR    true = exit 1 on LLM error
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import type { DocCheckConfig } from './doccheck';

export type ReviewMode = 'diff_only' | 'full_files';

export interface AgentConfig {
  mode:             ReviewMode;
  maxDiffChars:     number;
  maxChangedFiles:  number;
  configPath:       string | null;

  /** Globs to include in diff analysis */
  includeGlobs:     string[];
  /** Globs to exclude from diff analysis */
  excludeGlobs:     string[];
  /** Extra redaction regex patterns from config */
  extraRedactPatterns: string[];

  doccheck:         DocCheckConfig;

  llm: {
    model:       string;
    enabled:     boolean;
    failOnError: boolean;
  };

  output: {
    commentMode: 'pr_comment' | 'pr_review' | 'none';
    artifact:    boolean;
  };
}

// ── Default DocCheck config (no rules — opt-in via .reviewagent.yml) ──────────

const DEFAULT_DOCCHECK: DocCheckConfig = {
  enable: false,
  rules:  [],
};

// ── Default globs ─────────────────────────────────────────────────────────────

const DEFAULT_INCLUDE_GLOBS: string[] = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.py', '**/*.go', '**/*.java', '**/*.kt',
  '**/*.md', 'docs/**',
];

const DEFAULT_EXCLUDE_GLOBS: string[] = [
  '**/*.lock', '**/node_modules/**', '**/dist/**',
  '**/build/**', '**/*.min.*', '**/.env*',
  '**/*secret*', '**/*credential*', '**/*key*',
  '**/*.pem', '**/*.p12',
];

// ── Loader ─────────────────────────────────────────────────────────────────────

export function loadConfig(): AgentConfig {
  const configPath  = findConfigFile();
  const fileConfig  = configPath ? loadYaml(configPath) : null;

  // Input section
  const fileInput   = fileConfig?.['input'] as Record<string, unknown> | undefined;

  const modeRaw = (process.env['REVIEW_MODE'] ?? fileInput?.['mode'] ?? 'diff_only') as string;
  const mode: ReviewMode = modeRaw === 'full_files' ? 'full_files' : 'diff_only';
  if (modeRaw !== 'diff_only' && modeRaw !== 'full_files') {
    console.warn(`[config] Unknown mode "${modeRaw}", falling back to "diff_only"`);
  }

  const maxDiffChars    = positiveInt(process.env['MAX_DIFF_CHARS'],    fileInput?.['max_diff_chars'],    180_000);
  const maxChangedFiles = positiveInt(process.env['MAX_CHANGED_FILES'], fileInput?.['max_changed_files'], 60);

  const includeGlobs: string[] =
    (fileInput?.['include_globs'] as string[] | undefined) ?? DEFAULT_INCLUDE_GLOBS;
  const excludeGlobs: string[] =
    (fileInput?.['exclude_globs'] as string[] | undefined) ?? DEFAULT_EXCLUDE_GLOBS;

  // Redaction section
  const redactionSection = fileConfig?.['redaction'] as Record<string, unknown> | undefined;
  const extraRedactPatterns: string[] =
    (redactionSection?.['patterns'] as string[] | undefined) ?? [];

  // DocCheck section
  const rulesSection   = fileConfig?.['rules'] as Record<string, unknown> | undefined;
  const doccheckRaw    = rulesSection?.['doccheck'] as Record<string, unknown> | undefined;
  const doccheck: DocCheckConfig = doccheckRaw
    ? parseDocCheckConfig(doccheckRaw)
    : DEFAULT_DOCCHECK;

  // Output section
  const outputSection = fileConfig?.['output'] as Record<string, unknown> | undefined;
  const commentModeRaw = (outputSection?.['comment_mode'] as string | undefined) ?? 'none';
  const commentMode: 'pr_comment' | 'pr_review' | 'none' =
    commentModeRaw === 'pr_comment' ? 'pr_comment'
    : commentModeRaw === 'pr_review' ? 'pr_review'
    : 'none';

  return {
    mode,
    maxDiffChars,
    maxChangedFiles,
    configPath,
    includeGlobs,
    excludeGlobs,
    extraRedactPatterns,
    doccheck,
    llm: {
      model:       process.env['LLM_MODEL']        ?? 'claude-opus-4-6',
      enabled:     process.env['LLM_ENABLED']       !== 'false',
      failOnError: process.env['LLM_FAIL_ON_ERROR'] === 'true',
    },
    output: {
      commentMode,
      artifact: outputSection?.['artifact'] !== false,
    },
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function findConfigFile(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '.reviewagent.yml'),
    path.resolve(process.cwd(), '.reviewagent.yaml'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadYaml(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return (yaml.load(raw) as Record<string, unknown>) ?? {};
  } catch (err) {
    console.warn(`[config] Failed to parse ${filePath}: ${(err as Error).message}`);
    return {};
  }
}

function parseDocCheckConfig(raw: Record<string, unknown>): DocCheckConfig {
  const docOnly = raw['doc_only_detection'] as Record<string, unknown> | undefined;
  const rulesRaw = (raw['rules'] as unknown[]) ?? [];

  return {
    enable: raw['enable'] !== false,
    doc_only_detection: docOnly
      ? {
          enable:    docOnly['enable'] !== false,
          doc_globs: (docOnly['doc_globs'] as string[] | undefined) ?? ['**/*.md', 'docs/**'],
          severity:  (docOnly['severity'] as string | undefined) as import('./review_result').Severity ?? 'NIT',
        }
      : undefined,
    rules: rulesRaw.map((r: unknown) => {
      const rule = r as Record<string, unknown>;
      return {
        id:       String(rule['id'] ?? ''),
        enable:   rule['enable'] !== false,
        severity: (rule['severity'] as string) as import('./review_result').Severity,
        category: (rule['category'] as string) as import('./review_result').Category,
        title:    String(rule['title'] ?? ''),
        trigger_globs:        (rule['trigger_globs'] as string[]) ?? [],
        require_any_of_globs: (rule['require_any_of_globs'] as string[]) ?? [],
        exclude_trigger_globs: rule['exclude_trigger_globs'] as string[] | undefined,
        detail:     rule['detail'] as string | undefined,
        suggestion: rule['suggestion'] as string | undefined,
      };
    }),
  };
}

function positiveInt(
  envRaw:  string | undefined,
  yamlVal: unknown,
  fallback: number,
): number {
  // env var takes priority
  if (envRaw !== undefined) {
    const n = parseInt(envRaw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // then yaml value
  if (typeof yamlVal === 'number' && yamlVal > 0) return yamlVal;
  return fallback;
}
