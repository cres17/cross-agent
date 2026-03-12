# PR Review Agent

프로젝트 문서를 기준으로 풀 리퀘스트를 리뷰하는 서드파티 Claude CLI 도구 —
코드 변경 시 문서도 함께 업데이트해야 하는지 자동으로 감지합니다.

---

## 제작 동기

모든 개발팀은 문서를 작성합니다: 스펙, API 계약, README, 런북.
하지만 현실에서 **코드와 문서는 첫 릴리즈 직후부터 벌어지기 시작합니다.**

개발자가 `src/routes/user.ts`를 수정하면서 `docs/api.md` 업데이트를 깜빡합니다.
다른 개발자는 outdated 문서를 읽고 잘못된 가정 위에서 작업하고, 버그는 복리로 쌓입니다.
코드 리뷰는 로직 오류를 잡지만, PR에서 문서 드리프트를 체계적으로 잡는 사람은 거의 없습니다.

이 도구는 **중립적인 서드파티 리뷰어** 역할을 합니다 — 문서 업데이트를 지적하기 너무 눈치 보이는 팀원이 아닌, 사회적 망설임이 없는 자동화 에이전트입니다.

에이전트의 역할은 두 가지입니다:

1. **문서 감시자.** 민감한 영역의 코드가 변경될 때, 관련 문서도 함께 변경됐는지 강제합니다. 결정론적이고 규칙 기반이며, LLM 없이도 동작합니다 — "라우트가 바뀌면 문서도 바뀌어야 한다"는 규칙은 AI 없이도 판단 가능하기 때문입니다.

2. **코드 리뷰어.** API 키가 있으면, 정제된 diff를 Claude에 보내고 구조화된 의견을 받습니다: 버그, 보안 이슈, 테스트 누락, API 계약 불일치. 사람 리뷰를 대체하는 것이 아니라, 금요일 오후 11시에 슬쩍 지나치는 것들을 잡기 위해 존재합니다.

---

## 기대 효과

**단기** — API 엔드포인트, CLI 커맨드, 설정을 건드리는 PR이 더 이상 문서 업데이트를 조용히 건너뛰지 않습니다. CI 작업이 어떤 파일이 변경됐고 어떤 문서가 업데이트되지 않았는지 명확히 지적하며 실패합니다.

**중기** — 팀에 습관이 생깁니다. 에이전트가 문서 드리프트를 잡는다는 걸 알면, 개발자들은 사후 대응이 아닌 사전 예방으로 문서를 업데이트하기 시작합니다. 규칙 설정 파일(`.reviewagent.yml`)은 팀 자체 기준 — "어떤 코드가 문서화 대상인가" — 을 기록하는 살아있는 문서가 됩니다.

**장기** — 구조화된 JSON 출력(`out/review_result.json`)을 대시보드, 통계, 트렌드 추적에 연결할 수 있습니다. 팀에서 MAJOR 발견이 얼마나 자주 발생하나? 코드베이스의 어느 영역이 가장 자주 드리프트하나? 그 데이터가 가시화됩니다.

---

## 동작 방식 개요

PR이 열리거나 업데이트될 때마다 에이전트는 두 가지 독립적인 리뷰 패스를 실행합니다:

**패스 1 — DocCheck (규칙 기반, LLM 없음)**
`.reviewagent.yml`에 정의된 글로브 규칙을 사용해 PR이 문서 업데이트 요건을 트리거하는지 확인합니다.
예시: `src/routes/user.ts`가 변경됐는데 `README.md`는 변경되지 않은 경우, MAJOR 발견이 생성됩니다.
이 패스는 항상 실행됩니다 — 비용 없음, 외부 의존성 없음.

**패스 2 — LLM 리뷰 (Claude API, BYOK)**
정제된 diff를 Claude에 전송하고 구조화된 발견 사항을 반환합니다: 버그, 보안 위험, 성능 이슈, 테스트 누락, API 계약 불일치, 문서 불일치.
이 패스는 `ANTHROPIC_API_KEY`가 설정된 경우에만 실행됩니다.

두 패스 모두 안정적인 스키마를 가진 통합 JSON 결과(`out/review_result.json`)와 사람이 읽을 수 있는 마크다운 리포트(`out/review_report.md`)를 생성합니다.

---

## 빠른 시작

### 1. 레포지토리 복사

```bash
git clone https://github.com/your-org/pr-review-agent.git
cd pr-review-agent
```

또는 템플릿으로 사용: **Use this template** → Create repository 클릭.

### 2. Anthropic API 키 등록

레포지토리 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** 이동

| 시크릿 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |

`GITHUB_TOKEN`은 GitHub Actions가 자동으로 제공하므로 별도 설정이 필요 없습니다.

### 3. 풀 리퀘스트 열기

