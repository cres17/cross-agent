#!/usr/bin/env node
/**
 * index.js — CLI entry point
 *
 * Usage:
 *   node src/index.js          # GitHub Actions (env vars 필요)
 *   node src/index.js --mock   # 로컬 테스트 (mock/pr_context.json 사용)
 *
 * Exit codes:
 *   0 — PASS or WARN
 *   1 — FAIL or runtime error
 */
const { loadContext }  = require('./loader');
const { runReview }    = require('./reviewer');
const { writeOutputs } = require('./writer');
const { postReview }   = require('./commenter');

async function main() {
  const useMock = process.argv.includes('--mock');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[error] ANTHROPIC_API_KEY is not set.');
    console.error('        Set it as a GitHub Secret (Actions) or in your .env file (local).');
    process.exit(1);
  }

  console.log(`[agent] Starting PR review (mode: ${useMock ? 'mock' : 'live'})…`);

  const context = loadContext(useMock);
  console.log(`[agent] PR: "${context.pr.title}" | changed files: ${context.pr.changed_files?.length ?? 0}`);

  // Claude API 호출 — 실패해도 폴백 결과로 PR에 알림
  let result;
  try {
    result = await runReview(context);
  } catch (err) {
    console.error('[reviewer] Claude API failed:', err.message);
    result = buildApiFailureResult(context, err);
  }

  // 파일 산출물 기록 (항상 실행)
  writeOutputs(result);

  // GitHub PR 코멘트 등록 (Actions 환경 + live 모드에서만)
  if (process.env.GITHUB_TOKEN && !useMock) {
    try {
      await postReview(result, process.env.GITHUB_TOKEN);
    } catch (err) {
      // 코멘트 등록 실패는 non-fatal: verdict exit code는 유지
      console.error('[commenter] Failed to post GitHub comment:', err.message);
    }
  } else if (useMock) {
    console.log('[commenter] Mock mode — skipping GitHub comment posting');
  } else {
    console.warn('[commenter] GITHUB_TOKEN not set — skipping comment posting');
  }

  console.log(`\n[agent] Verdict: ${result.verdict}`);
  process.exit(result.verdict === 'FAIL' ? 1 : 0);
}

/**
 * Claude API 자체가 실패한 경우 PR에 알릴 수 있도록 최소 FAIL 결과를 반환
 */
function buildApiFailureResult(context, err) {
  return {
    verdict: 'FAIL',
    experts: [
      { name: 'maintainer', findings: [] },
      { name: 'security',   findings: [] },
      { name: 'docs',       findings: [] },
    ],
    doc_updates_needed: [],
    questions: [],
    metadata: {
      pr_number:   context.pr.number   ?? null,
      sha:         context.pr.sha      ?? 'unknown',
      reviewed_at: new Date().toISOString(),
      gate:        'API_FAILURE',
      error:       err.message,
    },
  };
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
