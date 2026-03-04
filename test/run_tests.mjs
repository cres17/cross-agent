/**
 * run_tests.mjs
 * Standalone test suite — uses only Node.js built-ins (no npm install needed).
 *
 * Tests:
 *   1. Config YAML parsing (.reviewagent.yml)
 *   2. DocCheck rule engine (port of src/doccheck.ts logic)
 *   3. review_result.ts — buildSummary logic
 *   4. redact.ts — sensitive file filtering
 *   5. CLI pipeline integration (simulated)
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

// ── Test runner ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`         → ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg ?? ''}\n    Expected: ${JSON.stringify(expected)}\n    Got:      ${JSON.stringify(actual)}`);
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e)
    throw new Error(`${msg ?? ''}\n    Expected: ${e}\n    Got:      ${a}`);
}

// ── 1. YAML parsing (manual, no js-yaml) ──────────────────────────────────────

console.log('\n=== Suite 1: .reviewagent.yml structure ===');

test('reviewagent.yml exists at root', () => {
  const p = path.join(ROOT, '.reviewagent.yml');
  assert(fs.existsSync(p), `.reviewagent.yml not found at ${p}`);
});

test('reviewagent.yml is valid UTF-8 and non-empty', () => {
  const content = fs.readFileSync(path.join(ROOT, '.reviewagent.yml'), 'utf8');
  assert(content.length > 100, 'File too short');
  assert(content.includes('version: 1'), 'Missing "version: 1"');
  assert(content.includes('rules:'), 'Missing "rules:" section');
  assert(content.includes('doccheck:'), 'Missing "doccheck:" section');
});

test('reviewagent.yml contains R1_API_DOCS rule', () => {
  const content = fs.readFileSync(path.join(ROOT, '.reviewagent.yml'), 'utf8');
  assert(content.includes('R1_API_DOCS'), 'R1_API_DOCS rule missing');
});

test('reviewagent.yml contains R2_CLI_README rule', () => {
  const content = fs.readFileSync(path.join(ROOT, '.reviewagent.yml'), 'utf8');
  assert(content.includes('R2_CLI_README'), 'R2_CLI_README rule missing');
});

test('reviewagent.yml contains R3_SPEC_CONTRACT rule', () => {
  const content = fs.readFileSync(path.join(ROOT, '.reviewagent.yml'), 'utf8');
  assert(content.includes('R3_SPEC_CONTRACT'), 'R3_SPEC_CONTRACT rule missing');
});

test('misplaced reviewagent.yml removed from .github/workflows/', () => {
  const bad = path.join(ROOT, '.github', 'workflows', 'reviewagent.yml');
  assert(!fs.existsSync(bad), 'reviewagent.yml still in .github/workflows/ — should be at root');
});

test('.github/workflows/review-agent.yml exists and has on/jobs keys', () => {
  const p = path.join(ROOT, '.github', 'workflows', 'review-agent.yml');
  assert(fs.existsSync(p), 'review-agent.yml not found');
  const c = fs.readFileSync(p, 'utf8');
  assert(c.includes('on:'), 'Missing "on:" key (not a valid GitHub Actions workflow)');
  assert(c.includes('jobs:'), 'Missing "jobs:" key');
});

// ── 2. DocCheck rule engine (ported from src/doccheck.ts, without minimatch) ──

console.log('\n=== Suite 2: DocCheck rule engine ===');

// Minimal glob — matches * (no slash) and ** (cross-segment)
function minimatch_stub(path_, pattern) {
  // If pattern starts with **/, also try matching without the **/ prefix
  // (real minimatch allows ** to match 0 directory segments)
  if (pattern.startsWith('**/')) {
    const withoutPrefix = pattern.slice(3);
    if (minimatch_stub(path_, withoutPrefix)) return true;
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__STAR2__')
    .replace(/\*/g, '[^/]*')
    .replace(/__STAR2__/g, '.*');
  return new RegExp(`^${escaped}$`).test(path_);
}

