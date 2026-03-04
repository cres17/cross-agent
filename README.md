# PR Review Agent

A self-hosted, BYOK (Bring Your Own Key) pull request review agent powered by Claude.
Runs as a GitHub Actions workflow — no SaaS subscription, no data sent to third-party servers beyond Anthropic's API.

---

## What It Does

Every time a PR is opened or updated, the agent runs two independent review passes:

**Pass 1 — DocCheck (rule-based, always free)**
Statically checks whether the PR triggers documentation update requirements — no LLM call needed.
Example: if `src/routes/user.ts` changes but `README.md` does not, a MAJOR finding is emitted.

**Pass 2 — LLM Review (Claude API, BYOK)**
Sends the sanitized diff to Claude and receives structured findings: bugs, security risks, performance issues, missing tests, API contract mismatches, documentation inconsistencies.

Both passes produce a unified JSON result (`out/review_result.json`) following a stable contract schema, and a human-readable markdown report (`out/review_report.md`).

---

## How It Compares

| Feature | This Agent | CodeRabbit | GitHub Copilot PR Review | DIY LLM Script |
|---|---|---|---|---|
| Self-hosted | ✅ | ❌ SaaS | ❌ SaaS | ✅ |
| BYOK (your API key) | ✅ | ❌ | ❌ | ✅ |
| No subscription fee | ✅ | ❌ $12–$19/mo | ❌ Copilot plan | ✅ |
| Rule-based DocCheck (no LLM) | ✅ | ❌ | ❌ | ❌ |
| Config-driven rules (YAML) | ✅ `.reviewagent.yml` | Limited | ❌ | ❌ |
| Stable output contract (JSON) | ✅ v1 schema | ❌ | ❌ | ❌ |
| Secret redaction before LLM | ✅ | Unknown | Unknown | Manual |
| Fork PR safe | ✅ (LLM disabled) | N/A | N/A | ❌ |
| Works without LLM key | ✅ (DocCheck only) | ❌ | ❌ | ❌ |
| Open source, auditable | ✅ | ❌ | ❌ | ✅ |

**Key differentiators:**
- **DocCheck runs even if you have no API key** — the rule-based gate is completely free and deterministic.
- **You own the data flow.** The only external call is to Anthropic's API, with secrets already stripped.
- **Stable contract output** enables downstream tools (dashboards, statistics, CI gates) to parse results reliably across versions.
- **Per-repo customization** via `.reviewagent.yml` — define which file changes require which doc updates, without touching any code.

---

## Quick Start

### 1. Copy this repository

```bash
git clone https://github.com/your-org/pr-review-agent.git
cd pr-review-agent
```

Or use it as a template: click **Use this template** → Create repository.

### 2. Add your Anthropic API key

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no setup needed.

### 3. Open a pull request

The workflow triggers automatically on `pull_request` (opened, synchronize, reopened).
Review results are uploaded as a workflow artifact (`out/review_result.json`, `out/review_report.md`).

---

## How It Works

```
PR opened / updated
        │
        ▼
┌───────────────────────────────────────────────┐
│  1. Load config (.reviewagent.yml + env vars) │
│  2. Detect fork PR → disable LLM if fork      │
│  3. Resolve base/head SHA                     │
│  4. Collect changed files (git diff)          │
└───────────────────┬───────────────────────────┘
                    │
          ┌─────────▼─────────┐
          │  Pass 1: DocCheck │  ← always runs, no LLM, free
          │  (rule engine)    │
          └─────────┬─────────┘
                    │
          ┌─────────▼──────────────┐
          │  Filter + Redact diff  │  ← strip secrets, exclude sensitive files
          └─────────┬──────────────┘
                    │
          ┌─────────▼─────────┐
          │  Pass 2: LLM      │  ← Claude API (BYOK), skipped if no key
          │  (claude-opus-4-6)│
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────────────────────┐
          │  Build Summary                    │
          │  recommended_action:              │
          │    merge_blocked / needs_fix / ok │
          └─────────┬─────────────────────────┘
                    │
          ┌─────────▼──────────────────────┐
          │  Write outputs                 │
          │  out/review_result.json  (v1)  │
          │  out/review_report.md          │
          └────────────────────────────────┘
                    │
          exit 1 (merge_blocked) or 0 (ok / needs_fix)
```

