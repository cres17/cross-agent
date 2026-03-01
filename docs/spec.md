# Spec: Docs-aware PR Review Agent (MVP)

## 0. 목적
이 프로젝트는 PR(또는 커밋) 변경분을 기준으로:
1) 코드 품질/리스크를 3자(전문가) 관점에서 평가하고
2) `.md` 문서(스펙/가이드/로드맵)와 코드 변경이 정합적인지 점검하며
3) 문서 업데이트 누락을 자동으로 탐지/보고하는 에이전트를 제공한다.

## 1. 범위 (MVP)
### In-scope
- PR 이벤트에서 실행되며(수동 실행도 가능), 다음 산출물을 생성한다.
  - PR 코멘트(요약 + 액션아이템 + 문서 업데이트 필요 목록)
  - 머신리더블 결과 JSON(추후 확장용)
- “문서 기준”은 저장소 내 `.md` 파일들에서 추출한다.
  - 최소 기준 문서: `agent/docs/contract.md`, `agent/docs/acceptance.md`
  - 추가 기준 문서: `README.md`, `docs/**/*.md` (옵션)
- 3가지 관점으로 리뷰를 생성한다.
  1) Maintainer 관점(설계/유지보수/테스트)
  2) Security/Quality 관점(입력검증/비밀정보/취약패턴)
  3) Docs/Spec 정합성 관점(문서 업데이트 필요 여부)

### Out-of-scope (MVP)
- 자동 코드 수정/자동 커밋
- 외부 이슈 트래커(Jira 등) 연동
- 리포 전체 정적분석(SAST) 대체

## 2. 사용자 시나리오
- 개발자가 PR을 열면 자동 리뷰 코멘트가 달린다.
- PR에 사용자-facing 변경이 있는데 문서가 업데이트되지 않았으면 경고한다.
- 근거가 부족하면 “불명확(UNCLEAR)”로 두고 질문 리스트를 남긴다.

## 3. 입력(Inputs)
- PR 메타데이터: title/body/labels
- 변경 파일 목록 및 diff(가능하면 patch)
- 문서 기준 파일:
  - `agent/docs/contract.md`
  - `agent/docs/acceptance.md`
  - (옵션) 레포 내 지정된 `.md`

## 4. 출력(Outputs)
- PR 코멘트(마크다운)
- `agent/out/review_result.json` (Actions artifact 또는 로컬 산출)
- (옵션) `agent/out/review_report.md`

## 5. 품질 원칙
- 모든 지적은 반드시 근거를 포함해야 한다.
  - CODE 근거: `path/to/file: Lx-Ly`
  - DOC 근거: `path/to/doc.md > Section Header`
- 근거 없으면 반드시 `UNCLEAR`로 처리한다(추측 금지).

## 6. 확장 아이디어(나중)
- 문서 업데이트 PR 자동 생성(별도 PR)
- 룰 기반 gate(예: contract LOCKED 상태에서 contract 수정 시 실패)