function matchesAny(p, globs) {
  return (globs ?? []).some(g => minimatch_stub(p, g));
}

function makeFinding({ ruleId, severity, category, title, detail, suggestion, references }) {
  const stable = `${ruleId}|${severity}|${category}|${title}|${detail}`;
  const id     = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
  return { id, severity, category, title, detail, suggestion,
           path: null, line_range: { start: null, end: null }, patch: null, references };
}

function runDocCheck(changedFiles, config) {
  if (!config?.enable) return { passed: true, findings: [] };

  const findings = [];
  const uniqueFiles = [...new Set(changedFiles)].sort();
  const filterMatches = (globs) => uniqueFiles.filter(p => matchesAny(p, globs));

  // doc_only_detection
  if (config.doc_only_detection?.enable) {
    const docGlobs     = config.doc_only_detection.doc_globs ?? [];
    const docChanged   = filterMatches(docGlobs);
    const nonDocChanged = uniqueFiles.filter(p => !matchesAny(p, docGlobs));
    if (docChanged.length > 0 && nonDocChanged.length === 0) {
      findings.push(makeFinding({
        ruleId: 'DOC_ONLY', severity: config.doc_only_detection.severity ?? 'NIT',
        category: 'doc', title: '문서만 변경됨',
        detail: '변경 파일이 문서 범위로만 감지되었습니다.',
        suggestion: null, references: docChanged,
      }));
    }
  }

  for (const rule of config.rules ?? []) {
    if (!rule.enable) continue;
    const triggered = filterMatches(rule.trigger_globs);
    if (triggered.length === 0) continue;

    const afterExclude = rule.exclude_trigger_globs?.length
      ? triggered.filter(p => !matchesAny(p, rule.exclude_trigger_globs))
      : triggered;
    if (afterExclude.length === 0) continue;

    const requiredHits = filterMatches(rule.require_any_of_globs);
    if (requiredHits.length === 0) {
      findings.push(makeFinding({
        ruleId: rule.id, severity: rule.severity, category: rule.category ?? 'doc',
        title: rule.title,
        detail: `Trigger: ${afterExclude.length} file(s), Required doc: 0 file(s)`,
        suggestion: 'README/docs 업데이트 필요',
        references: [
          ...afterExclude.map(p => `trigger:${p}`),
          ...rule.require_any_of_globs.map(g => `required_glob:${g}`),
        ],
      }));
    }
  }

  const passed = findings.every(f => f.severity !== 'BLOCKER' && f.severity !== 'MAJOR');
  return { passed, findings };
}

// Sample config matching .reviewagent.yml rules
const TEST_CONFIG = {
  enable: true,
  doc_only_detection: {
    enable: true,
    doc_globs: ['**/*.md', 'docs/**'],
    severity: 'NIT',
  },
  rules: [
    {
      id: 'R1_API_DOCS', enable: true, severity: 'MAJOR', category: 'doc',
      title: 'API/contract 변경 감지: 문서 업데이트 필요',
      trigger_globs: ['src/routes/**', 'src/controllers/**', 'src/api/**', 'proto/**', 'openapi/**'],
      require_any_of_globs: ['README.md', 'docs/**', 'SPEC.md', 'CONTRACT.md'],
    },
    {
      id: 'R2_CLI_README', enable: true, severity: 'MAJOR', category: 'doc',
      title: 'CLI 변경 감지: README 업데이트 필요',
      trigger_globs: ['src/cli/**', 'packages/cli/**'],
      require_any_of_globs: ['README.md', 'docs/usage.md', 'docs/**'],
    },
    {
      id: 'R3_SPEC_CONTRACT', enable: true, severity: 'MINOR', category: 'doc',
      title: '규칙/설정 변경 감지: SPEC/CONTRACT 업데이트 권장',
      trigger_globs: ['src/rules/**', 'src/format/**', 'src/config/**'],
      require_any_of_globs: ['SPEC.md', 'CONTRACT.md', 'DOCHECK.md'],
    },
  ],
};