---

## Project Structure

```
pr-review-agent/
├── src/
│   ├── cli.ts             # Main pipeline orchestrator (entry point)
│   ├── config.ts          # .reviewagent.yml + env var loader
│   ├── doccheck.ts        # Rule-based doc/contract check engine
│   ├── git.ts             # SHA resolution, changed files, diff
│   ├── glob.ts            # Built-in glob matcher (zero dependencies)
│   ├── llm.ts             # Claude API call + prompt template
│   ├── mapper.ts          # Normalize LLM response → contract schema
│   ├── redact.ts          # Sensitive file filter + secret masking
│   └── review_result.ts   # Contract v1 TypeScript types + buildSummary
│
├── .reviewagent.yml       # Your config: rules, globs, redaction, output mode
│
├── .github/
│   └── workflows/
│       ├── review-agent.yml     # Main GitHub Actions workflow
│       └── contract-lock.yml    # Integrity check for docs/contract.md
│
├── docs/
│   ├── spec.md            # Design specification
│   ├── contract.md        # Output JSON contract (v1, locked)
│   └── acceptance.md      # Acceptance criteria
│
├── test/
│   └── run_tests.mjs      # 59 test cases (zero npm dependencies)
│
├── out/                   # Generated outputs (git-ignored)
│   ├── review_result.json
│   └── review_report.md
│
├── .env.example           # Environment variable reference
├── package.json
└── tsconfig.json
```

---

## Configuration

All behavior is controlled via `.reviewagent.yml` at the repository root.

```yaml
version: 1

input:
  mode: diff_only          # diff_only | full_files
  max_changed_files: 60    # skip files beyond this count
  max_diff_chars: 180000   # truncate diff sent to LLM

  include_globs:           # only these files are analyzed
    - "**/*.ts"
    - "**/*.py"
    - "**/*.md"

  exclude_globs:           # always excluded from LLM input
    - "**/*.lock"
    - "**/node_modules/**"
    - "**/.env*"
    - "**/*secret*"

redaction:
  enable: true
  patterns:                # extra regex patterns to mask before LLM
    - "AKIA[0-9A-Z]{16}"  # AWS access key

rules:
  doccheck:
    enable: true

    doc_only_detection:    # emit NIT if only docs changed (informational)
      enable: true
      severity: NIT
      doc_globs: ["**/*.md", "docs/**"]

    rules:
      - id: "R1_API_DOCS"
        enable: true
        severity: MAJOR          # BLOCKER | MAJOR | MINOR | NIT
        category: doc
        title: "API changed: docs update required"
        trigger_globs:           # if any of these files change...
          - "src/routes/**"
          - "src/api/**"
        require_any_of_globs:    # ...at least one of these must also change
          - "README.md"
          - "docs/**"

output:
  comment_mode: pr_comment  # pr_comment | pr_review | none
  artifact: true            # upload out/ as workflow artifact
```

### DocCheck Rule Logic

```
IF any file matches trigger_globs
AND no file matches require_any_of_globs
THEN emit Finding(severity, category, title, references)
```

Rules are additive — multiple rules can fire on the same PR.
Set `enable: false` on any rule to disable it without deleting it.

---

## Output Contract (v1)

`out/review_result.json` always follows this schema regardless of which features are active:

