/**
 * cli.ts — Main entry point (DocCheck + LLM Review pipeline)
 *
 * Execution order:
 *   1.  Load config (.reviewagent.yml + env vars)
 *   2.  Detect fork PR (fork → LLM/comment disabled)
 *   3.  Resolve base/head SHA
 *   4.  Collect changed files + apply file count limit
 *   5.  DocCheck (rule-based, always runs)
 *   6.  Prepare diff: filter + redact + truncate (if LLM active)
 *   7.  LLM review (Claude API, if active)
 *   8.  Build summary from all findings
 *   9.  Write outputs (out/review_result.json + out/review_report.md)
 *
 * Exit codes:
 *   0 — ok / needs_fix
 *   1 — merge_blocked or runtime error
 */
import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { loadConfig }                            from './config';
import { resolveShas, getChangedFiles, getDiff } from './git';
import { runDocCheck }                           from './doccheck';
import { prepareForLlm }                         from './redact';
import { runLlmReview }                          from './llm';
import { buildSummary }                          from './review_result';

import type {
  ReviewResult,
  Meta,
  Inputs,
  DocCheckSection,
  LlmReviewSection,
  Finding,
} from './review_result';

const OUT_DIR      = path.resolve(process.cwd(), 'out');
const TOOL_VERSION = '0.1.0';

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();

  // 1. Load config
  const config = loadConfig();
  console.log(
    `[cli] Config — mode=${config.mode}, ` +
    `llm.enabled=${config.llm.enabled}, ` +
    `llm.model=${config.llm.model}, ` +
    `maxDiffChars=${config.maxDiffChars}, ` +
    `maxChangedFiles=${config.maxChangedFiles}, ` +
    `configPath=${config.configPath ?? '(none)'}`,
  );
  console.log(`[cli] DocCheck rules: ${config.doccheck.rules.length}, enabled=${config.doccheck.enable}`);

  // 2. Fork PR detection (forks can't access secrets → LLM disabled)
  const isFork = detectForkPr();
  if (isFork) {
    console.warn('[cli] Fork PR detected — LLM review disabled (secrets unavailable)');
  }

  const llmActive =
    config.llm.enabled &&
    !isFork &&
    Boolean(process.env['ANTHROPIC_API_KEY']);

  if (config.llm.enabled && !isFork && !process.env['ANTHROPIC_API_KEY']) {
    console.warn('[cli] ANTHROPIC_API_KEY not set — LLM review skipped');
  }

  // 3. Resolve SHAs
  const { base, head } = resolveShas();
  console.log(`[cli] base=${base}  head=${head}`);

  // 4. Changed files
  const allChangedFiles = getChangedFiles(base, head);
  console.log(`[cli] Changed files (${allChangedFiles.length}):`);
  allChangedFiles.forEach(f => console.log(`  • ${f}`));

  if (allChangedFiles.length > config.maxChangedFiles) {
    console.warn(
      `[cli] File count (${allChangedFiles.length}) > MAX_CHANGED_FILES (${config.maxChangedFiles}). ` +
      `Processing first ${config.maxChangedFiles} files only.`,
    );
  }
  const changedFiles = allChangedFiles.slice(0, config.maxChangedFiles);

  // 5. DocCheck (always runs)
  const doccheckResult = runDocCheck(changedFiles, config.doccheck);
  const doccheckSection: DocCheckSection = {
    passed:   doccheckResult.passed,
    findings: doccheckResult.findings,
  };
  console.log(
    `[cli] DocCheck — passed=${doccheckSection.passed}, findings=${doccheckSection.findings.length}`,
  );

  // 6. Diff preparation
  let filteredFiles  = changedFiles;
  let excludedReasons: Inputs['excluded_reasons'] = [];
  let diffChars      = 0;
  let truncated      = false;
  let redactedDiff   = '';

  if (llmActive) {
    const rawDiff    = getDiff(base, head);
    const redactResult = prepareForLlm(changedFiles, rawDiff, config.maxDiffChars, {
      extraExcludeGlobs:   config.excludeGlobs,
      extraRedactPatterns: config.extraRedactPatterns,
    });

    filteredFiles   = redactResult.filteredFiles;
    excludedReasons = redactResult.excludedReasons;
    diffChars       = redactResult.finalLength;
    truncated       = redactResult.truncated;
    redactedDiff    = redactResult.redactedDiff;

    console.log(
      `[cli] Diff — original=${redactResult.originalLength} chars, ` +
      `final=${redactResult.finalLength} chars, truncated=${truncated}`,
    );
    if (redactResult.excludedFiles.length) {
      console.log(`[cli] Excluded sensitive files: ${redactResult.excludedFiles.join(', ')}`);
    }
  }

  // 7. LLM review
  let llmSection: LlmReviewSection = {
    findings: [],
    model:    llmActive ? config.llm.model : '',
    tokens:   { prompt: null, completion: null, total: null },
  };
  let llmError: string | null = null;

  if (llmActive) {
    try {
      console.log(`[cli] Running LLM review (model=${config.llm.model})…`);
      llmSection = await runLlmReview({
        repoName:        process.env['GITHUB_REPOSITORY'] ?? 'unknown/repo',
        baseSha:         base,
        headSha:         head,
        filteredFiles,
        doccheckSummary: JSON.stringify(doccheckSection, null, 2),
        config,
        redactedDiff,
        truncated,
      });
      console.log(
        `[cli] LLM review done — findings=${llmSection.findings.length}, ` +
        `tokens=${llmSection.tokens.total ?? 'n/a'}`,
      );
    } catch (err) {
      llmError = (err as Error).message;
      console.error(`[cli] LLM review failed: ${llmError}`);
      if (config.llm.failOnError) throw err;
      console.warn('[cli] Continuing with DocCheck-only result (LLM_FAIL_ON_ERROR=false)');
    }
  }

  // 8. Build summary
  const allFindings: Finding[] = [
    ...doccheckSection.findings,
    ...llmSection.findings,
  ];
  const summary = buildSummary(doccheckSection.findings, llmSection.findings);

  const processingMs = Date.now() - t0;

  // 9. Assemble result
  const prNumberRaw = process.env['GITHUB_PR_NUMBER'];
  const prNumber    = prNumberRaw ? parseInt(prNumberRaw, 10) : null;

  const meta: Meta = {
    tool_name:    'review-agent',
    tool_version: TOOL_VERSION,
    run_id:       crypto.randomUUID(),
    timestamp:    new Date().toISOString(),
    repo:         process.env['GITHUB_REPOSITORY'] ?? null,
    pr_number:    prNumber,
    base_sha:     base,
    head_sha:     head,
    config_path:  config.configPath,
    mode:         config.mode,
    status:       llmError ? 'error' : (allFindings.length > 0 ? 'warning' : 'ok'),
  };

  const inputs: Inputs = {
    changed_files:  allChangedFiles.length,
    included_files: filteredFiles.length,
    excluded_files: excludedReasons.length,
    diff_chars:     diffChars,
    limits: {
      max_changed_files: config.maxChangedFiles,
      max_diff_chars:    config.maxDiffChars,
    },
    excluded_reasons: excludedReasons,
  };

  const result: ReviewResult = {
    meta,
    inputs,
    doccheck:   doccheckSection,
    llm_review: llmSection,
    summary,
  };

  // Write outputs
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const jsonPath = path.join(OUT_DIR, 'review_result.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[cli] Written: ${jsonPath}`);

  const mdPath = path.join(OUT_DIR, 'review_report.md');
  fs.writeFileSync(mdPath, buildMarkdownReport(result, llmActive), 'utf8');
  console.log(`[cli] Written: ${mdPath}`);

  console.log(`\n[cli] recommended_action=${summary.recommended_action}  (${processingMs}ms)`);
  process.exit(summary.recommended_action === 'merge_blocked' ? 1 : 0);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function detectForkPr(): boolean {
  const eventPath = process.env['GITHUB_EVENT_PATH'];
  if (!eventPath) return false;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    return event?.pull_request?.head?.repo?.fork === true;
  } catch {
    return false;
  }
}