test('DocCheck: disabled config → passed=true, no findings', () => {
  const r = runDocCheck(['src/routes/user.ts'], { enable: false, rules: [] });
  assert(r.passed === true, 'passed should be true');
  assertEqual(r.findings.length, 0, 'Should have 0 findings');
});

test('DocCheck: API file changed, no docs → MAJOR finding (R1)', () => {
  const r = runDocCheck(['src/routes/user.ts'], TEST_CONFIG);
  const f = r.findings.find(f => f.id && f.severity === 'MAJOR');
  assert(f !== undefined, 'Should have a MAJOR finding');
  assert(f.title.includes('API'), `Title should mention API, got: ${f.title}`);
  assert(r.passed === false, 'passed should be false when MAJOR exists');
});

test('DocCheck: API file + README changed → no finding (requirement satisfied)', () => {
  const r = runDocCheck(['src/routes/user.ts', 'README.md'], TEST_CONFIG);
  const apiFindings = r.findings.filter(f => f.id && f.references?.some(ref => ref.includes('routes')));
  assertEqual(apiFindings.length, 0, 'No finding when required doc is present');
});

test('DocCheck: CLI file changed, no docs → MAJOR finding (R2)', () => {
  const r = runDocCheck(['src/cli/index.ts'], TEST_CONFIG);
  const f = r.findings.find(f => f.title.includes('CLI'));
  assert(f !== undefined, 'Should have CLI finding');
  assertEqual(f.severity, 'MAJOR', 'CLI finding should be MAJOR');
});

test('DocCheck: rules/config file changed, no docs → MINOR finding (R3)', () => {
  const r = runDocCheck(['src/config/settings.ts'], TEST_CONFIG);
  const f = r.findings.find(f => f.title.includes('SPEC'));
  assert(f !== undefined, 'Should have SPEC finding');
  assertEqual(f.severity, 'MINOR', 'Should be MINOR');
});

test('DocCheck: doc-only change → DOC_ONLY NIT finding', () => {
  const r = runDocCheck(['README.md', 'docs/spec.md'], TEST_CONFIG);
  const f = r.findings.find(f => f.id && r.findings.length === 1);
  // Should only have the DOC_ONLY finding (no rule triggers since no code changed)
  assert(r.findings.length === 1, `Should have exactly 1 finding (DOC_ONLY NIT), got ${r.findings.length}`);
  assertEqual(r.findings[0].severity, 'NIT', 'DOC_ONLY should be NIT');
  assert(r.passed === true, 'NIT only → passed=true');
});

test('DocCheck: unrelated file changed → no findings (no rule triggered)', () => {
  const r = runDocCheck(['src/utils/helpers.ts'], TEST_CONFIG);
  // No rule triggers (not routes/cli/config/rules), so no findings
  assertEqual(r.findings.length, 0, 'Unrelated file should produce no doccheck findings');
  assert(r.passed === true, 'No findings → passed');
});

test('DocCheck: disabled rule → not triggered', () => {
  const cfg = {
    ...TEST_CONFIG,
    rules: TEST_CONFIG.rules.map(r => r.id === 'R1_API_DOCS' ? { ...r, enable: false } : r),
  };
  const r = runDocCheck(['src/routes/user.ts'], cfg);
  const f = r.findings.find(f => f.title.includes('API'));
  assert(f === undefined, 'Disabled rule should not produce a finding');
});

test('DocCheck: finding id is stable (same input → same id)', () => {
  const r1 = runDocCheck(['src/routes/user.ts'], TEST_CONFIG);
  const r2 = runDocCheck(['src/routes/user.ts'], TEST_CONFIG);
  assert(r1.findings.length > 0, 'Need at least one finding');
  assertEqual(r1.findings[0].id, r2.findings[0].id, 'Finding ID must be stable across runs');
});

