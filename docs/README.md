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