/**
 * redact.ts — Sensitive file filtering + secret redaction
 *
 * Three-stage pipeline before LLM submission:
 *   1) Exclude sensitive paths (config excludeGlobs + built-in patterns)
 *   2) Mask secret patterns ([REDACTED] substitution)
 *   3) Apply diff length limit (truncate if exceeds maxChars)
 */
import { matchesAny } from './glob';
import type { ExcludedReason } from './review_result';

// ── Built-in sensitive path patterns ──────────────────────────────────────────

const BUILTIN_SENSITIVE_GLOBS: string[] = [
  '.env*',
  '**/*credential*',
  '**/*credentials*',
  '**/*secret*',
  '**/*secrets*',
  '**/*key*',
  '**/*keys*',
  'dist/**',
  'build/**',
  'node_modules/**',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  '*.lock',
];

// ── Built-in secret regex patterns ────────────────────────────────────────────

const BUILTIN_SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9+/=_\-]{20,}/gi,
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{18,}\b/g,
  /Authorization:\s*Bearer\s+[A-Za-z0-9+/=._\-]{20,}/gi,
];

// ── Public API ─────────────────────────────────────────────────────────────────

export interface RedactResult {
  filteredFiles:   string[];
  excludedFiles:   string[];
  excludedReasons: ExcludedReason[];
  redactedDiff:    string;
  truncated:       boolean;
  originalLength:  number;
  finalLength:     number;
}

export interface RedactOptions {
  /** Extra exclude globs from .reviewagent.yml */
  extraExcludeGlobs?:    string[];
  /** Extra regex patterns (strings) from .reviewagent.yml */
  extraRedactPatterns?:  string[];
}

/**
 * Pre-processes changed files and raw diff before LLM submission.
 */
export function prepareForLlm(
  changedFiles: string[],
  rawDiff:      string,
  maxChars:     number,
  options:      RedactOptions = {},
): RedactResult {
  const sensitiveGlobs = [
    ...BUILTIN_SENSITIVE_GLOBS,
    ...(options.extraExcludeGlobs ?? []),
  ];

  // 1. Separate sensitive paths
  const excludedFiles:   string[]         = [];
  const excludedReasons: ExcludedReason[] = [];
  const filteredFiles:   string[]         = [];

  for (const f of changedFiles) {
    if (matchesAny(f, sensitiveGlobs)) {
      excludedFiles.push(f);
      excludedReasons.push({ path: f, reason: 'excluded_glob' });
    } else {
      filteredFiles.push(f);
    }
  }

  // 2. Remove sensitive file diff blocks
  let redacted = excludedFiles.length > 0
    ? removeSensitiveFileDiffs(rawDiff, excludedFiles)
    : rawDiff;

  // 3. Mask built-in secret patterns
  for (const pattern of BUILTIN_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }

  // 4. Mask extra patterns from config
  for (const patternStr of options.extraRedactPatterns ?? []) {
    try {
      const re = new RegExp(patternStr, 'g');
      redacted = redacted.replace(re, '[REDACTED]');
    } catch {
      console.warn(`[redact] Invalid regex pattern: ${patternStr}`);
    }
  }

  const originalLength = redacted.length;

  // 5. Truncate if over limit
  let truncated = false;
  if (redacted.length > maxChars) {
    redacted =
      redacted.slice(0, maxChars) +
      `\n\n[DIFF TRUNCATED — exceeded ${maxChars} chars. ` +
      `${redacted.length - maxChars} chars omitted.]`;
    truncated = true;
  }

  return {
    filteredFiles,
    excludedFiles,
    excludedReasons,
    redactedDiff:  redacted,
    truncated,
    originalLength,
    finalLength:   redacted.length,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function removeSensitiveFileDiffs(diff: string, sensitiveFiles: string[]): string {
  const blocks = diff.split(/(?=^diff --git )/m);

  const safe = blocks.filter(block =>
    !sensitiveFiles.some(
      f => block.includes(` b/${f}`) || block.includes(` a/${f}`),
    ),
  );

  if (safe.length < blocks.length) {
    const removed     = blocks.length - safe.length;
    const placeholder = `[${removed} sensitive file diff block(s) removed before LLM transmission]\n`;
    return placeholder + safe.join('');
  }

  return safe.join('');
}