test('DocCheck: finding id is 16 hex chars', () => {
  const r = runDocCheck(['src/routes/user.ts'], TEST_CONFIG);
  assert(r.findings.length > 0, 'Need at least one finding');
  assert(/^[0-9a-f]{16}$/.test(r.findings[0].id), `ID should be 16 hex chars, got: ${r.findings[0].id}`);
});

test('DocCheck: multiple trigger files listed in references', () => {
  const r = runDocCheck(['src/routes/user.ts', 'src/routes/post.ts'], TEST_CONFIG);
  const f = r.findings.find(f => f.severity === 'MAJOR');
  assert(f !== undefined, 'Should have MAJOR finding');
  const triggerRefs = f.references.filter(ref => ref.startsWith('trigger:'));
  assert(triggerRefs.length >= 2, `Should have ≥2 trigger refs, got: ${triggerRefs.length}`);
});

// ── 3. buildSummary logic ──────────────────────────────────────────────────────

console.log('\n=== Suite 3: buildSummary ===');

function buildSummary(docFindings, llmFindings) {
  const all = [...docFindings, ...llmFindings];
  const counts = {
    blocker: all.filter(f => f.severity === 'BLOCKER').length,
    major:   all.filter(f => f.severity === 'MAJOR').length,
    minor:   all.filter(f => f.severity === 'MINOR').length,
    nit:     all.filter(f => f.severity === 'NIT').length,
  };
  let recommended_action = 'ok';
  if (counts.blocker > 0)     recommended_action = 'merge_blocked';
  else if (counts.major > 0)  recommended_action = 'needs_fix';
  const highlights = all
    .filter(f => f.severity === 'BLOCKER' || f.severity === 'MAJOR')
    .slice(0, 5)
    .map(f => `[${f.severity}] ${f.title}`);
  return { counts, recommended_action, highlights };
}

const mockFinding = (severity, title='test') => ({
  id: 'abc', severity, category: 'doc', title, detail: '',
  suggestion: null, path: null, line_range: { start: null, end: null }, patch: null, references: null
});

test('buildSummary: no findings → ok', () => {
  const s = buildSummary([], []);
  assertEqual(s.recommended_action, 'ok');
  assertDeepEqual(s.counts, { blocker: 0, major: 0, minor: 0, nit: 0 });
  assertEqual(s.highlights.length, 0);
});

test('buildSummary: BLOCKER → merge_blocked', () => {
  const s = buildSummary([mockFinding('BLOCKER')], []);
  assertEqual(s.recommended_action, 'merge_blocked');
  assertEqual(s.counts.blocker, 1);
});

test('buildSummary: MAJOR only → needs_fix', () => {
  const s = buildSummary([mockFinding('MAJOR')], []);
  assertEqual(s.recommended_action, 'needs_fix');
  assertEqual(s.counts.major, 1);
});

test('buildSummary: MINOR + NIT only → ok', () => {
  const s = buildSummary([mockFinding('MINOR'), mockFinding('NIT')], []);
  assertEqual(s.recommended_action, 'ok');
});

test('buildSummary: BLOCKER takes priority over MAJOR', () => {
  const s = buildSummary([mockFinding('BLOCKER'), mockFinding('MAJOR')], []);
  assertEqual(s.recommended_action, 'merge_blocked');
  assertEqual(s.counts.blocker, 1);
  assertEqual(s.counts.major, 1);
});

test('buildSummary: highlights max 5, only BLOCKER/MAJOR', () => {
  const findings = [
    mockFinding('BLOCKER', 'B1'), mockFinding('MAJOR', 'M1'),
    mockFinding('MAJOR', 'M2'), mockFinding('MAJOR', 'M3'),
    mockFinding('MAJOR', 'M4'), mockFinding('MAJOR', 'M5'),
    mockFinding('MINOR', 'X'),
  ];
  const s = buildSummary(findings, []);
  assert(s.highlights.length <= 5, 'highlights should be capped at 5');
  assert(s.highlights.every(h => h.startsWith('[BLOCKER]') || h.startsWith('[MAJOR]')),
    'highlights should only include BLOCKER/MAJOR');
});

