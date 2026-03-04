/**
 * reviewer.js
 * Claude API를 호출해 3관점(maintainer/security/docs) 리뷰 JSON을 생성한다.
 * contract gate: LOCKED contract.md가 변경된 경우 즉시 FAIL 반환
 */
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

// ── Contract Gate ─────────────────────────────────────────────────────────────
function isLockedContractViolated(context) {
  const contractContent = context.docs['docs/contract.md'] || '';
  const isLocked = contractContent.includes('Status: LOCKED');
  const contractModified = (context.pr.changed_files || []).some(f =>
    f.includes('contract.md')
  );
  return isLocked && contractModified;
}

function buildLockedContractFailResult(context) {
  return {
    verdict: 'FAIL',
    experts: [
      { name: 'maintainer', findings: [] },
      {
        name: 'security',
        findings: [
          {
            severity: 'HIGH',
            title: 'LOCKED contract.md was modified',
            description:
              'docs/contract.md has Status: LOCKED but appears in the changed files list. ' +
              'This violates the contract policy (Acceptance Criteria D).',
            evidence: ['DOC: docs/contract.md > Status: LOCKED'],
            recommendation:
              'Submit a change request via docs/change-requests/CR-*.md ' +
              'instead of directly modifying the locked contract.',
          },
        ],
      },
      { name: 'docs', findings: [] },
    ],
    doc_updates_needed: [],
    questions: [],
    metadata: {
      pr_number: context.pr.number ?? null,
      sha: context.pr.sha ?? 'unknown',
      reviewed_at: new Date().toISOString(),
      gate: 'LOCKED_CONTRACT_VIOLATION',
    },
  };
}

// ── Prompt Builder ─────────────────────────────────────────────────────────────
function buildPrompt(context) {
  const { pr, docs } = context;

  const docsSection = Object.entries(docs)
    .map(([p, content]) => `### ${p}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const changedFilesSection =
    pr.changed_files?.length
      ? pr.changed_files.map(f => `- ${f}`).join('\n')
      : '(changed files list not available)';

  const diffSection = pr.diff?.trim()
    ? `\`\`\`diff\n${pr.diff}\n\`\`\``
    : '(diff not available)';

  return `You are a PR review agent with 3 expert personas. Analyze the PR below and return a structured JSON review.

## PR Context
- **Title:** ${pr.title}
- **Body:** ${pr.body || '(empty)'}
- **PR Number:** ${pr.number ?? 'N/A'}
- **SHA:** ${pr.sha ?? 'N/A'}

## Changed Files
${changedFilesSection}

## Diff
${diffSection}

## Reference Documents
${docsSection}

## Instructions
Produce a review from exactly 3 expert perspectives:
1. **maintainer** – design, maintainability, test coverage
2. **security** – input validation, secrets, vulnerable patterns
3. **docs** – spec/doc alignment, missing doc updates

Rules:
- Every finding MUST include at least one evidence entry in one of these formats:
  - "CODE: path/to/file: L10-L40"
  - "DOC: path/to/doc.md > Section Header"
- If you cannot find evidence for a concern, add it to "questions" instead (no speculative findings).
- verdict logic:
  - "FAIL" if ANY finding has severity "HIGH"
  - "WARN" if any finding has severity "MEDIUM" (and none are HIGH)
  - "PASS" otherwise
- If docs/contract.md appears in changed files AND contains "Status: LOCKED", add a HIGH finding in security and set verdict to "FAIL".

Respond with ONLY valid JSON (no markdown, no extra text) matching this schema exactly:
{
  "verdict": "PASS" | "WARN" | "FAIL",
  "experts": [
    {
      "name": "maintainer" | "security" | "docs",
      "findings": [
        {
          "severity": "LOW" | "MEDIUM" | "HIGH",
          "title": "string",
          "description": "string",
          "evidence": ["string"],
          "recommendation": "string"
        }
      ]
    }
  ],
  "doc_updates_needed": [
    {
      "doc_path": "string",
      "reason": "string",
      "evidence": ["string"]
    }
  ],
  "questions": ["string"],
  "metadata": {
    "pr_number": ${pr.number ?? null},
    "sha": "${pr.sha ?? 'unknown'}",
    "reviewed_at": "${new Date().toISOString()}"
  }
}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function runReview(context) {
  if (isLockedContractViolated(context)) {
    console.log('[reviewer] Contract gate triggered: LOCKED contract modified → FAIL');
    return buildLockedContractFailResult(context);
  }

  const prompt = buildPrompt(context);

  console.log('[reviewer] Calling Claude API…');
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].text.trim();

  // JSON 블록 추출 (```json ... ``` 감싸인 경우도 처리)
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                    responseText.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error('Claude response did not contain valid JSON:\n' + responseText);
  }

  const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
  return parsed;
}

module.exports = { runReview };
