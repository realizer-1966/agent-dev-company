import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 러너 구조 확인용 플레이스홀더 테스트 (스캐폴딩 티켓 ①).
 * - 실제 코어 로직 케이스(9장 수용기준)는 후속 TDD 티켓 ②가 채운다.
 * - 모듈별 구조 테스트는 tests/*.test.js 참조.
 */

test('node --test 러너 동작 확인 (플레이스홀더)', () => {
  assert.equal(1 + 1, 2, '러너가 단순 단언을 처리해야 한다');
});

test('Node 22 이상 확인 (node --test 내장 러너 기준)', () => {
  const [major] = process.versions.node.split('.').map(Number);
  assert.ok(
    Number.isFinite(major) && major >= 22,
    `Node 22 이상이 필요하다 (현재 ${process.versions.node})`
  );
});