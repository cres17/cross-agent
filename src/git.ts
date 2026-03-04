/**
 * git.ts
 * git 관련 헬퍼: SHA 계산 + 변경 파일 목록 + diff 내용 추출
 */
import { execSync } from 'child_process';

export interface Shas {
  base: string;
  head: string;
}

/**
 * base/head SHA를 결정한다.
 *
 * 우선순위:
 *   1) GITHUB_BASE_SHA + GITHUB_HEAD_SHA 환경변수 (GitHub Actions에서 주입)
 *   2) git merge-base origin/main HEAD (로컬/fallback)
 *   3) HEAD~1..HEAD (최후 fallback)
 */
export function resolveShas(): Shas {
  const envBase = process.env['GITHUB_BASE_SHA'];
  const envHead = process.env['GITHUB_HEAD_SHA'];

  if (envBase && envHead) {
    console.log('[git] Using SHAs from environment variables');
    return { base: envBase, head: envHead };
  }

  try {
    const base = execSync('git merge-base origin/main HEAD', {
      encoding: 'utf8',
      stdio:    ['ignore', 'pipe', 'pipe'],
    }).trim();

    const head = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio:    ['ignore', 'pipe', 'pipe'],
    }).trim();

    console.log('[git] Resolved SHAs via git merge-base');
    return { base, head };
  } catch (err) {
    console.warn(`[git] git merge-base failed: ${(err as Error).message}`);
    console.warn('[git] Falling back to HEAD~1..HEAD');
    return { base: 'HEAD~1', head: 'HEAD' };
  }
}

/**
 * `git diff --name-only <base> <head>` 로 변경 파일 목록을 반환한다.
 */
export function getChangedFiles(base: string, head: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${base} ${head}`, {
      encoding:  'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      stdio:     ['ignore', 'pipe', 'pipe'],
    });
    return output
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
  } catch (err) {
    console.warn(`[git] git diff --name-only failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * `git diff <base> <head>` 로 전체 diff 내용(patch)을 반환한다.
 * Redaction 전 원본이므로 LLM 전송 전 반드시 prepareForLlm()을 거쳐야 한다.
 */
export function getDiff(base: string, head: string): string {
  try {
    return execSync(`git diff ${base} ${head}`, {
      encoding:  'utf8',
      maxBuffer: 20 * 1024 * 1024, // 20 MB
      stdio:     ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.warn(`[git] git diff failed: ${(err as Error).message}`);
    return '';
  }
}
