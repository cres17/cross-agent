/**
 * llm.ts — LLM review call module
 *
 * Fills the prompt template and calls the Claude API.
 * Returns an LlmReviewSection (contract v1 schema).
 *
 * Model: AgentConfig.llm.model (default: claude-opus-4-6)
 * SDK: @anthropic-ai/sdk
 */
import Anthropic from '@anthropic-ai/sdk';

import type { LlmReviewSection } from './review_result';
import type { AgentConfig }      from './config';
import { parseLlmResponse }      from './mapper';

// ── Prompt template ────────────────────────────────────────────────────────────

const PROMPT_TEMPLATE = `You are a senior software reviewer acting as an automated pull request review agent.

Your task:
- Analyze a Git diff (not the full repository).
- Identify correctness issues, edge cases, security risks, performance concerns, API/contract mismatches, missing tests, and documentation inconsistencies.
- Provide precise, technically grounded feedback.
- Avoid speculation beyond the provided diff.
- Do NOT invent missing context.
- If information is insufficient, explicitly state that the information is insufficient.

STRICT OUTPUT REQUIREMENT:
You MUST return a single valid JSON object.
Do NOT include markdown.
Do NOT include explanations outside JSON.
Do NOT include code fences.
Do NOT include commentary outside the defined schema.

Your output MUST strictly follow this structure:

{
  "llm_review": {
    "model": "{{model}}",
    "findings": [
      {
        "severity": "BLOCKER | MAJOR | MINOR | NIT",
        "category": "doc | api | security | bug | performance | test | style | build | other",
        "title": "<short title>",
        "detail": "<clear technical explanation>",
        "suggestion": "<specific improvement suggestion or null>",
        "path": "<file path or null>",
        "line_range": { "start": <number or null>, "end": <number or null> },
        "patch": "<optional diff snippet or null>",
        "references": ["<optional references>"] or null
      }
    ],
    "summary": {
      "blocker": <number>,
      "major": <number>,
      "minor": <number>,
      "nit": <number>,
      "recommended_action": "merge_blocked | needs_fix | ok",
      "highlights": ["<short bullet points>"]
    }
  }
}

Severity definition:
- BLOCKER: merge must not proceed.
- MAJOR: significant risk or correctness issue.
- MINOR: improvement recommended.
- NIT: stylistic or minor observation.

Evaluation rules:
- Only comment on changed lines or direct consequences of them.
- Prefer actionable, specific suggestions.
- Avoid generic advice.
- Do not restate the diff.
- If no issues found, return empty findings and recommended_action="ok".

PR Review Context:

Repository: {{repo_name}}
Base SHA: {{base_sha}}
Head SHA: {{head_sha}}

Changed Files (filtered):
{{changed_files_list}}

DocCheck Result (rule-based, no LLM):
{{doccheck_json_summary}}

Configuration Summary:
- Mode: {{mode}}  (diff_only or full_files)
- Max diff chars: {{max_diff_chars}}
- Excluded sensitive paths already removed.
- Redaction already applied.

IMPORTANT:
- The input below is a sanitized Git diff.
- Do NOT assume access to full repository context.
- If necessary context is missing, explicitly state "insufficient information".

Git Diff:
==========
{{redacted_diff}}
==========

Instructions:
1. Focus on correctness, security, performance, API/contract consistency, test coverage.
2. Cross-check DocCheck findings against the diff and highlight inconsistencies.
3. Detect breaking changes.
4. Flag risky refactors.
5. Identify missing validation, error handling, null checks.
6. Identify silent behavior changes.
7. Be precise and technical.
8. Return JSON only.

You are an automated PR review agent.
Analyze only the provided diff.
Return STRICT JSON matching the schema.
No markdown. No explanations outside JSON.

Focus:
- correctness
- security
- breaking changes
- performance regressions
- missing tests
- doc mismatch

If no issues, return empty findings and recommended_action="ok".`;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LlmReviewParams {
  repoName:        string;
  baseSha:         string;
  headSha:         string;
  filteredFiles:   string[];
  doccheckSummary: string;
  config:          AgentConfig;
  redactedDiff:    string;
  truncated:       boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Calls the Claude API and returns an LlmReviewSection.
 * Throws on failure (caller applies failOnError policy).
 */
export async function runLlmReview(params: LlmReviewParams): Promise<LlmReviewSection> {
  const client = new Anthropic();
  const prompt = buildPrompt(params);

  const message = await client.messages.create({
    model:      params.config.llm.model,
    max_tokens: 4096,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text'
    ? message.content[0].text.trim()
    : '';

  const tokens = {
    prompt:     message.usage?.input_tokens  ?? null,
    completion: message.usage?.output_tokens ?? null,
    total:      message.usage
      ? (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0)
      : null,
  };

  const raw = parseResponse(text);
  return parseLlmResponse(raw, params.config.llm.model, tokens);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function buildPrompt(params: LlmReviewParams): string {
  const {
    repoName, baseSha, headSha,
    filteredFiles, doccheckSummary,
    config, redactedDiff, truncated,
  } = params;

  const filesList = filteredFiles.length > 0
    ? filteredFiles.map(f => `  - ${f}`).join('\n')
    : '  (all changed files were excluded as sensitive)';

  const diffContent = truncated
    ? redactedDiff
    : redactedDiff || '(empty diff — no changed content available)';

  return PROMPT_TEMPLATE
    .replace('{{model}}',               config.llm.model)
    .replace('{{repo_name}}',           repoName)
    .replace('{{base_sha}}',            baseSha)
    .replace('{{head_sha}}',            headSha)
    .replace('{{changed_files_list}}',  filesList)
    .replace('{{doccheck_json_summary}}', doccheckSummary)
    .replace('{{mode}}',                config.mode)
    .replace('{{max_diff_chars}}',      String(config.maxDiffChars))
    .replace('{{redacted_diff}}',       diffContent);
}

function parseResponse(text: string): { findings: unknown[] } {
  // Strip code fences if present
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr   = codeBlock ? codeBlock[1].trim() : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (!objMatch) {
      throw new Error(
        `LLM did not return parseable JSON. Raw (first 500 chars):\n${text.slice(0, 500)}`,
      );
    }
    parsed = JSON.parse(objMatch[0]);
  }

  const root = parsed as Record<string, unknown>;
  const raw  = root['llm_review'] as Record<string, unknown> | undefined;

  if (!raw || !Array.isArray(raw['findings'])) {
    throw new Error(
      `LLM response missing "llm_review.findings". Keys: ${Object.keys(root).join(', ')}`,
    );
  }

  return raw as { findings: unknown[] };
}
