# Review Agent (BYOK)

PR/Push 시 변경된 코드와 문서를 자동 리뷰하여 PR 코멘트와 리포트를 생성합니다.
- 기본: diff-only 전송
- 사용자의 LLM API 키(BYOK)를 사용합니다.

## Quick Start (GitHub Action)

1) 레포에 시크릿 추가
- `LLM_API_KEY` (예: OpenAI/Anthropic 등, 프로젝트 설정에 따라)

2) 워크플로우 추가: `.github/workflows/ai-review.yml`

```yml
name: AI Review Agent
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: ${{ github.event.pull_request.head.repo.fork == false }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install
        run: npm ci

      - name: Run review agent
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          node dist/cli.js \
            --base "${{ github.event.pull_request.base.sha }}" \
            --head "${{ github.event.pull_request.head.sha }}" \
            --repo "${{ github.repository }}" \
            --pr "${{ github.event.pull_request.number }}" \
            --config ".reviewagent.yml"

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: review-output
          path: out/*

Config

.reviewagent.yml 로 입력 범위, 제외 경로, doccheck 룰, 출력 방식을 제어합니다.

Outputs

out/review_result.json : 머신 리더블 결과(스키마는 CONTRACT.md)

out/review_report.md : 사람이 읽는 리포트

Security defaults

기본 diff_only

.env*, **/*secret*, **/*key*, credentials 관련 파일은 기본 제외

fork PR은 기본적으로 실행하지 않음(또는 dry-run 권장)


Local CLI

# base/head 지정 실행
LLM_API_KEY=... node dist/cli.js --base <base> --head <head> --config .reviewagent.yml

# 실행 결과
# out/review_result.json
# out/review_report.md

License / Disclaimer

본 도구는 자동 리뷰 보조 도구이며, 최종 책임은 코드 작성자/리뷰어에게 있습니다

 
---

## 4) `DOCHECK.md` (룰 기반 문서/계약 갱신 체크 정의)

```md
# DocCheck Rules

LLM 없이 결정적으로 수행되는 규칙 기반 검사입니다.
목적은 “변경에 따른 문서/계약/스펙 갱신 누락”을 빠르게 잡는 것입니다.

## Rule Set v1

### R1. API/Contract 변경 시 문서 갱신 요구
- 트리거(경로 예시):
  - `src/routes/**`
  - `src/controllers/**`
  - `src/api/**`
  - `proto/**`
  - `openapi/**`
- 요구사항:
  - `README.md` 또는 `docs/**` 또는 `SPEC.md` 또는 `CONTRACT.md` 중 최소 1개가 함께 변경되어야 함
- 위반 시:
  - severity: MAJOR
  - message: "API/contract 관련 변경 감지. 문서/스펙/계약 파일 업데이트가 필요합니다."

### R2. CLI/Commands 변경 시 README 갱신 요구
- 트리거:
  - `src/cli/**`, `packages/cli/**`, `dist/cli.js` 생성 로직 변경(소스 기준)
- 요구사항:
  - `README.md` 또는 `docs/usage.md` 갱신
- 위반 시: MAJOR

### R3. Spec/Contract 변경 누락(자기참조)
- 트리거:
  - DocCheck 룰/출력 포맷/옵션이 변경되었다고 판단되는 파일 변경(예: `src/format/**`, `src/rules/**`, `src/config/**`)
- 요구사항:
  - `SPEC.md` 또는 `CONTRACT.md` 변경
- 위반 시: MINOR (프로젝트 성격에 따라 MAJOR로 상향 가능)

### R4. 문서만 변경 시 코드리뷰 축소(옵션)
- 트리거:
  - 변경 파일이 `README.md` 또는 `docs/**` 또는 `**/*.md`만 존재
- 동작:
  - LLM 리뷰는 문서 품질(링크, 예시, 사용법 불일치) 중심으로 축소
  - 코드 품질 리뷰는 생략 가능

---

## Severity 가이드
- BLOCKER: 병합 차단 수준(보안/데이터 유출/빌드 완전 실패 등)
- MAJOR: 릴리즈 품질에 영향 큰 결함/문서 불일치
- MINOR: 개선 권장
- NIT: 사소한 스타일

---

## Config 연동
- `.reviewagent.yml`에서 enable/disable 및 경로, 요구 문서 목록을 조정할 수 있어야 한다.