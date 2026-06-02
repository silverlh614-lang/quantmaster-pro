// @responsibility 동적 유니버스 admit 가드 단위 테스트 — 합성/비실재 코드(999xxx) 차단, KRX 실재 코드만 admit.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// KRX 마스터 상태를 테스트가 제어 (디스크 비오염: 실모듈 export 보존 + 두 함수만 override).
const master = { size: 0, codes: new Set<string>() };

vi.mock('../clients/kisRankingClient.js', () => ({
  getRanking: vi.fn(async () => []),
  resetRankingCache: vi.fn(),
  getRankingCacheSnapshot: vi.fn(() => []),
}));
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../persistence/krxStockMasterRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../persistence/krxStockMasterRepo.js')>()),
  getMasterSize: () => master.size,
  getStockByCode: (code: string) => (master.codes.has(code) ? ({ code } as unknown) : null),
}));

import { isAdmissibleDynamicCode } from './dynamicUniverseExpander.js';

describe('isAdmissibleDynamicCode — 신뢰 무결성 가드 (999xxx 합성코드 차단)', () => {
  beforeEach(() => {
    master.size = 0;
    master.codes = new Set();
  });

  it('6자리 숫자가 아닌 코드는 거부 (형식 가드)', () => {
    expect(isAdmissibleDynamicCode('99900')).toBe(false); // 5자리
    expect(isAdmissibleDynamicCode('1234567')).toBe(false); // 7자리
    expect(isAdmissibleDynamicCode('abcdef')).toBe(false);
    expect(isAdmissibleDynamicCode('')).toBe(false);
  });

  it('마스터 로드 시 KRX 실재 코드만 admit — 합성 999001/999002 거부', () => {
    master.size = 2000;
    master.codes = new Set(['005930', '023790']);
    expect(isAdmissibleDynamicCode('005930')).toBe(true);
    expect(isAdmissibleDynamicCode('023790')).toBe(true);
    expect(isAdmissibleDynamicCode('999001')).toBe(false); // 가상종목A
    expect(isAdmissibleDynamicCode('999002')).toBe(false); // 가상종목B
    expect(isAdmissibleDynamicCode('123456')).toBe(false); // 실재하지 않는 코드
  });

  it('마스터 미하이드레이트(임계 1500 미만)면 형식만 통과 — 유니버스 과축소 방지', () => {
    master.size = 100;
    expect(isAdmissibleDynamicCode('999001')).toBe(true); // 멤버십 검증 skip (형식 OK)
    expect(isAdmissibleDynamicCode('005930')).toBe(true);
    expect(isAdmissibleDynamicCode('99900')).toBe(false); // 형식 가드는 항상 적용
  });
});