```json
{
  "meta": {
    "tool_name": "review-agent",
    "tool_version": "0.1.0",
    "run_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-01T12:00:00.000Z",
    "repo": "owner/repo",
    "pr_number": 42,
    "base_sha": "abc1234",
    "head_sha": "def5678",
    "config_path": ".reviewagent.yml",
    "mode": "diff_only",
    "status": "ok"
  },
  "inputs": {
    "changed_files": 5,
    "included_files": 4,
    "excluded_files": 1,
    "diff_chars": 12000,
    "limits": { "max_changed_files": 60, "max_diff_chars": 180000 },
    "excluded_reasons": [{ "path": ".env", "reason": "excluded_glob" }]
  },
  "doccheck": {
    "passed": false,
    "findings": [
      {
        "id": "a3f8c1d2e4b56789",
        "severity": "MAJOR",
        "category": "doc",
        "title": "API changed: docs update required",
        "detail": "Trigger: 2 file(s), Required doc: 0 file(s)",
        "suggestion": "Update README.md or docs/ to reflect the changes.",
        "path": null,
        "line_range": { "start": null, "end": null },
        "patch": null,
        "references": ["trigger:src/routes/user.ts", "required_glob:README.md"]
      }
    ]
  },
  "llm_review": {
    "findings": [],
    "model": "claude-opus-4-6",
    "tokens": { "prompt": 1200, "completion": 800, "total": 2000 }
  },
  "summary": {
    "counts": { "blocker": 0, "major": 1, "minor": 0, "nit": 0 },
    "recommended_action": "needs_fix",
    "highlights": ["[MAJOR] API changed: docs update required"]
  }
}
```

### Severity and Recommended Action

| Severity | Meaning | `recommended_action` | Exit code |
|---|---|---|---|
| `BLOCKER` | Merge must not proceed | `merge_blocked` | `1` |
| `MAJOR` | Significant risk or correctness issue | `needs_fix` | `0` |
| `MINOR` | Improvement recommended | `ok` | `0` |
| `NIT` | Stylistic or minor observation | `ok` | `0` |

**Finding IDs** are stable SHA-256 hashes derived from `(rule_id, severity, category, title, detail)`.
The same inputs always produce the same ID — reliable for deduplication, tracking, and diffing across runs.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | For LLM | — | Your Anthropic API key. Without it, LLM review is skipped and DocCheck runs alone. |
| `GITHUB_TOKEN` | For comments | Auto | Provided automatically by GitHub Actions. |
| `REVIEW_MODE` | No | `diff_only` | `diff_only` or `full_files` — overrides YAML value. |
| `MAX_DIFF_CHARS` | No | `180000` | Max diff characters sent to LLM. |
| `MAX_CHANGED_FILES` | No | `60` | Max changed files processed. |
| `LLM_MODEL` | No | `claude-opus-4-6` | Claude model ID to use. |
| `LLM_ENABLED` | No | `true` | Set `false` to force DocCheck-only mode. |
| `LLM_FAIL_ON_ERROR` | No | `false` | Set `true` to exit 1 if the Claude API call fails. |

---

## Security

### What gets sent to the LLM

Only the sanitized `git diff` is sent to Claude. Before sending, three stages run:

**1. Path exclusion** — files matching `exclude_globs` or built-in sensitive patterns are removed:

```
.env*   **/*credential*   **/*secret*   **/*key*
dist/   build/            node_modules/ *.lock
```

**2. Secret pattern masking** — the following are replaced with `[REDACTED]`:

| Pattern | Example |
|---|---|
| AWS access key | `AKIAIOSFODNN7EXAMPLE` |
| JWT | `eyJhbGci...` |
| PEM private key blocks | `-----BEGIN RSA PRIVATE KEY-----` |
| GitHub PATs | `ghp_xxxx`, `ghs_xxxx` |
| Generic `sk-` keys | `sk-ant-api03-...` (Anthropic, OpenAI, Stripe) |
| Bearer tokens | `Authorization: Bearer xxxx` |
| Generic key assignments | `api_key = "xxxx"` |

**3. Truncation** — if the redacted diff exceeds `max_diff_chars`, it is cut off with an appended notice. DocCheck is unaffected.

### Fork PRs

Fork PRs cannot access repository secrets. The agent detects this automatically via `GITHUB_EVENT_PATH` and disables the LLM call, while DocCheck continues to run safely using only git metadata.

---

## Local Development

```bash
# Install dependencies
npm install

# Compile TypeScript → dist/
npm run build

# Run 59 tests (zero npm dependencies, uses only Node.js built-ins)
node test/run_tests.mjs

# Run DocCheck + LLM review (requires ANTHROPIC_API_KEY + git repo with commits)
export ANTHROPIC_API_KEY=sk-ant-...
npm run doccheck

# Run the original JS-based pipeline with mock PR context
npm run review:mock
```

