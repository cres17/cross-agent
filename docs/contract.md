# Review Agent Contract

## 목적
- CLI 및 Action이 생성하는 결과물의 JSON 구조를 고정한다.
- 외부 툴(대시보드, 후처리, 통계)이 이 계약에 의존한다.

## Files
- out/review_result.json  (필수)
- out/review_report.md    (필수)

---

## out/review_result.json (Schema v1)

### Top-level
- meta: 실행 메타데이터
- inputs: 입력 요약(변경 파일 수, diff 크기 등)
- doccheck: 규칙 기반 검사 결과
- llm_review: LLM 리뷰 결과(이슈 리스트)
- summary: 요약 통계 및 권장 액션

### Types

#### Meta
- tool_name: string (e.g. "review-agent")
- tool_version: string (semver)
- run_id: string (UUID 권장)
- timestamp: string (ISO-8601)
- repo: string (owner/name, optional)
- pr_number: number | null
- base_sha: string
- head_sha: string
- config_path: string | null
- mode: "diff_only" | "full_files"
- status: "ok" | "warning" | "error"

#### Inputs
- changed_files: number
- included_files: number
- excluded_files: number
- diff_chars: number
- limits:
  - max_changed_files: number
  - max_diff_chars: number
- excluded_reasons: array of
  - path: string
  - reason: "excluded_glob" | "too_large" | "binary" | "redaction_block" | "unknown"

#### DocCheck
- passed: boolean
- findings: array of Finding

#### LLM Review
- findings: array of Finding
- model: string (e.g. "gpt-4.1-mini", "claude-3-5-sonnet" 등 사용 모델명)
- tokens:
  - prompt: number | null
  - completion: number | null
  - total: number | null

#### Finding (공통)
- id: string (stable hash 권장)
- severity: "BLOCKER" | "MAJOR" | "MINOR" | "NIT"
- category: "doc" | "api" | "security" | "bug" | "performance" | "test" | "style" | "build" | "other"
- title: string
- detail: string
- suggestion: string | null
- path: string | null
- line_range:
  - start: number | null
  - end: number | null
- patch: string | null  (diff code fence 포함 가능)
- references: array of string | null

#### Summary
- counts:
  - blocker: number
  - major: number
  - minor: number
  - nit: number
- recommended_action: "merge_blocked" | "needs_fix" | "ok"
- highlights: string[]  (짧은 bullet 요약)

---

## Backward compatibility
- major version가 바뀌면 필드 삭제/의미 변경 가능
- minor version는 필드 추가만 허용(기존 필드 의미 변경 금지)