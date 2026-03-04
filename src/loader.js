/**
 * loader.js
 * PR Context + Docs 로드 담당
 *
 * 실행 환경별 동작:
 * - --mock 플래그 or GITHUB_EVENT_PATH 없음 → mock/pr_context.json 사용
 * - GitHub Actions 환경 → GITHUB_EVENT_PATH 이벤트 파일 + gh CLI로 diff/files 수집
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const REQUIRED_DOCS = [
  'docs/spec.md',
  'docs/contract.md',
  'docs/acceptance.md',
];

// ── PR Context ────────────────────────────────────────────────────────────────

function loadPRContext(useMock) {
  if (useMock || !process.env.GITHUB_EVENT_PATH) {
    const mockPath = path.join(ROOT, 'mock', 'pr_context.json');
    if (!fs.existsSync(mockPath)) {
      throw new Error(`Mock file not found: ${mockPath}`);
    }
    return JSON.parse(fs.readFileSync(mockPath, 'utf8'));
  }

  // ── GitHub Actions 환경 ──────────────────────────────────────────────────
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr    = event.pull_request;
  const prNum = pr.number;

  const diff         = fetchDiff(prNum);
  const changedFiles = fetchChangedFiles(prNum);

  return {
    title:         pr.title,
    body:          pr.body || '',
    number:        prNum,
    sha:           pr.head.sha,
    base_sha:      pr.base.sha,
    changed_files: changedFiles,
    diff,
  };
}

/**
 * PR diff를 가져온다.
 * 우선순위: PR_DIFF 환경변수 → gh pr diff CLI
 */
function fetchDiff(prNum) {
  if (process.env.PR_DIFF) return process.env.PR_DIFF;

  try {
    const { execSync } = require('child_process');
    return execSync(`gh pr diff ${prNum}`, {
      encoding:  'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      stdio:     ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.warn('[loader] gh pr diff failed:', err.message);
    return '';
  }
}

/**
 * 변경 파일 목록을 가져온다.
 * 우선순위: PR_CHANGED_FILES 환경변수 (개행 구분) → gh pr view CLI
 */
function fetchChangedFiles(prNum) {
  if (process.env.PR_CHANGED_FILES) {
    return process.env.PR_CHANGED_FILES
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
  }

  try {
    const { execSync } = require('child_process');
    const output = execSync(
      `gh pr view ${prNum} --json files --jq '.files[].path'`,
      {
        encoding:  'utf8',
        maxBuffer: 1 * 1024 * 1024,
        stdio:     ['ignore', 'pipe', 'pipe'],
      }
    );
    return output.split('\n').map(f => f.trim()).filter(Boolean);
  } catch (err) {
    console.warn('[loader] gh pr view files failed:', err.message);
    return [];
  }
}

// ── Docs ──────────────────────────────────────────────────────────────────────

function loadDocs() {
  const docs = {};
  for (const relPath of REQUIRED_DOCS) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) {
      docs[relPath] = fs.readFileSync(fullPath, 'utf8');
    } else {
      console.warn(`[loader] Missing required doc: ${relPath}`);
    }
  }
  return docs;
}

// ── Public API ────────────────────────────────────────────────────────────────

function loadContext(useMock) {
  const pr   = loadPRContext(useMock);
  const docs = loadDocs();
  return { pr, docs };
}

module.exports = { loadContext };
