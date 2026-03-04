/**
 * commenter.js
 * GitHub API 전담 모듈 — PR에 summary 코멘트 + inline review 등록
 *
 * 외부 의존성 없음 (node:https 사용)
 * GITHUB_TOKEN (Actions에서 자동 주입) 으로 인증
 */
const https = require('node:https');

const COMMENT_MARKER = '<!-- pr-review-agent-v1 -->';
const GITHUB_API     = 'https://api.github.com';
const USER_AGENT     = 'pr-review-agent/0.1.0';

// ── HTTP Helper ───────────────────────────────────────────────────────────────

/**
 * GitHub API HTTP 요청
 * @returns {Promise<any>} 파싱된 JSON 응답
 * @throws {Error} 비 2xx 응답 시 statusCode 포함
 */
function httpRequest(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const urlObj  = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    USER_AGENT,
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        // Rate limit check
        if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
          const reset = res.headers['x-ratelimit-reset'];
          const err   = new Error(`GitHub API rate limit exceeded. Resets at ${new Date(reset * 1000).toISOString()}`);
          err.status  = 403;
          return reject(err);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err  = new Error(`GitHub API ${method} ${url} → ${res.statusCode}: ${raw.slice(0, 300)}`);
          err.status = res.statusCode;
          return reject(err);
        }
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve(raw);
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Comment Discovery ─────────────────────────────────────────────────────────

/**
 * PR의 기존 봇 코멘트를 찾는다.
 * 조건: COMMENT_MARKER 포함 + 봇 계정('[bot]' 포함)
 * @returns {Promise<{id: number, body: string}|null>}
 */
async function findBotComment(owner, repo, prNumber, token) {
  let page = 1;
  while (true) {
    const comments = await httpRequest(
      'GET',
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      null,
      token
    );
    if (!Array.isArray(comments) || comments.length === 0) break;

    const found = comments.find(
      c => c.user?.login?.includes('[bot]') && c.body?.includes(COMMENT_MARKER)
    );
    if (found) return { id: found.id, body: found.body };

    if (comments.length < 100) break;
    page++;
  }
  return null;
}

// ── Summary Comment ───────────────────────────────────────────────────────────

const VERDICT_EMOJI = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };
const SEVERITY_EMOJI = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢' };

/**
 * PR summary 코멘트 마크다운 생성 (COMMENT_MARKER 포함)
 */
function formatSummaryComment(result) {
  const meta    = result.metadata || {};
  const verdict = result.verdict ?? 'UNKNOWN';
  const emoji   = VERDICT_EMOJI[verdict] ?? '❓';

  const lines = [
    COMMENT_MARKER,
    `## ${emoji} PR Review Agent — ${verdict}`,
    ``,
    `| PR | SHA | Reviewed at |`,
    `|---|---|---|`,
    `| #${meta.pr_number ?? 'N/A'} | \`${(meta.sha ?? 'unknown').slice(0, 8)}\` | ${meta.reviewed_at ?? 'N/A'} |`,
    ``,
  ];

  // API 실패 케이스
  if (meta.gate === 'API_FAILURE') {
    lines.push(`> ⚠️ **Review failed**: Claude API error — \`${meta.error ?? 'unknown'}\``);
    lines.push(`> Please check your \`ANTHROPIC_API_KEY\` secret and retry.`);
    lines.push('');
    lines.push('---');
    lines.push('_Powered by [pr-review-agent](https://github.com/your-org/pr-review-agent)_');
    return lines.join('\n');
  }

  // Contract gate 케이스
  if (meta.gate === 'LOCKED_CONTRACT_VIOLATION') {
    lines.push(`> 🔒 **Contract gate triggered**: \`docs/contract.md\` is LOCKED but was modified.`);
    lines.push(`> Submit a change request via \`docs/change-requests/CR-*.md\` instead.`);
    lines.push('');
    lines.push('---');
    lines.push('_Powered by [pr-review-agent](https://github.com/your-org/pr-review-agent)_');
    return lines.join('\n');
  }

  // Findings 요약 표
  const allFindings = [];
  for (const expert of result.experts ?? []) {
    for (const f of expert.findings ?? []) {
      allFindings.push({ expert: expert.name, ...f });
    }
  }

  if (allFindings.length > 0) {
    lines.push(`### Findings`);
    lines.push('');
    lines.push(`| | Severity | Expert | Title |`);
    lines.push(`|---|---|---|---|`);
    for (const f of allFindings) {
      const sev = `${SEVERITY_EMOJI[f.severity] ?? ''} ${f.severity}`;
      lines.push(`| | ${sev} | ${f.expert} | ${f.title} |`);
    }
    lines.push('');
  } else {
    lines.push('_No findings._');
    lines.push('');
  }

  // Doc updates needed
  if (result.doc_updates_needed?.length) {
    lines.push('### Documentation Updates Needed');
    lines.push('');
    for (const d of result.doc_updates_needed) {
      lines.push(`- **${d.doc_path}**: ${d.reason}`);
    }
    lines.push('');
  }

  // Questions
  if (result.questions?.length) {
    lines.push('### Open Questions');
    lines.push('');
    result.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push('');
  }

  lines.push('---');
  lines.push('_Powered by [pr-review-agent](https://github.com/your-org/pr-review-agent)_');
  return lines.join('\n');
}

