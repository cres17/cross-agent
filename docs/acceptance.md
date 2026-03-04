# Acceptance Criteria (MVP)

## A. 기능 요구사항
1) PR 변경분을 입력으로 받아 `PASS/WARN/FAIL` verdict를 생성한다.
2) 3개의 관점 섹션이 결과에 존재해야 한다.
   - maintainer / security / docs
3) 모든 지적은 근거(evidence)를 포함해야 한다.
4) 문서 업데이트 누락이 의심되면 `doc_updates_needed`에 기록한다.
   - doc_path는 `README.md` 또는 `docs/*.md`로만 작성한다(Policy A).
5) 근거가 부족하면 추측하지 않고 `questions`에 질문을 남긴다.

## B. 산출물
- `out/review_result.json` 생성 (필수)
- `out/review_report.md` 생성 (권장)

## C. 품질/테스트 기준
- 최소 1개의 샘플 입력(PR context mock) 또는 실제 PR에서 결과 JSON이 스키마를 만족해야 한다.
- (Actions 운용 시) 워크플로우가 실패 없이 실행되어야 한다.

## D. 게이트(정책)
- `docs/contract.md`가 LOCKED 상태인데 수정되면 PR은 실패 처리되어야 한다.