function buildMarkdownReport(result: ReviewResult, llmWasActive: boolean): string {
  const { meta, inputs, doccheck, llm_review, summary } = result;

  const actionEmoji: Record<string, string> = {
    merge_blocked: '❌',
    needs_fix:     '⚠️',
    ok:            '✅',
  };
  const sevEmoji: Record<string, string> = {
    BLOCKER: '🔴',
    MAJOR:   '🟠',
    MINOR:   '🟡',
    NIT:     '🟢',
  };

  const lines: string[] = [
    `# PR Review Report`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| **Action** | ${actionEmoji[summary.recommended_action] ?? ''} **${summary.recommended_action}** |`,
    `| PR | #${meta.pr_number ?? 'N/A'} |`,
    `| SHA | \`${meta.head_sha.slice(0, 8)}\` |`,
    `| Mode | ${llmWasActive ? 'DocCheck + LLM' : 'DocCheck only (rule-based)'} |`,
    `| Model | ${meta.mode === 'diff_only' ? llm_review.model || '—' : '—'} |`,
    `| Config | ${meta.config_path ?? '(none)'} |`,
    `| Reviewed at | ${meta.timestamp} |`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    `| Severity | Count |`,
    `|---|---|`,
    `| 🔴 BLOCKER | ${summary.counts.blocker} |`,
    `| 🟠 MAJOR   | ${summary.counts.major}   |`,
    `| 🟡 MINOR   | ${summary.counts.minor}   |`,
    `| 🟢 NIT     | ${summary.counts.nit}     |`,
    ``,
  ];

  if (summary.highlights.length) {
    lines.push(`**Highlights:**`);
    summary.highlights.forEach(h => lines.push(`- ${h}`));
    lines.push(``);
  }

  lines.push(`---`, ``, `## Changed Files (${inputs.changed_files})`, ``);
  // We don't store file list in result, just counts
  lines.push(`- Included: ${inputs.included_files}`, `- Excluded: ${inputs.excluded_files}`, ``);

  // DocCheck findings
  if (doccheck.findings.length > 0) {
    lines.push(`---`, ``, `## DocCheck Findings`, ``);
    for (const f of doccheck.findings) {
      lines.push(`### ${sevEmoji[f.severity] ?? ''} [${f.severity}] ${f.title}`, ``);
      lines.push(f.detail, ``);
      if (f.suggestion) {
        lines.push(`**Suggestion:** ${f.suggestion}`, ``);
      }
      if (f.references?.length) {
        lines.push(`**References:**`);
        f.references.forEach(r => lines.push(`- \`${r}\``));
        lines.push(``);
      }
    }
  }

  // LLM findings
  if (llmWasActive && llm_review.findings.length > 0) {
    lines.push(`---`, ``, `## LLM Review Findings`, ``);
    for (const f of llm_review.findings) {
      lines.push(`### ${sevEmoji[f.severity] ?? ''} [${f.severity}] ${f.title}`, ``);
      lines.push(f.detail, ``);
      if (f.suggestion) {
        lines.push(`**Suggestion:** ${f.suggestion}`, ``);
      }
      if (f.path) {
        const lineStr = f.line_range?.start
          ? `:L${f.line_range.start}${f.line_range.end ? `-L${f.line_range.end}` : ''}`
          : '';
        lines.push(`**File:** \`${f.path}${lineStr}\``, ``);
      }
    }
  }

  if (!llmWasActive) {
    lines.push(`---`, ``, `> LLM review was not active. Set \`ANTHROPIC_API_KEY\` to enable full analysis.`, ``);
  }

  return lines.join('\n');
}

main().catch((err: unknown) => {
  console.error('[fatal]', (err as Error).message);
  process.exit(1);
});