워크플로우는 `pull_request` 이벤트(opened, synchronize, reopened)에서 자동으로 트리거됩니다.
리뷰 결과는 워크플로우 아티팩트(`out/review_result.json`, `out/review_report.md`)로 업로드됩니다.

---

## 동작 흐름

```
PR 열림 / 업데이트
        │
        ▼
┌───────────────────────────────────────────────┐
│  1. 설정 로드 (.reviewagent.yml + 환경 변수)  │
│  2. 포크 PR 감지 → 포크인 경우 LLM 비활성화  │
│  3. base/head SHA 확인                        │
│  4. 변경 파일 수집 (git diff)                 │
└───────────────────┬───────────────────────────┘
                    │
          ┌─────────▼─────────┐
          │  패스 1: DocCheck │  ← 항상 실행, LLM 없음, 무료
          │  (규칙 엔진)      │
          └─────────┬─────────┘
                    │
          ┌─────────▼──────────────┐
          │  diff 필터 + 난독화    │  ← 시크릿 제거, 민감 파일 제외
          └─────────┬──────────────┘
                    │
          ┌─────────▼─────────┐
          │  패스 2: LLM      │  ← Claude API (BYOK), 키 없으면 스킵
          │  (claude-opus-4-6)│
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────────────────────┐
          │  요약 생성                        │
          │  recommended_action:              │
          │    merge_blocked / needs_fix / ok │
          └─────────┬─────────────────────────┘
                    │
          ┌─────────▼──────────────────────┐
          │  출력 파일 작성                 │
          │  out/review_result.json  (v1)  │
          │  out/review_report.md          │
          └────────────────────────────────┘
                    │
          exit 1 (merge_blocked) 또는 0 (ok / needs_fix)
```

---

## 프로젝트 구조

```
pr-review-agent/
├── src/
│   ├── cli.ts             # 메인 파이프라인 오케스트레이터 (진입점)
│   ├── config.ts          # .reviewagent.yml + 환경 변수 로더
│   ├── doccheck.ts        # 규칙 기반 문서/계약 체크 엔진
│   ├── git.ts             # SHA 확인, 변경 파일, diff
│   ├── glob.ts            # 내장 글로브 매처 (의존성 없음)
│   ├── llm.ts             # Claude API 호출 + 프롬프트 템플릿
│   ├── mapper.ts          # LLM 응답 → 계약 스키마 정규화
│   ├── redact.ts          # 민감 파일 필터 + 시크릿 마스킹
│   └── review_result.ts   # 계약 v1 TypeScript 타입 + buildSummary
│
├── .reviewagent.yml       # 설정: 규칙, 글로브, 난독화, 출력 모드
│
├── .github/
│   └── workflows/
│       ├── review-agent.yml     # 메인 GitHub Actions 워크플로우
│       └── contract-lock.yml    # docs/contract.md 무결성 체크
│
├── docs/
│   ├── spec.md            # 설계 명세
│   ├── contract.md        # 출력 JSON 계약 (v1, 잠금)
│   └── acceptance.md      # 인수 기준
│
├── test/
│   └── run_tests.mjs      # 59개 테스트 케이스 (npm 의존성 없음)
│
├── out/                   # 생성된 출력 파일 (git 무시)
│   ├── review_result.json
│   └── review_report.md
│
├── .env.example           # 환경 변수 참고
├── package.json
└── tsconfig.json
```

---

## 설정

모든 동작은 레포지토리 루트의 `.reviewagent.yml`로 제어됩니다.

```yaml
version: 1

input:
  mode: diff_only          # diff_only | full_files
  max_changed_files: 60    # 이 수를 초과하는 파일은 건너뜀
  max_diff_chars: 180000   # LLM에 전송되는 diff 최대 문자 수

  include_globs:           # 이 파일들만 분석
    - "**/*.ts"
    - "**/*.py"
    - "**/*.md"

  exclude_globs:           # LLM 입력에서 항상 제외
    - "**/*.lock"
    - "**/node_modules/**"
    - "**/.env*"
    - "**/*secret*"

redaction:
  enable: true
  patterns:                # LLM 전송 전 마스킹할 추가 정규식 패턴
    - "AKIA[0-9A-Z]{16}"  # AWS 액세스 키

rules:
  doccheck:
    enable: true

    doc_only_detection:    # 문서만 변경된 경우 NIT 생성 (정보성)
      enable: true
      severity: NIT
      doc_globs: ["**/*.md", "docs/**"]

    rules:
      - id: "R1_API_DOCS"
        enable: true
        severity: MAJOR          # BLOCKER | MAJOR | MINOR | NIT
        category: doc
        title: "API 변경: 문서 업데이트 필요"
        trigger_globs:           # 이 파일들 중 하나라도 변경되면...
          - "src/routes/**"
          - "src/api/**"
        require_any_of_globs:    # ...이 중 하나 이상도 변경되어야 함
          - "README.md"
          - "docs/**"

output:
  comment_mode: pr_comment  # pr_comment | pr_review | none
  artifact: true            # out/을 워크플로우 아티팩트로 업로드
```

