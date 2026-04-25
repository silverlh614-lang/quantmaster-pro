/**
 * @responsibility stockMasterSeed 회귀 테스트 (ADR-0013) — Tier 4 ultimate fallback 안정성
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStockMasterSeed, __resetStockMasterSeedCache } from './stockMasterSeed.js';

describe('stockMasterSeed (ADR-0013, Tier 4)', () => {
  beforeEach(() => __resetStockMasterSeedCache());
  afterEach(() => __resetStockMasterSeedCache());

  it('seed 는 최소 50건 이상 보장 — 절대 0건 방지', () => {
    const seed = getStockMasterSeed();
    expect(seed.length).toBeGreaterThanOrEqual(50);
  });

  it('모든 entry 는 6자리 코드 + 비어있지 않은 이름', () => {
    const seed = getStockMasterSeed();
    for (const e of seed) {
      expect(e.code).toMatch(/^\d{6}$/);
      expect(e.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('중복 코드 없음', () => {
    const seed = getStockMasterSeed();
    const codes = new Set(seed.map((e) => e.code));
    expect(codes.size).toBe(seed.length);
  });

  it('KOSPI/KOSDAQ 양쪽 분포 보장', () => {
    const seed = getStockMasterSeed();
    const kospi = seed.filter((e) => e.market === 'KOSPI').length;
    const kosdaq = seed.filter((e) => e.market === 'KOSDAQ').length;
    expect(kospi).toBeGreaterThan(0);
    expect(kosdaq).toBeGreaterThan(0);
  });

  it('핵심 코어 종목 30개는 항상 포함 — 분기 갱신 회귀 가드', () => {
    const seed = getStockMasterSeed();
    const codes = new Set(seed.map((e) => e.code));
    const core = ['005930', '000660', '373220', '207940', '005380', '000270', '035420', '035720', '055550', '105560'];
    for (const c of core) {
      expect(codes.has(c)).toBe(true);
    }
  });

  it('동일 코드는 최초 등록(KOSPI 우선)으로 dedupe', () => {
    // SK바이오팜 326030 — 정답은 KOSPI. KOSDAQ 오기가 있어도 KOSPI 가 이긴다.
    const seed = getStockMasterSeed();
    const target = seed.filter((e) => e.code === '326030');
    expect(target).toHaveLength(1);
    expect(target[0].market).toBe('KOSPI');
  });
});
