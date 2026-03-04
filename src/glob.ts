/**
 * glob.ts — 최소 글로브 패턴 매처 (외부 의존성 없음)
 *
 * 지원 패턴:
 *   **  — 0개 이상의 경로 세그먼트에 매칭 (디렉토리 재귀)
 *   *   — 단일 세그먼트 내 임의 문자열에 매칭 (/ 제외)
 *   .   — 리터럴 점
 */

/**
 * 단일 경로 세그먼트를 패턴과 비교한다.
 * `*`는 세그먼트 내 임의 문자열에 매칭 (슬래시 제외).
 */
function matchSegment(pattern: string, segment: string): boolean {
  const regex =
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 정규식 특수문자 이스케이프 (* 제외)
      .replace(/\*/g, '.*') +               // * → .*
    '$';
  return new RegExp(regex).test(segment);
}

/**
 * 패턴 세그먼트 배열과 경로 세그먼트 배열을 재귀 비교한다.
 * `**`는 0개 이상의 경로 세그먼트에 매칭된다.
 */
function matchParts(patterns: string[], paths: string[]): boolean {
  if (patterns.length === 0 && paths.length === 0) return true;
  if (patterns.length === 0) return false;

  if (patterns[0] === '**') {
    if (patterns.length === 1) return true; // ** 이후 패턴 없으면 나머지 전부 매칭
    for (let i = 0; i <= paths.length; i++) {
      if (matchParts(patterns.slice(1), paths.slice(i))) return true;
    }
    return false;
  }

  if (paths.length === 0) return false;

  if (matchSegment(patterns[0], paths[0])) {
    return matchParts(patterns.slice(1), paths.slice(1));
  }

  return false;
}

/**
 * 글로브 패턴 1개와 파일 경로를 비교한다.
 * 경로 구분자: '/' (git diff 출력 형식과 동일).
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  return matchParts(pattern.split('/'), filePath.split('/'));
}

/**
 * 파일 경로가 패턴 목록 중 하나라도 일치하면 true를 반환한다.
 */
export function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some(p => matchGlob(p, filePath));
}