### Test suite output

```
=== Suite 1: .reviewagent.yml structure ===      7/7  ✅
=== Suite 2: DocCheck rule engine ===            11/11 ✅
=== Suite 3: buildSummary ===                     7/7  ✅
=== Suite 4: Sensitive file filtering ===         9/9  ✅
=== Suite 5: ReviewResult schema shape ===        7/7  ✅
=== Suite 6: Source file structure ===           18/18 ✅
──────────────────────────────────────────────────────
Results: 59 passed, 0 failed / 59 total
```

Tests use only `node:crypto`, `node:fs`, `node:path` — no npm install required to run them.

---

## Customizing for Your Repository

### Add your own DocCheck rules

```yaml
# .reviewagent.yml
rules:
  doccheck:
    rules:
      - id: "DB_MIGRATION_DOCS"
        enable: true
        severity: MAJOR
        category: doc
        title: "Schema changed: migration docs required"
        trigger_globs:
          - "prisma/**"
          - "migrations/**"
          - "**/*.sql"
        require_any_of_globs:
          - "docs/migrations.md"
          - "CHANGELOG.md"

      - id: "INFRA_RUNBOOK"
        enable: true
        severity: MINOR
        category: doc
        title: "Infrastructure changed: runbook update recommended"
        trigger_globs:
          - "terraform/**"
          - "helm/**"
          - "k8s/**"
        require_any_of_globs:
          - "docs/runbook.md"
          - "docs/ops/**"
```

### Use a faster / cheaper model

```bash
# Via environment variable (GitHub Actions repository variable)
LLM_MODEL=claude-haiku-4-5-20251001
```

### Use as a hard CI gate

Add a branch protection rule requiring the `review` job to pass. The workflow exits `1` only on `BLOCKER` findings — `MAJOR` and below exit `0` so they are advisory, not blocking.

### Run on push as well as PRs

```yaml
# .github/workflows/review-agent.yml
on:
  push:
    branches: [main, develop]
  pull_request:
    types: [opened, synchronize, reopened]
```

---

## Exit Codes

| Code | Condition |
|---|---|
| `0` | `recommended_action` is `ok` or `needs_fix` |
| `1` | `recommended_action` is `merge_blocked` (at least one BLOCKER finding), or fatal runtime error |

---

## Requirements

- Node.js ≥ 20
- npm ≥ 9
- GitHub repository with Actions enabled
- Anthropic API key (optional — DocCheck works without it)

---

## FAQ

**Q: Can I use a different LLM (OpenAI, Gemini)?**
The LLM module (`src/llm.ts`) uses `@anthropic-ai/sdk`. To switch providers, replace the SDK call in `runLlmReview()` — the prompt template, output schema, and rest of the pipeline are provider-agnostic.

**Q: Does this store my code anywhere?**
No. The only external call is to `api.anthropic.com`. Nothing is sent to any other server. All outputs are stored in `out/` locally or uploaded as GitHub Actions artifacts to your own repository.

**Q: What if the LLM API call fails?**
By default (`LLM_FAIL_ON_ERROR=false`), the agent logs the error, continues with DocCheck-only results, and exits `0`. Set `LLM_FAIL_ON_ERROR=true` to fail the workflow on Claude API errors.

**Q: How do I disable LLM and use only DocCheck?**
Set `LLM_ENABLED=false` as a repository variable or environment variable. DocCheck always runs regardless of this setting.

**Q: The diff is too large — what happens?**
The diff is truncated at `max_diff_chars` (default 180,000 chars) with a `[DIFF TRUNCATED]` notice appended. The LLM receives the notice and is instructed to note insufficient information for omitted sections. DocCheck is unaffected (it only looks at file paths, not content).

**Q: Can I parse `review_result.json` in my own scripts?**
Yes. The schema is versioned (`meta.tool_version`) and follows the contract in `docs/contract.md`. Minor version bumps add fields only; major version bumps may change or remove fields.

---

## License

MIT