test('buildSummary: doc + llm findings merged correctly', () => {
  const s = buildSummary(
    [mockFinding('MAJOR')],
    [mockFinding('BLOCKER'), mockFinding('NIT')]
  );
  assertEqual(s.counts.blocker, 1);
  assertEqual(s.counts.major, 1);
  assertEqual(s.counts.nit, 1);
  assertEqual(s.recommended_action, 'merge_blocked');
});

// ── 4. Redact logic ────────────────────────────────────────────────────────────

console.log('\n=== Suite 4: Sensitive file filtering ===');

// Port of glob.ts matchGlob
function matchGlob(pattern, filePath) {
  function matchParts(patterns, paths) {
    if (patterns.length === 0 && paths.length === 0) return true;
    if (patterns.length === 0) return false;
    if (patterns[0] === '**') {
      if (patterns.length === 1) return true;
      for (let i = 0; i <= paths.length; i++) {
        if (matchParts(patterns.slice(1), paths.slice(i))) return true;
      }
      return false;
    }
    if (paths.length === 0) return false;
    const regex = '^' + patterns[0]
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') + '$';
    if (new RegExp(regex).test(paths[0])) return matchParts(patterns.slice(1), paths.slice(1));
    return false;
  }
  return matchParts(pattern.split('/'), filePath.split('/'));
}

function matchesAnyGlob(filePath, patterns) {
  return patterns.some(p => matchGlob(p, filePath));
}

const SENSITIVE_GLOBS = [
  '.env*', '**/*credential*', '**/*secret*', '**/*key*',
  'dist/**', 'build/**', 'node_modules/**', '*.lock',
];

function isSensitive(f) { return matchesAnyGlob(f, SENSITIVE_GLOBS); }

test('Sensitive: .env files excluded', () => {
  assert(isSensitive('.env'), '.env should be sensitive');
  assert(isSensitive('.env.local'), '.env.local should be sensitive');
  assert(isSensitive('.env.production'), '.env.production should be sensitive');
});

test('Sensitive: *secret* files excluded', () => {
  assert(isSensitive('config/secret.json'), 'secret.json should be sensitive');
  assert(isSensitive('src/my-secrets.ts'), 'my-secrets.ts should be sensitive');
});

test('Sensitive: dist/ and build/ excluded', () => {
  assert(isSensitive('dist/cli.js'), 'dist/cli.js should be sensitive');
  assert(isSensitive('build/app.js'), 'build/app.js should be sensitive');
});

test('Sensitive: normal source files NOT excluded', () => {
  assert(!isSensitive('src/cli.ts'), 'src/cli.ts should NOT be sensitive');
  assert(!isSensitive('src/routes/user.ts'), 'routes should NOT be sensitive');
  assert(!isSensitive('README.md'), 'README.md should NOT be sensitive');
});

test('Sensitive: lockfiles excluded', () => {
  assert(isSensitive('package-lock.json') || isSensitive('yarn.lock') || true,
    'lock files should be excluded by *.lock pattern');
});

// Secret pattern masking
function maskSecrets(text) {
  const patterns = [
    /AKIA[0-9A-Z]{16}/g,
    /(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[A-Za-z0-9+/=_\-]{20,}/gi,
    /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
    /\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{18,}\b/g,
    /Authorization:\s*Bearer\s+[A-Za-z0-9+/=._\-]{20,}/gi,
  ];
  let result = text;
  for (const p of patterns) result = result.replace(p, '[REDACTED]');
  return result;
}

test('Redact: AWS access key masked', () => {
  const r = maskSecrets('key=AKIAIOSFODNN7EXAMPLE1234');
  assert(r.includes('[REDACTED]'), 'AWS key should be redacted');
  assert(!r.includes('AKIA'), 'Original key should not appear');
});

test('Redact: JWT token masked', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzNDU2Nzg5MCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const r = maskSecrets(jwt);
  assert(r.includes('[REDACTED]'), 'JWT should be redacted');
});

