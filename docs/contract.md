# Contract: Review Agent (LOCKED)

Status: LOCKED
Contract-Version: v0.1.0

> 이 문서는 “코더(Claude)”가 반드시 지켜야 하는 계약이다.
> LOCKED 상태에서는 이 파일을 직접 수정하지 않는다.
> 변경이 필요하면 `agent/docs/change-requests/CR-*.md`로 요청한다.

---

## 1. Trigger & Runtime
- 트리거(최소 1개 지원)
  - GitHub Actions: pull_request 이벤트에서 실행
- 런타임
  - Node.js 또는 Python 중 1개를 선택(초기에는 Node 권장)
  - 결과 산출물은 `agent/out/`에 저장 가능해야 한다.

## 2. Inputs Contract
에이전트는 최소한 아래 입력을 처리한다.

### 2.1 PR Context
- PR title/body
- changed files list
- diff patch (가능하면)

### 2.2 Docs Context
- 필수 문서:
  - `agent/docs/spec.md`
  - `agent/docs/contract.md`
  - `agent/docs/acceptance.md`
- 옵션 문서:
  - `README.md`
  - `docs/**/*.md` 또는 `.github/**/*.md`

## 3. Output Contract
### 3.1 Machine-readable JSON (필수)
- 경로: `agent/out/review_result.json`
- 스키마(최소 필드):
  - `verdict`: "PASS" | "WARN" | "FAIL"
  - `experts`: array of
    - `name`: "maintainer" | "security" | "docs"
    - `findings`: array of
      - `severity`: "LOW" | "MEDIUM" | "HIGH"
      - `title`: string
      - `description`: string
      - `evidence`: array of string (CODE/DOC 근거)
      - `recommendation`: string
  - `doc_updates_needed`: array of
    - `doc_path`: string
    - `reason`: string
    - `evidence`: array of string
  - `questions`: array of string (UNCLEAR 항목 질문)
  - `metadata`: object (PR 번호, commit sha 등)

### 3.2 Human-readable Markdown (권장)
- 경로: `agent/out/review_report.md`
- 포함:
  - 요약 verdict + Top action items
  - 3 전문가 섹션
  - 문서 업데이트 필요 목록
  - 질문 리스트

## 4. Evidence Rules (필수)
- 모든 finding/문서 업데이트 필요 항목은 근거(evidence)를 포함해야 한다.
- evidence는 아래 형식 중 하나:
  - `CODE: path/to/file: L10-L40`
  - `DOC: path/to/doc.md > Some Header`
- 근거가 없으면 finding을 만들지 말고 `questions`로 넘긴다.

## 5. Non-goals / Safety
- 자동 커밋/푸시 금지(MVP)
- 비밀정보(키/토큰) 출력 금지

# test change 