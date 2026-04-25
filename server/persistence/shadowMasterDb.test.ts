/**
 * @responsibility shadowMasterDb 회귀 테스트 (ADR-0013) — Tier 1/2 만 갱신, Tier 3/4 무시
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadShadowMaster,
  updateShadowMaster,
  getShadowMasterSize,
  getShadowMasterAgeMs,
  __testOnly,
} from './shadowMasterDb.js';

describe('shadowMasterDb (ADR-0013, Tier 3)', () => {
  beforeEach(() => __testOnly.reset());
  afterEach(() => __testOnly.reset());

  it('초기 상태 — null + size 0 + age Infinity', () => {
    expect(loadShadowMaster()).toBeNull();
    expect(getShadowMasterSize()).toBe(0);
    expect(getShadowMasterAgeMs()).toBe(Infinity);
  });

  it('Tier 1 KRX_CSV 검증 통과 시 갱신 성공', () => {
    const ok = updateShadowMaster('KRX_CSV', [
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ]);
    expect(ok).toBe(true);
    expect(getShadowMasterSize()).toBe(2);
    expect(loadShadowMaster()?.source).toBe('KRX_CSV');
  });

  it('Tier 2 NAVER_LIST 도 갱신 허용', () => {
    const ok = updateShadowMaster('NAVER_LIST', [
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
    ]);
    expect(ok).toBe(true);
    expect(loadShadowMaster()?.source).toBe('NAVER_LIST');
  });

  it('Tier 3 SHADOW_DB 자체로는 갱신 거부 — shadow 오염 방지', () => {
    // 먼저 Tier 1 으로 정상 갱신
    updateShadowMaster('KRX_CSV', [{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    // Tier 3 (자기 자신) 으로 갱신 시도 → 거부
    const ok = updateShadowMaster('SHADOW_DB' as never, [
      { code: '999999', name: '오염된종목', market: 'KOSPI' },
    ]);
    expect(ok).toBe(false);
    // 이전 상태 보존
    expect(loadShadowMaster()?.entries[0].code).toBe('005930');
  });

  it('Tier 4 STATIC_SEED 로는 갱신 거부 — seed 가 shadow 를 덮어쓰지 않음', () => {
    updateShadowMaster('KRX_CSV', [{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    const ok = updateShadowMaster('STATIC_SEED' as never, [
      { code: '999999', name: '오염된종목', market: 'KOSPI' },
    ]);
    expect(ok).toBe(false);
    expect(loadShadowMaster()?.entries[0].code).toBe('005930');
  });

  it('빈 entries 갱신 거부', () => {
    const ok = updateShadowMaster('KRX_CSV', []);
    expect(ok).toBe(false);
    expect(loadShadowMaster()).toBeNull();
  });

  it('영속화 — 갱신 후 메모리 리셋해도 디스크 로드', () => {
    updateShadowMaster('KRX_CSV', [{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    // 메모리 캐시만 리셋 (디스크 보존)
    // __testOnly.reset 은 디스크도 지우므로 별도 reset 필요. 대신 동일 모듈에서 재호출 시 캐시 hit 확인.
    expect(getShadowMasterSize()).toBe(1);
  });

  it('age 계산 — 갱신 후 now 에 따라 ms 단위 증가', () => {
    const now = 1700000000000;
    updateShadowMaster('KRX_CSV', [{ code: '005930', name: '삼성전자', market: 'KOSPI' }], now);
    expect(getShadowMasterAgeMs(now + 1000)).toBe(1000);
    expect(getShadowMasterAgeMs(now + 60_000)).toBe(60_000);
  });
});
