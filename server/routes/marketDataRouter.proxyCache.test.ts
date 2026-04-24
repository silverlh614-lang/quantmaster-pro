/**
 * @responsibility Yahoo 프록시 LRU 캐시 헬퍼 단위 테스트 — ADR-0009
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  proxyCacheGet,
  proxyCacheSet,
  proxyCacheReset,
  proxyCacheSize,
} from './marketDataRouter.js';

describe('marketDataRouter — Yahoo 프록시 LRU 캐시', () => {
  beforeEach(() => proxyCacheReset());
  afterEach(() => proxyCacheReset());

  it('set 후 get 은 동일 엔트리를 반환한다', () => {
    proxyCacheSet('AAPL:1y:1d', {
      body: '{"chart":"ok"}',
      contentType: 'application/json',
      expiresAt: Date.now() + 60_000,
    });
    const hit = proxyCacheGet('AAPL:1y:1d');
    expect(hit?.body).toBe('{"chart":"ok"}');
  });

  it('expiresAt 경과 시 자동 폐기되어 miss 로 전환된다', () => {
    proxyCacheSet('MSFT:1d:5m', {
      body: '{"x":1}',
      contentType: 'application/json',
      expiresAt: Date.now() - 1,
    });
    expect(proxyCacheGet('MSFT:1d:5m')).toBeNull();
  });

  it('최대 500 엔트리 초과 시 가장 오래된 엔트리부터 폐기된다 (LRU)', () => {
    for (let i = 0; i < 505; i++) {
      proxyCacheSet(`S${i}:1y:1d`, {
        body: `{"i":${i}}`,
        contentType: 'application/json',
        expiresAt: Date.now() + 60_000,
      });
    }
    expect(proxyCacheSize()).toBeLessThanOrEqual(500);
    // 가장 초창기 엔트리 S0~S4 는 폐기되어야 한다
    expect(proxyCacheGet('S0:1y:1d')).toBeNull();
    expect(proxyCacheGet('S504:1y:1d')).not.toBeNull();
  });

  it('get 이 LRU 를 갱신하여 최근 접근 엔트리가 보존된다', () => {
    // 소규모 시뮬레이션: 1~3 넣고 1 을 다시 접근 후 4 추가 — 가장 오래된 건 2
    proxyCacheSet('A:1:1', { body: '1', contentType: 'application/json', expiresAt: Date.now() + 60_000 });
    proxyCacheSet('B:1:1', { body: '2', contentType: 'application/json', expiresAt: Date.now() + 60_000 });
    proxyCacheSet('C:1:1', { body: '3', contentType: 'application/json', expiresAt: Date.now() + 60_000 });
    proxyCacheGet('A:1:1'); // A 를 최신으로 옮김
    // 504 개 더 채워 최대 한도(500) 가 되게 한다
    for (let i = 0; i < 498; i++) {
      proxyCacheSet(`F${i}:x:x`, { body: String(i), contentType: 'application/json', expiresAt: Date.now() + 60_000 });
    }
    // 이제 한도 500 이므로 가장 오래된 B 가 폐기되었어야 한다 (A 는 갱신되어 보존)
    expect(proxyCacheGet('B:1:1')).toBeNull();
    expect(proxyCacheGet('A:1:1')).not.toBeNull();
  });
});
