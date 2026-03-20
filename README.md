# PR Review Agent

![Claude](https://img.shields.io/badge/Claude-claude--opus--4--6-D97757?logo=anthropic&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?logo=githubactions&logoColor=white)

프로젝트 문서를 기준으로 PR을 리뷰하고, 코드가 바뀌었을 때 문서도 같이 업데이트해야 하는지 자동으로 잡아주는 서드파티 Claude CLI 도구입니다.

---

## 왜 만들었나요?

개발팀이라면 다들 문서를 씁니다. 스펙, API 계약서, README, 런북...
근데 솔직히 **첫 릴리즈 이후로 코드와 문서가 따로 노는 건 어느 팀이나 마찬가지**잖아요.

`src/routes/user.ts` 고치면서 `docs/api.md` 업데이트하는 걸 깜빡하고,
다른 팀원이 낡은 문서 믿고 작업하다가 버그가 쌓이는 그 흐름이요.
코드 리뷰는 로직 실수를 잡아주지만, "문서 드리프트"를 PR 단계에서 체계적으로 잡는 건 사실상 아무도 안 하고 있고요.

그래서 **눈치 안 보고 지적해 주는 중립적인 리뷰어**가 필요했습니다. 팀원한테 "이 문서도 업데이트해야 하지 않아요?"라고 말하기 애매한 순간들, 이 에이전트한테 맡기면 됩니다.

에이전트가 하는 일은 크게 두 가지예요:

1. **문서 감시.** 민감한 코드 영역이 바뀌면, 관련 문서도 같이 바뀌었는지 확인합니다. 완전히 규칙 기반이라 LLM 없이도 돌아가요. "라우트 바뀌면 문서도 바뀌어야 한다"는 판단에 AI가 필요하진 않으니까요.

2. **코드 리뷰.** API 키가 있으면 정제된 diff를 Claude한테 보내서 구조화된 의견을 받아옵니다. 버그, 보안 이슈, 테스트 누락, API 계약 불일치 같은 것들이요. 사람 리뷰를 대체하는 게 아니라, 금요일 밤 11시 PR에서 슬쩍 넘어가는 것들을 한 번 더 잡아주는 역할입니다.

---

## 어떤 효과를 기대하나요?

**단기적으로는** — API 엔드포인트나 CLI 커맨드, 설정 파일이 바뀌었는데 문서를 안 고쳤다면, CI가 어떤 파일이 빠졌는지 콕 집어서 실패합니다. 더 이상 조용히 넘어가지 않아요.

**중기적으로는** — 팀에 습관이 생깁니다. 에이전트가 어차피 잡는다는 걸 알면, 나중에 고치는 게 아니라 PR 올릴 때 미리 문서를 같이 업데이트하게 돼요. `.reviewagent.yml` 파일 자체가 팀의 "어떤 코드는 반드시 문서화되어야 한다"는 기준을 담은 살아있는 문서가 되고요.

**장기적으로는** — `out/review_result.json`을 대시보드나 트렌드 추적에 연결할 수 있습니다. MAJOR 이슈가 얼마나 자주 나오는지, 코드베이스에서 어떤 영역이 가장 자주 문서와 멀어지는지, 그 흐름이 눈에 보이게 됩니다.

---

## 어떻게 동작하나요?

PR이 열리거나 업데이트될 때마다 두 가지 리뷰 패스가 독립적으로 실행됩니다:

**패스 1 — DocCheck (규칙 기반, LLM 없음)**
`.reviewagent.yml`에 정의된 글로브 규칙으로 문서 업데이트 요건이 충족됐는지 확인합니다.
예를 들어 `src/routes/user.ts`가 바뀌었는데 `README.md`는 그대로라면 MAJOR 발견이 생성돼요.
항상 실행되고, 비용도 없고, 외부 의존성도 없습니다.

**패스 2 — LLM 리뷰 (Claude API, BYOK)**
정제된 diff를 Claude에 보내서 버그, 보안 위험, 성능 이슈, 테스트 누락, API 계약 불일치, 문서 불일치 등을 구조화된 형태로 받아옵니다.
`ANTHROPIC_API_KEY`가 있을 때만 실행됩니다.

두 패스 모두 `out/review_result.json`(안정적인 스키마의 JSON)과 `out/review_report.md`(사람이 읽기 좋은 마크다운)로 결과를 통합해서 냅니다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 런타임 | Node.js ≥ 20 |
| 언어 | TypeScript |
| LLM | Claude (Anthropic) — `claude-opus-4-6` 기본값 |
| CI/CD | GitHub Actions |
| 패키지 매니저 | npm ≥ 9 |
| 테스트 | 자체 구현 (Node.js 내장 모듈만 사용, 의존성 없음) |
| 외부 API | Anthropic API (`api.anthropic.com`), GitHub REST API |

---

## 설치

### Claude Desktop — 드래그앤드롭 (가장 쉬운 방법)

**1단계.** [Releases](https://github.com/cres17/cross-agent/releases/latest)에서 `pr-review-agent.dxt` 다운로드

**2단계.** (선택) SHA256 검증 — 파일 무결성 확인

```bash
# Windows
certutil -hashfile pr-review-agent.dxt SHA256

# macOS / Linux
shasum -a 256 pr-review-agent.dxt
```

Release 페이지의 `pr-review-agent.dxt.sha256` 파일과 비교합니다.

**3단계.** Claude Desktop → **Settings → Developer** → `pr-review-agent.dxt` 드래그앤드롭

**4단계.** Claude Desktop 재시작 후 사용:

> "main 브랜치 대비 변경사항 리뷰해줘"
> "DocCheck 결과 보여줘"

API 키 불필요 — Claude Desktop 기존 구독으로 동작합니다.

---

### Claude Code — 슬래시 커맨드

```bash
git clone https://github.com/cres17/cross-agent.git
```

클론하면 `/review-pr` 커맨드가 자동으로 등록됩니다.

```
/review-pr main       # main 대비 리뷰
/review-pr HEAD~3     # 최근 3커밋 리뷰
```

---

### GitHub Actions — PR 자동 리뷰

PR이 열릴 때마다 자동 실행됩니다. `ANTHROPIC_API_KEY`가 필요합니다.

**1단계.** [Use this template](https://github.com/cres17/cross-agent/generate)으로 레포 생성 (또는 직접 클론)

**2단계.** GitHub Secrets에 API 키 등록

레포지토리 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |

**3단계.** PR 열면 자동 실행 — 결과는 워크플로우 아티팩트(`out/`)에 저장
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

모든 동작은 레포지토리 루트의 `.reviewagent.yml` 하나로 제어합니다.

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

규칙은 누적 적용됩니다. 같은 PR에서 여러 규칙이 동시에 발동할 수 있어요.
삭제하지 않고 잠깐 꺼두고 싶다면 `enable: false`를 쓰면 됩니다.

---

## 출력 계약 (v1)

어떤 기능이 켜져 있든 꺼져 있든, `out/review_result.json`은 항상 이 스키마를 따릅니다:

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

**발견 ID**는 `(rule_id, severity, category, title, detail)` 조합에서 뽑은 SHA-256 해시라 입력이 같으면 항상 같은 ID가 나옵니다. 중복 제거, 추적, 실행 간 비교에 그대로 활용하면 됩니다.

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
| `LLM_ENABLED` | 선택 | `true` | `false`로 설정하면 DocCheck 전용 모드로 강제 전환. |
| `LLM_FAIL_ON_ERROR` | 선택 | `false` | `true`로 설정하면 Claude API 실패 시 exit 1. |

---

## 보안

### Claude한테 뭘 보내나요?

정제된 `git diff`만 전송합니다. 보내기 전에 세 단계를 거쳐요:

**1. 경로 제외** — `exclude_globs`나 내장 민감 패턴에 걸리는 파일은 통째로 빠집니다:

```
.env*   **/*credential*   **/*secret*   **/*key*
dist/   build/            node_modules/ *.lock
```

**2. 시크릿 패턴 마스킹** — 아래 패턴은 `[REDACTED]`로 교체됩니다:

| 패턴 | 예시 |
|---|---|
| AWS 액세스 키 | `AKIAIOSFODNN7EXAMPLE` |
| JWT | `eyJhbGci...` |
| PEM 개인 키 블록 | `-----BEGIN RSA PRIVATE KEY-----` |
| GitHub PAT | `ghp_xxxx`, `ghs_xxxx` |
| 일반 `sk-` 키 | `sk-ant-api03-...` (Anthropic, OpenAI, Stripe) |
| Bearer 토큰 | `Authorization: Bearer xxxx` |
| 일반 키 할당 | `api_key = "xxxx"` |

**3. 잘라내기** — 난독화 후에도 `max_diff_chars`를 넘으면 `[DIFF TRUNCATED]` 알림과 함께 잘립니다. DocCheck는 파일 경로만 보기 때문에 영향 없습니다.

### 포크 PR은요?

포크 PR은 레포지토리 시크릿에 접근할 수 없어요. `GITHUB_EVENT_PATH`로 자동 감지해서 LLM 호출만 비활성화하고, DocCheck는 git 메타데이터만으로 계속 돌아갑니다.

---

## 로컬에서 개발하기

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

### 테스트 결과

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

`node:crypto`, `node:fs`, `node:path`만 씁니다. npm install 없이 바로 돌릴 수 있어요.

---

## 내 레포에 맞게 커스터마이징하기

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

### 더 빠르고 저렴한 모델 쓰기

```bash
# 환경 변수로 설정 (GitHub Actions 레포지토리 변수)
LLM_MODEL=claude-haiku-4-5-20251001
```

### CI 게이트로 활용하기

`review` 작업을 필수 통과 조건으로 설정하는 브랜치 보호 규칙을 추가하면 됩니다. `BLOCKER` 발견이 있을 때만 exit `1`이 나오고, `MAJOR` 이하는 exit `0`이라 권고로만 동작합니다.

### PR 말고 push에서도 실행하기

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
| `1` | `recommended_action`이 `merge_blocked` (BLOCKER 하나 이상), 또는 치명적 런타임 오류 |

---

## 요구 사항

- Node.js ≥ 20
- npm ≥ 9
- GitHub Actions가 활성화된 레포지토리
- Anthropic API 키 (선택 — DocCheck는 없어도 잘 돌아갑니다)

---

## 자주 묻는 질문

**Q: 다른 LLM(OpenAI, Gemini)으로 바꿀 수 있나요?**
`src/llm.ts`의 `runLlmReview()` 안에 있는 SDK 호출 부분만 교체하면 됩니다. 프롬프트 템플릿, 출력 스키마, 나머지 파이프라인은 프로바이더에 묶여 있지 않아요.

**Q: 내 코드가 외부 어딘가에 저장되나요?**
아니요. 외부 호출은 `api.anthropic.com` 하나뿐이에요. 다른 서버로 나가는 건 없고, 모든 출력은 `out/` 폴더에 로컬 저장되거나 내 레포지토리의 GitHub Actions 아티팩트로 올라갑니다.

**Q: LLM API 호출이 실패하면요?**
기본값(`LLM_FAIL_ON_ERROR=false`)에서는 에러를 로그하고 DocCheck 결과만으로 계속 진행해서 exit `0`으로 끝납니다. API 실패 시 워크플로우 자체를 실패시키고 싶다면 `LLM_FAIL_ON_ERROR=true`로 바꾸면 돼요.

**Q: LLM 꺼놓고 DocCheck만 쓰고 싶어요.**
`LLM_ENABLED=false`를 레포 변수나 환경 변수로 설정하면 됩니다. DocCheck는 이 설정과 무관하게 항상 실행돼요.

**Q: diff가 너무 크면 어떻게 되나요?**
`max_diff_chars`(기본 180,000자)에서 잘리고 `[DIFF TRUNCATED]` 알림이 붙습니다. Claude는 이 알림을 보고 잘린 구간에 대해서는 정보 부족을 명시합니다. DocCheck는 파일 경로만 보기 때문에 아무 영향 없어요.

**Q: `review_result.json`을 직접 파싱해서 써도 되나요?**
네, 스키마는 버전 관리됩니다(`meta.tool_version`). 마이너 버전은 필드 추가만 하고, 메이저 버전은 필드 변경이나 삭제가 있을 수 있습니다. 전체 계약은 `docs/contract.md`에서 확인하세요.

---

## 라이선스

MIT