/**
 * 기존 봇 코멘트가 있으면 PATCH, 없으면 POST
 */
async function postOrUpdateSummaryComment(prNumber, body, token, owner, repo) {
  const existing = await findBotComment(owner, repo, prNumber, token);

  if (existing) {
    console.log(`[commenter] Updating existing summary comment (id: ${existing.id})`);
    await httpRequest(
      'PATCH',
      `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      { body },
      token
    );
  } else {
    console.log('[commenter] Posting new summary comment');
    await httpRequest(
      'POST',
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { body },
      token
    );
  }
}

// ── Inline Review ─────────────────────────────────────────────────────────────

/**
 * finding 하나를 inline comment body로 포맷
 */
function formatInlineBody(finding, expertName) {
  const sev = `${SEVERITY_EMOJI[finding.severity] ?? ''} **[${expertName}/${finding.severity}]** ${finding.title}`;
  const lines = [sev, '', finding.description, ''];
  if (finding.recommendation) {
    lines.push(`**Recommendation:** ${finding.recommendation}`);
  }
  return lines.join('\n');
}

/**
 * result의 evidence에서 CODE: 형식을 파싱해 GitHub Review comment 객체 배열 반환
 * "CODE: path/to/file: L10-L40" → { path, line, start_line?, side, body }
 */
function parseInlineComments(result) {
  const comments = [];

  for (const expert of result.experts ?? []) {
    for (const finding of expert.findings ?? []) {
      for (const ev of finding.evidence ?? []) {
        // CODE: path/to/file: L10 또는 CODE: path/to/file: L10-L40
        const match = ev.match(/^CODE:\s*(.+?):\s*L(\d+)(?:-L?(\d+))?$/);
        if (!match) continue;

        const filePath  = match[1].trim();
        const startLine = parseInt(match[2], 10);
        const endLine   = match[3] ? parseInt(match[3], 10) : startLine;

        const comment = {
          path: filePath,
          line: endLine,
          side: 'RIGHT',
          body: formatInlineBody(finding, expert.name),
        };

        // 범위 주석 (start_line < line 일 때만)
        if (startLine < endLine) {
          comment.start_line = startLine;
          comment.start_side = 'RIGHT';
        }

        comments.push(comment);
      }
    }
  }

  return comments;
}

/**
 * GitHub PR Review 등록 (inline annotations 포함)
 * 422 에러(diff 밖 라인) 시 inline 없이 재시도
 */
async function postInlineReview(prNumber, sha, inlineComments, summaryBody, verdict, token, owner, repo) {
  const eventMap = { FAIL: 'REQUEST_CHANGES', WARN: 'COMMENT', PASS: 'APPROVE' };

  const payload = {
    commit_id: sha,
    body:      summaryBody,
    event:     eventMap[verdict] ?? 'COMMENT',
    comments:  inlineComments,
  };

  try {
    await httpRequest('POST', `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, payload, token);
    console.log(`[commenter] Posted PR review with ${inlineComments.length} inline comment(s)`);
  } catch (err) {
    if (err.status === 422) {
      console.warn('[commenter] Inline review rejected (lines outside diff), retrying without inline comments');
      const fallback = { ...payload, comments: [] };
      await httpRequest('POST', `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, fallback, token);
      console.log('[commenter] Posted PR review (summary only)');
    } else {
      throw err;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * PR에 리뷰를 등록하는 진입점.
 * index.js에서 writeOutputs() 이후에 호출한다.
 *
 * @param {object} result  reviewer.js가 반환한 결과 JSON
 * @param {string} token   GITHUB_TOKEN
 */
async function postReview(result, token) {
  const repoFullName = process.env.GITHUB_REPOSITORY; // "owner/repo"
  const prNumber     = result.metadata?.pr_number;
  const sha          = result.metadata?.sha;

  if (!repoFullName || !prNumber) {
    console.warn('[commenter] GITHUB_REPOSITORY or pr_number not set — skipping comment posting');
    return;
  }

  const [owner, repo] = repoFullName.split('/');
  const summaryBody   = formatSummaryComment(result);
  const inlineComments = parseInlineComments(result);

  // 1. Summary comment (업데이트 가능)
  await postOrUpdateSummaryComment(prNumber, summaryBody, token, owner, repo);

  // 2. Inline review (새 push마다 새 review 생성 — GitHub 정책상 정상)
  await postInlineReview(prNumber, sha, inlineComments, summaryBody, result.verdict, token, owner, repo);
}

module.exports = { postReview };
