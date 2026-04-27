/**
 * @responsibility counterfactualTwinPortfolio 회귀 테스트 (ADR-0029 PR-M)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-portfolio-test-'));
process.env.PERSIST_DATA_DIR = TMP_DIR;

const {
  recordTwinEntries,
  refreshTwinPortfolio,
  compareTwinsVsReal,
  detectPromotion,
  getAllTwinEntries,
  __resetTwinPortfolioForTests,
  TWIN_POLICIES,
  ALL_TWIN_KEYS,
  TWIN_HORIZON_DAYS,
  TWIN_EQUAL_WEIGHT,
  PROMOTION_CONSECUTIVE_WEEKS,
} = await import('./counterfactualTwinPortfolio.js');

beforeEach(() => {
  __resetTwinPortfolioForTests();
});

describe('TWIN_POLICIES — SSOT 정합성', () => {
  it('3 Twin (AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT) 모두 매핑', () => {
    expect(TWIN_POLICIES.AGGRESSIVE.minGateScore).toBe(14);
    expect(TWIN_POLICIES.DISCIPLINED.minGateScore).toBe(22);
    expect(TWIN_POLICIES.EQUAL_WEIGHT.minGateScore).toBe(18);
    expect(TWIN_POLICIES.AGGRESSIVE.sizingMode).toBe('KELLY');
    expect(TWIN_POLICIES.EQUAL_WEIGHT.sizingMode).toBe('EQUAL');
  });

  it('ALL_TWIN_KEYS 3개', () => {
    expect(ALL_TWIN_KEYS).toHaveLength(3);
  });

  it('상수 — HORIZON 30일 / EQUAL 0.10 / PROMOTION 4주', () => {
    expect(TWIN_HORIZON_DAYS).toBe(30);
    expect(TWIN_EQUAL_WEIGHT).toBe(0.10);
    expect(PROMOTION_CONSECUTIVE_WEEKS).toBe(4);
  });
});

describe('recordTwinEntries — Gate Score 별 분기', () => {
  it('Gate 12 (AGGRESSIVE 미달) → 모든 Twin reject', () => {
    const added = recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 12, entryPrice: 1000, kellyWeight: 0.05,
    });
    expect(added).toBe(0);
    expect(getAllTwinEntries()).toHaveLength(0);
  });

  it('Gate 16 → AGGRESSIVE만 채택 (1건)', () => {
    const added = recordTwinEntries({
      stockCode: 'A005930', stockName: '삼성전자', signalDate: '2026-04-27',
      gateScore: 16, entryPrice: 70000, kellyWeight: 0.08,
    });
    expect(added).toBe(1);
    const all = getAllTwinEntries();
    expect(all.map(e => e.twin)).toEqual(['AGGRESSIVE']);
    expect(all[0].positionWeight).toBe(0.08); // KELLY 모드
  });

  it('Gate 20 → AGGRESSIVE + EQUAL_WEIGHT 채택 (2건)', () => {
    const added = recordTwinEntries({
      stockCode: 'A035420', stockName: '네이버', signalDate: '2026-04-27',
      gateScore: 20, entryPrice: 200000, kellyWeight: 0.12,
    });
    expect(added).toBe(2);
    const all = getAllTwinEntries();
    const twins = all.map(e => e.twin).sort();
    expect(twins).toEqual(['AGGRESSIVE', 'EQUAL_WEIGHT']);
    const equalEntry = all.find(e => e.twin === 'EQUAL_WEIGHT');
    expect(equalEntry!.positionWeight).toBe(TWIN_EQUAL_WEIGHT); // 0.10
    const aggrEntry = all.find(e => e.twin === 'AGGRESSIVE');
    expect(aggrEntry!.positionWeight).toBe(0.12); // KELLY
  });

  it('Gate 24 → 모든 Twin 채택 (3건)', () => {
    const added = recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 24, entryPrice: 1000, kellyWeight: 0.15,
    });
    expect(added).toBe(3);
    const all = getAllTwinEntries();
    expect(all.map(e => e.twin).sort()).toEqual(['AGGRESSIVE', 'DISCIPLINED', 'EQUAL_WEIGHT']);
  });

  it('동일 (stockCode + signalDate + twin) 중복 무시 — 멱등', () => {
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 16, entryPrice: 1000, kellyWeight: 0.08,
    });
    const second = recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 16, entryPrice: 1010, kellyWeight: 0.09,
    });
    expect(second).toBe(0);
    expect(getAllTwinEntries()).toHaveLength(1);
  });

  it('잘못된 입력 — entryPrice 0/음수/NaN → silent skip', () => {
    expect(recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 24, entryPrice: 0, kellyWeight: 0.1,
    })).toBe(0);
    expect(recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 24, entryPrice: NaN, kellyWeight: 0.1,
    })).toBe(0);
  });

  it('kellyWeight clamp 0~1', () => {
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 16, entryPrice: 1000, kellyWeight: 1.5, // 1 초과
    });
    const all = getAllTwinEntries();
    expect(all[0].positionWeight).toBe(1.0);
  });
});

describe('refreshTwinPortfolio', () => {
  it('가격 갱신 → currentReturnPct 계산', async () => {
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 24, entryPrice: 1000, kellyWeight: 0.1,
    });
    const result = await refreshTwinPortfolio({
      now: new Date('2026-04-29T01:00:00.000Z'),
      priceFetcher: async () => 1100, // +10%
    });
    expect(result.updated).toBe(3); // 3 Twin 모두 갱신
    const all = getAllTwinEntries();
    expect(all.every(e => e.currentReturnPct === 10)).toBe(true);
  });

  it('동일 stockCode 의 여러 Twin 은 priceFetcher 1회 호출 (캐시)', async () => {
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 24, entryPrice: 1000, kellyWeight: 0.1,
    });
    let fetchCount = 0;
    await refreshTwinPortfolio({
      now: new Date('2026-04-29T01:00:00.000Z'),
      priceFetcher: async () => { fetchCount++; return 1100; },
    });
    expect(fetchCount).toBe(1); // 3 Twin 인데 1회만
  });

  it('30일 만료 → CLOSED + exitPrice 영속', async () => {
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-01',
      gateScore: 16, entryPrice: 1000, kellyWeight: 0.1,
    });
    // 만료 전 갱신 (currentReturnPct=10 영속)
    await refreshTwinPortfolio({
      now: new Date('2026-04-30T01:00:00.000Z'),
      priceFetcher: async () => 1100,
    });
    // 만료 후 종결
    await refreshTwinPortfolio({
      now: new Date('2026-05-02T01:00:00.000Z'), // > trackUntil 2026-05-01
      priceFetcher: async () => 9999, // 호출 안 됨
    });
    const all = getAllTwinEntries();
    expect(all[0].status).toBe('CLOSED');
    expect(all[0].exitPrice).toBe(1100); // entryPrice * (1+0.1)
    expect(all[0].exitDate).toBeDefined();
  });

  it('가격 null/throw → skipped', async () => {
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      gateScore: 16, entryPrice: 1000, kellyWeight: 0.1,
    });
    const r1 = await refreshTwinPortfolio({
      now: new Date('2026-04-28T01:00:00.000Z'),
      priceFetcher: async () => null,
    });
    expect(r1.skipped).toBe(1);
    expect(r1.updated).toBe(0);

    const r2 = await refreshTwinPortfolio({
      now: new Date('2026-04-28T02:00:00.000Z'),
      priceFetcher: async () => { throw new Error('boom'); },
    });
    expect(r2.skipped).toBe(1);
  });
});

describe('compareTwinsVsReal', () => {
  it('빈 데이터 → 모든 Twin 0', () => {
    const cmp = compareTwinsVsReal(0);
    for (const k of ALL_TWIN_KEYS) {
      expect(cmp.perTwin[k].activeCount).toBe(0);
      expect(cmp.perTwin[k].closedCount).toBe(0);
      expect(cmp.perTwin[k].cumReturnPct).toBe(0);
      expect(cmp.weekWinning[k]).toBe(false); // 0 > 0 = false
    }
  });

  it('Twin 별 cumReturnPct 계산 + Real 대비 우월 판정', async () => {
    // AGGRESSIVE 만 진입 (Gate 16) +20%
    recordTwinEntries({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-01',
      gateScore: 16, entryPrice: 1000, kellyWeight: 0.5,
    });
    await refreshTwinPortfolio({
      now: new Date('2026-04-30T01:00:00.000Z'),
      priceFetcher: async () => 1200, // +20%
    });
    await refreshTwinPortfolio({
      now: new Date('2026-05-02T01:00:00.000Z'),
      priceFetcher: async () => 9999,
    });

    // Real cumReturn = 5% 가정
    const cmp = compareTwinsVsReal(5);
    // AGGRESSIVE: r=20%, w=0.5 → cum = (1 + 0.2*0.5) - 1 = 10%
    expect(cmp.perTwin.AGGRESSIVE.cumReturnPct).toBeCloseTo(10, 1);
    expect(cmp.weekWinning.AGGRESSIVE).toBe(true); // 10 > 5
    expect(cmp.weekWinning.DISCIPLINED).toBe(false); // 0 > 5 false
    expect(cmp.realCumReturnPct).toBe(5);
  });
});

describe('detectPromotion — 4주 연속 우월', () => {
  it('history < 4주 → null', () => {
    const history = [
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
    ] as Record<import('./counterfactualTwinPortfolio.js').TwinKey, boolean>[];
    expect(detectPromotion(history)).toBeNull();
  });

  it('AGGRESSIVE 4주 연속 우월 → AGGRESSIVE 트리거', () => {
    const history = Array.from({ length: 4 }, () => ({
      AGGRESSIVE: true,
      DISCIPLINED: false,
      EQUAL_WEIGHT: false,
    }));
    expect(detectPromotion(history)).toBe('AGGRESSIVE');
  });

  it('5주 중 마지막 4주 연속 우월 → 트리거 (이전 1주 break)', () => {
    const history = [
      { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
    ];
    expect(detectPromotion(history)).toBe('AGGRESSIVE');
  });

  it('3주 우월 + 1주 패배 → null (4주 미달)', () => {
    const history = [
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: true, DISCIPLINED: false, EQUAL_WEIGHT: false },
      { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false }, // break
    ];
    expect(detectPromotion(history)).toBeNull();
  });

  it('여러 Twin 동시 우월 시 ALL_TWIN_KEYS 순서대로 첫 매칭', () => {
    const history = Array.from({ length: 4 }, () => ({
      AGGRESSIVE: true,
      DISCIPLINED: true,
      EQUAL_WEIGHT: true,
    }));
    expect(detectPromotion(history)).toBe('AGGRESSIVE'); // ALL_TWIN_KEYS 첫번째
  });
});
