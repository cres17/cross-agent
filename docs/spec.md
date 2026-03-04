# Review Agent SPEC (BYOK)

## 목표
- PR 또는 push 시점에 변경된 코드/문서를 분석하여
  - 규칙 기반 DocCheck(결정적 검사)
  - LLM 기반 리뷰(해석적 리뷰)
  를 수행하고 PR 코멘트 + 산출물(out/*.json, out/*.md)을 생성한다.
- BYOK: 사용자의 LLM API 키를 사용하며, 서비스 서버를 기본적으로 요구하지 않는다.

## 범위
### 입력
- git diff (base..head)
- 변경 파일 목록
- (옵션) 전체 파일 내용: 기본 비활성(opt-in)

### 출력
- `out/review_result.json` (머신 리더블)
- `out/review_report.md` (휴먼 리더블)
- (옵션) PR 코멘트/리뷰로 게시

## 트리거
- 기본: GitHub `pull_request` (opened, synchronize, reopened)
- 옵션: `push` (main 등)

## 보안 원칙 (기본값)
- LLM 전송은 `diff_only`가 기본.
- 아래는 LLM 입력에서 제외(기본):
  - `.env*`, `**/*credential*`, `**/*secret*`, `**/*key*`
  - `dist/`, `build/`, `node_modules/`, lockfiles
- 시크릿/토큰 패턴 탐지 후 마스킹(redaction)
- 입력 상한:
  - 최대 변경 파일 수, 최대 diff 길이(문자/바이트) 제한
  - 상한 초과 시: 요약 모드 또는 중단

## 구성요소
1. CLI (Node/TS)
   - diff 수집, 필터링, redaction, doccheck, LLM 호출, 결과 포맷팅
2. GitHub Action wrapper
   - checkout/setup-node, CLI 실행, PR 코멘트 게시, artifact 업로드

## DocCheck (규칙 기반)
- 목적: 문서/계약/스펙 갱신 요구를 자동 검출 (LLM 없음)
- 대표 규칙:
  1) API/contract 관련 경로 변경 시 README/docs 업데이트 요구
  2) CLI 명령/옵션 변경 시 README/usage 업데이트 요구
  3) spec/contract 파일 변경 누락 시 경고

## LLM Review
- 목적: 코드 품질, 결함 가능성, 테스트 누락, 문서 불일치 등을 리뷰
- 입력: redaction된 diff + doccheck 결과 요약 + 레포 설정(.reviewagent.yml)
- 출력 스키마: CONTRACT.md의 JSON 스키마를 따른다.

## 실패/예외 처리
- LLM 호출 실패: doccheck만 수행하고 종료(Exit code 0 또는 설정에 따름)
- 권한 부족(PR 코멘트 불가): 산출물만 생성
- Fork PR: 기본적으로 실행 중단 또는 dry-run(코멘트 없이 산출물만)

## 비기능 요구사항
- 재현성: 같은 base/head/config이면 결과가 크게 달라지지 않도록 프롬프트/룰 버전 관리
- 관측성: out/review_result.json에 메타데이터(버전, 입력 크기, 처리시간) 기록