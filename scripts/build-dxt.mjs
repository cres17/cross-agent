/**
 * scripts/build-dxt.mjs
 *
 * pr-review-agent.dxt 패키지를 빌드합니다.
 *
 * 포함 내용:
 *   manifest.json       — DXT 메타데이터
 *   mcp-server.mjs      — MCP 서버 진입점
 *   dist/               — 컴파일된 TypeScript (DocCheck, redact, config 등)
 *   node_modules/       — 런타임 의존성만 (MCP SDK, js-yaml, minimatch)
 *
 * 사용법:
 *   npm run build:dxt
 */

import { execSync }                          from 'child_process';
import { existsSync, mkdirSync, rmSync,
         copyFileSync, readdirSync,
         statSync, writeFileSync }           from 'fs';
import { join, resolve, dirname }            from 'path';
import { fileURLToPath }                     from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const TEMP_DIR   = join(ROOT, 'dxt-package');
const OUTPUT     = join(ROOT, 'pr-review-agent.dxt');

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[build-dxt] ${msg}\n`);
}

function run(cmd, cwd = ROOT) {
  log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath  = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ── Step 1: TypeScript 빌드 ────────────────────────────────────────────────────

log('Step 1: TypeScript 빌드');
if (!existsSync(join(ROOT, 'dist'))) {
  run('npm run build');
} else {
  log('  dist/ 이미 존재 — 빌드 스킵 (강제 빌드: npm run build 먼저 실행)');
}

// ── Step 2: 임시 디렉토리 초기화 ──────────────────────────────────────────────

log('Step 2: 패키지 디렉토리 초기화');
if (existsSync(TEMP_DIR)) {
  rmSync(TEMP_DIR, { recursive: true, force: true });
}
mkdirSync(TEMP_DIR, { recursive: true });

// ── Step 3: 파일 복사 ─────────────────────────────────────────────────────────

log('Step 3: 파일 복사');
copyFileSync(join(ROOT, 'manifest.json'),    join(TEMP_DIR, 'manifest.json'));
copyFileSync(join(ROOT, 'mcp-server.mjs'),   join(TEMP_DIR, 'mcp-server.mjs'));
copyDir(join(ROOT, 'dist'),                  join(TEMP_DIR, 'dist'));
log('  manifest.json, mcp-server.mjs, dist/ 복사 완료');

// ── Step 4: 런타임 의존성만 설치 ──────────────────────────────────────────────

log('Step 4: 런타임 의존성 설치');

// @anthropic-ai/sdk는 MCP 모드에서 불필요 — 제외
const runtimePkg = {
  name: 'pr-review-agent',
  version: '0.1.0',
  type: 'module',
  dependencies: {
    '@modelcontextprotocol/sdk': '^1.0.0',
    'js-yaml':   '^4.1.0',
    'minimatch': '^9.0.0',
  },
};
writeFileSync(
  join(TEMP_DIR, 'package.json'),
  JSON.stringify(runtimePkg, null, 2),
);
run('npm install --production --no-audit --no-fund', TEMP_DIR);
log('  node_modules 설치 완료');

// ── Step 5: ZIP → .dxt ────────────────────────────────────────────────────────

log('Step 5: .dxt 패키지 생성');

if (existsSync(OUTPUT)) {
  rmSync(OUTPUT);
}

// Windows(PowerShell) / Unix(zip) 자동 선택
const isWindows = process.platform === 'win32';

if (isWindows) {
  // PowerShell Compress-Archive는 .zip만 지원 → .zip으로 만들고 .dxt로 rename
  const zipOutput = OUTPUT.replace(/\.dxt$/, '.zip');
  const tempWin   = TEMP_DIR.replace(/\//g, '\\');
  const zipWin    = zipOutput.replace(/\//g, '\\');
  const dxtWin    = OUTPUT.replace(/\//g, '\\');
  if (existsSync(zipOutput)) rmSync(zipOutput);
  run(
    `powershell -Command "Compress-Archive -Path '${tempWin}\\*' -DestinationPath '${zipWin}' -Force"`,
    ROOT,
  );
  run(`powershell -Command "Rename-Item -Path '${zipWin}' -NewName '${dxtWin}'"`, ROOT);
} else {
  run(`zip -r "${OUTPUT}" .`, TEMP_DIR);
}

log(`  생성 완료: pr-review-agent.dxt`);

// ── Step 6: 임시 디렉토리 정리 ────────────────────────────────────────────────

log('Step 6: 임시 디렉토리 정리');
rmSync(TEMP_DIR, { recursive: true, force: true });

log('');
log('✓ pr-review-agent.dxt 빌드 완료!');
log('');
log('설치 방법:');
log('  Claude Desktop → Settings → Developer → pr-review-agent.dxt 드래그앤드롭');