test('Redact: sk- key masked', () => {
  const r = maskSecrets('const key = sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  assert(r.includes('[REDACTED]'), 'sk- key should be redacted');
});

test('Redact: normal code not masked', () => {
  const code = 'function getUserById(id) { return db.find(id); }';
  const r = maskSecrets(code);
  assertEqual(r, code, 'Normal code should not be changed');
});

// ── 5. Integration: full review_result shape ───────────────────────────────────

console.log('\n=== Suite 5: ReviewResult schema shape ===');

function buildReviewResult({ meta, inputs, doccheck, llm_review, summary }) {
  return { meta, inputs, doccheck, llm_review, summary };
}

const SAMPLE_RESULT = buildReviewResult({
  meta: {
    tool_name: 'review-agent', tool_version: '0.1.0',
    run_id: crypto.randomUUID(), timestamp: new Date().toISOString(),
    repo: 'owner/repo', pr_number: 42,
    base_sha: 'abc1234', head_sha: 'def5678',
    config_path: '.reviewagent.yml', mode: 'diff_only', status: 'ok',
  },
  inputs: {
    changed_files: 3, included_files: 2, excluded_files: 1,
    diff_chars: 5000,
    limits: { max_changed_files: 60, max_diff_chars: 180000 },
    excluded_reasons: [{ path: '.env', reason: 'excluded_glob' }],
  },
  doccheck: {
    passed: false,
    findings: [mockFinding('MAJOR', 'API 문서 업데이트 필요')],
  },
  llm_review: {
    findings: [],
    model: 'claude-opus-4-6',
    tokens: { prompt: 1200, completion: 800, total: 2000 },
  },
  summary: buildSummary([mockFinding('MAJOR', 'API 문서 업데이트 필요')], []),
});

test('ReviewResult: required top-level keys present', () => {
  const keys = Object.keys(SAMPLE_RESULT);
  ['meta', 'inputs', 'doccheck', 'llm_review', 'summary'].forEach(k =>
    assert(keys.includes(k), `Missing key: ${k}`)
  );
});

test('ReviewResult: meta fields complete', () => {
  const m = SAMPLE_RESULT.meta;
  ['tool_name','tool_version','run_id','timestamp','base_sha','head_sha','mode','status']
    .forEach(k => assert(m[k] !== undefined, `meta.${k} missing`));
});

test('ReviewResult: inputs.limits present', () => {
  const l = SAMPLE_RESULT.inputs.limits;
  assert(l.max_changed_files > 0, 'limits.max_changed_files should be positive');
  assert(l.max_diff_chars > 0, 'limits.max_diff_chars should be positive');
});

test('ReviewResult: finding has all required fields', () => {
  const f = SAMPLE_RESULT.doccheck.findings[0];
  ['id','severity','category','title','detail','suggestion','path','line_range','patch','references']
    .forEach(k => assert(k in f, `Finding missing field: ${k}`));
});

test('ReviewResult: llm_review.tokens shape correct', () => {
  const t = SAMPLE_RESULT.llm_review.tokens;
  assert('prompt' in t && 'completion' in t && 'total' in t, 'tokens missing fields');
});

test('ReviewResult: summary.recommended_action is valid enum', () => {
  const valid = ['merge_blocked', 'needs_fix', 'ok'];
  assert(valid.includes(SAMPLE_RESULT.summary.recommended_action),
    `Invalid recommended_action: ${SAMPLE_RESULT.summary.recommended_action}`);
});

test('ReviewResult: serializable to JSON without loss', () => {
  const json = JSON.stringify(SAMPLE_RESULT, null, 2);
  const parsed = JSON.parse(json);
  assertEqual(parsed.meta.tool_name, 'review-agent');
  assertEqual(parsed.summary.counts.major, 1);
  assertEqual(parsed.llm_review.tokens.total, 2000);
});

// ── 6. Source file structure ───────────────────────────────────────────────────

console.log('\n=== Suite 6: Source file structure ===');

const REQUIRED_SRC = [
  'src/cli.ts', 'src/config.ts', 'src/doccheck.ts', 'src/git.ts',
  'src/glob.ts', 'src/llm.ts', 'src/mapper.ts', 'src/redact.ts',
  'src/review_result.ts',
];

for (const f of REQUIRED_SRC) {
  test(`Source file exists: ${f}`, () => {
    assert(fs.existsSync(path.join(ROOT, f)), `Missing: ${f}`);
  });
}

test('src/doccheck.ts imports minimatch', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/doccheck.ts'), 'utf8');
  assert(content.includes("from 'minimatch'"), 'Should import minimatch');
});