### DocCheck 규칙 로직

```
IF trigger_globs에 매칭되는 파일이 하나라도 있고
AND require_any_of_globs에 매칭되는 파일이 없으면
THEN Finding(severity, category, title, references) 생성
```

규칙은 누적적입니다 — 같은 PR에서 여러 규칙이 동시에 발동할 수 있습니다.
삭제하지 않고 비활성화하려면 `enable: false`를 설정하세요.

---

## 출력 계약 (v1)

`out/review_result.json`은 어떤 기능이 활성화되어 있든 항상 이 스키마를 따릅니다:

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
        "title": "API 변경: 문서 업데이트 필요",
        "detail": "트리거: 파일 2개, 필수 문서: 파일 0개",
        "suggestion": "변경 사항을 반영하여 README.md 또는 docs/를 업데이트하세요.",
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
    "highlights": ["[MAJOR] API 변경: 문서 업데이트 필요"]
  }
}
```

### 심각도 및 권장 조치

| 심각도 | 의미 | `recommended_action` | 종료 코드 |
|---|---|---|---|
| `BLOCKER` | 머지 불가 | `merge_blocked` | `1` |
| `MAJOR` | 심각한 위험 또는 정확성 문제 | `needs_fix` | `0` |
| `MINOR` | 개선 권장 | `ok` | `0` |
| `NIT` | 스타일 또는 사소한 관찰 | `ok` | `0` |

**발견 ID**는 `(rule_id, severity, category, title, detail)`에서 파생된 안정적인 SHA-256 해시입니다.
동일한 입력은 항상 동일한 ID를 생성합니다 — 중복 제거, 추적, 실행 간 비교에 신뢰할 수 있습니다.

---

## 환경 변수

| 변수 | 필수 여부 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | LLM 사용 시 필수 | — | Anthropic API 키. 없으면 LLM 리뷰 생략, DocCheck만 실행. |
| `GITHUB_TOKEN` | 댓글 작성 시 | 자동 | GitHub Actions가 자동 제공. |
| `REVIEW_MODE` | 선택 | `diff_only` | `diff_only` 또는 `full_files` — YAML 값 재정의. |
| `MAX_DIFF_CHARS` | 선택 | `180000` | LLM에 전송되는 최대 diff 문자 수. |
| `MAX_CHANGED_FILES` | 선택 | `60` | 처리할 최대 변경 파일 수. |
| `LLM_MODEL` | 선택 | `claude-opus-4-6` | 사용할 Claude 모델 ID. |
| `LLM_ENABLED` | 선택 | `true` | `false`로 설정 시 DocCheck 전용 모드 강제. |
| `LLM_FAIL_ON_ERROR` | 선택 | `false` | `true`로 설정 시 Claude API 호출 실패 시 exit 1. |

---

## 보안

### LLM에 전송되는 내용

Claude에는 정제된 `git diff`만 전송됩니다. 전송 전 세 단계를 거칩니다:

**1. 경로 제외** — `exclude_globs` 또는 내장 민감 패턴에 매칭되는 파일을 제거합니다:

```
.env*   **/*credential*   **/*secret*   **/*key*
dist/   build/            node_modules/ *.lock
```

**2. 시크릿 패턴 마스킹** — 아래 패턴을 `[REDACTED]`로 교체합니다:

| 패턴 | 예시 |
|---|---|
| AWS 액세스 키 | `AKIAIOSFODNN7EXAMPLE` |
| JWT | `eyJhbGci...` |
| PEM 개인 키 블록 | `-----BEGIN RSA PRIVATE KEY-----` |
| GitHub PAT | `ghp_xxxx`, `ghs_xxxx` |
| 일반 `sk-` 키 | `sk-ant-api03-...` (Anthropic, OpenAI, Stripe) |
| Bearer 토큰 | `Authorization: Bearer xxxx` |
| 일반 키 할당 | `api_key = "xxxx"` |

**3. 잘라내기** — 난독화된 diff가 `max_diff_chars`를 초과하면, `[DIFF TRUNCATED]` 알림과 함께 잘립니다. DocCheck는 영향을 받지 않습니다.

### 포크 PR

포크 PR은 레포지토리 시크릿에 접근할 수 없습니다. 에이전트는 `GITHUB_EVENT_PATH`를 통해 이를 자동으로 감지하고 LLM 호출을 비활성화하며, DocCheck는 git 메타데이터만 사용하여 계속 안전하게 실행됩니다.

---

## 로컬 개발

```bash
# 의존성 설치
npm install

# TypeScript → dist/ 컴파일
npm run build

# 59개 테스트 실행 (npm 의존성 없음, Node.js 내장 모듈만 사용)
node test/run_tests.mjs

# DocCheck + LLM 리뷰 실행 (ANTHROPIC_API_KEY + 커밋이 있는 git 레포 필요)
export ANTHROPIC_API_KEY=sk-ant-...
npm run doccheck

# 목 PR 컨텍스트로 JS 기반 파이프라인 실행
npm run review:mock
```

### 테스트 스위트 출력

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

테스트는 `node:crypto`, `node:fs`, `node:path`만 사용합니다 — 실행에 npm install이 필요 없습니다.

---

## 내 레포지토리에 맞게 커스터마이징

### DocCheck 규칙 추가

```yaml
# .reviewagent.yml
rules:
  doccheck:
    rules:
      - id: "DB_MIGRATION_DOCS"
        enable: true
        severity: MAJOR
        category: doc
        title: "스키마 변경: 마이그레이션 문서 필요"
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
        title: "인프라 변경: 런북 업데이트 권장"
        trigger_globs:
          - "terraform/**"
          - "helm/**"
          - "k8s/**"
        require_any_of_globs:
          - "docs/runbook.md"
          - "docs/ops/**"
```

### 더 빠르고 저렴한 모델 사용

```bash
# 환경 변수로 설정 (GitHub Actions 레포지토리 변수)
LLM_MODEL=claude-haiku-4-5-20251001
```

### 하드 CI 게이트로 사용

`review` 작업 통과를 필수 조건으로 하는 브랜치 보호 규칙을 추가하세요. 워크플로우는 `BLOCKER` 발견 시에만 exit `1`을 반환합니다 — `MAJOR` 이하는 exit `0`이므로 강제가 아닌 권고로 동작합니다.

### PR 외에 push에서도 실행

```yaml
# .github/workflows/review-agent.yml
on:
  push:
    branches: [main, develop]
  pull_request:
    types: [opened, synchronize, reopened]
```

---

## 종료 코드

| 코드 | 조건 |
|---|---|
| `0` | `recommended_action`이 `ok` 또는 `needs_fix` |
| `1` | `recommended_action`이 `merge_blocked` (BLOCKER 발견 하나 이상), 또는 치명적 런타임 오류 |

---

## 요구 사항

- Node.js ≥ 20
- npm ≥ 9
- Actions가 활성화된 GitHub 레포지토리
- Anthropic API 키 (선택 사항 — DocCheck는 없어도 동작)

---

## FAQ

**Q: 다른 LLM(OpenAI, Gemini)을 사용할 수 있나요?**
LLM 모듈(`src/llm.ts`)은 `@anthropic-ai/sdk`를 사용합니다. 다른 프로바이더로 전환하려면 `runLlmReview()` 내 SDK 호출을 교체하면 됩니다 — 프롬프트 템플릿, 출력 스키마, 나머지 파이프라인은 프로바이더 독립적입니다.

**Q: 내 코드가 어딘가에 저장되나요?**
아니요. 외부 호출은 `api.anthropic.com`뿐입니다. 다른 서버에는 아무것도 전송되지 않습니다. 모든 출력은 `out/`에 로컬로 저장되거나, 여러분의 레포지토리에 GitHub Actions 아티팩트로 업로드됩니다.

**Q: LLM API 호출이 실패하면 어떻게 되나요?**
기본값(`LLM_FAIL_ON_ERROR=false`)으로는 에러를 로그하고, DocCheck 전용 결과로 계속 진행하며, exit `0`으로 종료합니다. Claude API 오류 시 워크플로우를 실패시키려면 `LLM_FAIL_ON_ERROR=true`로 설정하세요.

**Q: LLM을 비활성화하고 DocCheck만 사용하려면?**
레포지토리 변수 또는 환경 변수로 `LLM_ENABLED=false`를 설정하세요. DocCheck는 이 설정과 무관하게 항상 실행됩니다.

**Q: diff가 너무 크면 어떻게 되나요?**
diff는 `max_diff_chars`(기본값 180,000자)에서 잘리며, `[DIFF TRUNCATED]` 알림이 추가됩니다. LLM은 이 알림을 받고 생략된 구간에 대해서는 정보가 부족함을 명시하도록 지시받습니다. DocCheck는 영향을 받지 않습니다(파일 경로만 확인하며 내용은 보지 않습니다).

**Q: 내 스크립트에서 `review_result.json`을 파싱할 수 있나요?**
네. 스키마는 버전이 관리됩니다(`meta.tool_version`). 마이너 버전 업데이트는 필드를 추가만 합니다; 메이저 버전 업데이트는 필드를 변경하거나 제거할 수 있습니다. 전체 계약은 `docs/contract.md`에서 확인하세요.

---

## 라이선스

MIT