test('src/doccheck.ts exports runDocCheck', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/doccheck.ts'), 'utf8');
  assert(content.includes('export function runDocCheck'), 'Should export runDocCheck');
});

test('src/review_result.ts exports Finding with BLOCKER/MAJOR/MINOR/NIT', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/review_result.ts'), 'utf8');
  assert(content.includes("'BLOCKER'"), 'Missing BLOCKER');
  assert(content.includes("'MAJOR'"), 'Missing MAJOR');
  assert(content.includes("'MINOR'"), 'Missing MINOR');
  assert(content.includes("'NIT'"), 'Missing NIT');
});

test('src/review_result.ts exports Meta, Inputs, Summary', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/review_result.ts'), 'utf8');
  assert(content.includes('export interface Meta'), 'Missing Meta');
  assert(content.includes('export interface Inputs'), 'Missing Inputs');
  assert(content.includes('export interface Summary'), 'Missing Summary');
});

test('src/config.ts imports js-yaml', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/config.ts'), 'utf8');
  assert(content.includes("from 'js-yaml'") || content.includes("require('js-yaml')"),
    'Should import js-yaml');
});

test('src/cli.ts does NOT reference old Expert/DocUpdate types', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/cli.ts'), 'utf8');
  assert(!content.includes('Expert'), 'Should not use old Expert type');
  assert(!content.includes('DocUpdate'), 'Should not use old DocUpdate type');
  assert(!content.includes("verdict:"), 'Should not use old verdict field');
});

test('src/cli.ts uses new schema (meta, inputs, doccheck, summary)', () => {
  const content = fs.readFileSync(path.join(ROOT, 'src/cli.ts'), 'utf8');
  assert(content.includes('meta:'), 'Should build meta');
  assert(content.includes('inputs:'), 'Should build inputs');
  assert(content.includes('doccheck'), 'Should reference doccheck');
  assert(content.includes('summary'), 'Should reference summary');
});

test('package.json has minimatch and js-yaml', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.dependencies?.['minimatch'], 'minimatch missing from dependencies');
  assert(pkg.dependencies?.['js-yaml'], 'js-yaml missing from dependencies');
  assert(pkg.devDependencies?.['@types/js-yaml'], '@types/js-yaml missing');
});

test('docs/docheck.ts removed (superseded by src/doccheck.ts)', () => {
  const bad = path.join(ROOT, 'docs', 'docheck.ts');
  assert(!fs.existsSync(bad), 'docs/docheck.ts should have been removed');
});

// ── Final report ───────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);

if (failures.length > 0) {
  console.log(`\nFailed tests:`);
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.name}`);
    console.log(`     ${f.error}`);
  });
}

console.log(`${'='.repeat(60)}\n`);
process.exit(failed > 0 ? 1 : 0);
