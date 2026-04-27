/**
 * @responsibility rejectionShadowTracker 회귀 테스트 (ADR-0028 PR-L)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 테스트 격리: PERSIST_DATA_DIR 를 임시 디렉토리로 override (paths.ts 가 import 되기 전)
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rejection-shadow-test-'));
process.env.PERSIST_DATA_DIR = TMP_DIR;

const {
  recordRejection,
  refreshRejectionShadow,
  summarizeRejectionShadow,
  addBusinessDays,
  getAllRejectionShadow,
  __resetRejectionShadowForTests,
  REJECTION_NEAR_MISS_MIN,
  REJECTION_NEAR_MISS_MAX,
  REJECTION_GATE_THRESHOLD,
} = await import('./rejectionShadowTracker.js');

beforeEach(() => {
  __resetRejectionShadowForTests();
});

describe('addBusinessDays — KST 영업일 계산', () => {
  it('월요일 기준 5 영업일 후 → 다음 주 월요일', () => {
    // 2026-04-27 (월) + 5 영업일 = 2026-05-04 (월)
    expect(addBusinessDays('2026-04-27', 5)).toBe('2026-05-04');
  });

  it('금요일 기준 5 영업일 후 → 다음 주 금요일', () => {
    // 2026-04-24 (금) + 5 영업일 = 2026-05-01 (금)
    expect(addBusinessDays('2026-04-24', 5)).toBe('2026-05-01');
  });

  it('토요일 진입 + 5 영업일 → 다음 주 금요일', () => {
    // 2026-04-25 (토) + 5 영업일 = 2026-05-01 (금) — 일요일도 스킵
    expect(addBusinessDays('2026-04-25', 5)).toBe('2026-05-01');
  });

  it('영업일 1 = 다음 영업일', () => {
    expect(addBusinessDays('2026-04-24', 1)).toBe('2026-04-27'); // 금→월
    expect(addBusinessDays('2026-04-27', 1)).toBe('2026-04-28'); // 월→화
  });
});

describe('recordRejection — Gate Score 14~17 만 영속', () => {
  it('Gate Score 14 (near-miss boundary 하단) → 영속', () => {
    const added = recordRejection({
      stockCode: 'A005930', stockName: '삼성전자',
      signalDate: '2026-04-27', signalPriceKrw: 70000,
      gateScore: 14, rejectionReason: 'near-miss',
    });
    expect(added).toBe(1);
    const all = getAllRejectionShadow();
    expect(all).toHaveLength(1);
    expect(all[0].gateScore).toBe(14);
    expect(all[0].scoreDelta).toBe(REJECTION_GATE_THRESHOLD - 14); // 4
    expect(all[0].trackUntil).toBe('2026-05-04');
  });

  it('Gate Score 17 (near-miss boundary 상단) → 영속', () => {
    const added = recordRejection({
      stockCode: 'A035420', stockName: '네이버',
      signalDate: '2026-04-27', signalPriceKrw: 200000,
      gateScore: 17, rejectionReason: 'almost-passed',
    });
    expect(added).toBe(1);
    const all = getAllRejectionShadow();
    expect(all[0].scoreDelta).toBe(1);
  });

  it('Gate Score 13 (range 미만) → silent skip', () => {
    const added = recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 1000, gateScore: 13, rejectionReason: 'low',
    });
    expect(added).toBe(0);
    expect(getAllRejectionShadow()).toHaveLength(0);
  });

  it('Gate Score 18 (임계 통과) → silent skip — 임계 통과는 진입 후보지 거절 아님', () => {
    const added = recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 1000, gateScore: 18, rejectionReason: 'passed',
    });
    expect(added).toBe(0);
  });

  it('동일 stockCode + signalDate 활성 entry 가 있으면 중복 무시', () => {
    recordRejection({
      stockCode: 'A005930', stockName: '삼성전자',
      signalDate: '2026-04-27', signalPriceKrw: 70000,
      gateScore: 16, rejectionReason: 'first',
    });
    const second = recordRejection({
      stockCode: 'A005930', stockName: '삼성전자',
      signalDate: '2026-04-27', signalPriceKrw: 71000,
      gateScore: 17, rejectionReason: 'duplicate',
    });
    expect(second).toBe(0);
    expect(getAllRejectionShadow()).toHaveLength(1);
  });

  it('signalPriceKrw 0/음수/NaN → silent skip', () => {
    expect(recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 0, gateScore: 16, rejectionReason: 'zero',
    })).toBe(0);
    expect(recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: -1, gateScore: 16, rejectionReason: 'neg',
    })).toBe(0);
    expect(recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: NaN, gateScore: 16, rejectionReason: 'nan',
    })).toBe(0);
  });

  it('SSOT 상수 — MIN=14 / MAX=17 / THRESHOLD=18', () => {
    expect(REJECTION_NEAR_MISS_MIN).toBe(14);
    expect(REJECTION_NEAR_MISS_MAX).toBe(17);
    expect(REJECTION_GATE_THRESHOLD).toBe(18);
  });
});

describe('refreshRejectionShadow', () => {
  it('가격 갱신 → currentReturnPct 계산', async () => {
    recordRejection({
      stockCode: 'A005930', stockName: '삼성전자',
      signalDate: '2026-04-27', signalPriceKrw: 70000,
      gateScore: 16, rejectionReason: 'test',
    });

    const result = await refreshRejectionShadow({
      now: new Date('2026-04-29T01:00:00.000Z'),
      priceFetcher: async () => 73500, // +5%
    });

    expect(result.updated).toBe(1);
    expect(result.closed).toBe(0);

    const all = getAllRejectionShadow();
    expect(all[0].currentReturnPct).toBe(5); // (73500 - 70000) / 70000 * 100
    expect(all[0].lastUpdatedAt).toBeDefined();
  });

  it('trackUntil 만료 → closed=true', async () => {
    recordRejection({
      stockCode: 'A', stockName: 'A',
      signalDate: '2026-04-27', signalPriceKrw: 1000,
      gateScore: 16, rejectionReason: 'old',
    });
    // 2026-05-05 — trackUntil(2026-05-04) 다음날
    const result = await refreshRejectionShadow({
      now: new Date('2026-05-05T01:00:00.000Z'),
      priceFetcher: async () => 1100,
    });
    expect(result.closed).toBe(1);
    expect(result.updated).toBe(0);

    const all = getAllRejectionShadow();
    expect(all[0].closed).toBe(true);
  });

  it('가격 null → skipped', async () => {
    recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 1000, gateScore: 16, rejectionReason: 'no-price',
    });
    const result = await refreshRejectionShadow({
      now: new Date('2026-04-28T01:00:00.000Z'),
      priceFetcher: async () => null,
    });
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('priceFetcher throw → skipped (안전 흡수)', async () => {
    recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 1000, gateScore: 16, rejectionReason: 'throw',
    });
    const result = await refreshRejectionShadow({
      now: new Date('2026-04-28T01:00:00.000Z'),
      priceFetcher: async () => { throw new Error('boom'); },
    });
    expect(result.skipped).toBe(1);
  });

  it('이미 closed 된 entry 는 skip', async () => {
    recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 1000, gateScore: 16, rejectionReason: 'old',
    });
    // 1차: 만료 종결
    await refreshRejectionShadow({
      now: new Date('2026-05-05T01:00:00.000Z'),
      priceFetcher: async () => 1100,
    });
    // 2차: 이미 closed → skip (priceFetcher 호출 안 됨)
    let fetchCount = 0;
    const result = await refreshRejectionShadow({
      now: new Date('2026-05-06T01:00:00.000Z'),
      priceFetcher: async () => { fetchCount++; return 1200; },
    });
    expect(fetchCount).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.closed).toBe(0);
  });
});

describe('summarizeRejectionShadow', () => {
  it('빈 데이터 → 모든 카운트 0 + reliable=false', () => {
    const s = summarizeRejectionShadow();
    expect(s.totalCount).toBe(0);
    expect(s.closedCount).toBe(0);
    expect(s.activeCount).toBe(0);
    expect(s.falseNegativeRate).toBe(0);
    expect(s.reliable).toBe(false);
  });

  it('closed entry 분포 통계', async () => {
    // 5개 entry: returnPct = -10, -2, +3, +7, +15
    const returns = [-10, -2, 3, 7, 15];
    for (let i = 0; i < returns.length; i++) {
      recordRejection({
        stockCode: `A${i}`, stockName: `종목${i}`,
        signalDate: '2026-04-20', signalPriceKrw: 1000,
        gateScore: 16, rejectionReason: 'test',
      });
    }
    // 1차 refresh — 만료 전 마지막 갱신으로 currentReturnPct 영속
    let idx = 0;
    await refreshRejectionShadow({
      now: new Date('2026-04-27T01:00:00.000Z'), // trackUntil 직전
      priceFetcher: async () => 1000 * (1 + returns[idx++] / 100),
    });
    // 2차 refresh — 만료 후 closed 마킹 (priceFetcher 미호출)
    await refreshRejectionShadow({
      now: new Date('2026-05-05T01:00:00.000Z'),
      priceFetcher: async () => 9999, // 호출 안 됨
    });

    const s = summarizeRejectionShadow();
    expect(s.totalCount).toBe(5);
    expect(s.closedCount).toBe(5);
    expect(s.activeCount).toBe(0);
    // avg = (-10 - 2 + 3 + 7 + 15) / 5 = 13 / 5 = 2.6
    expect(s.avgClosedReturnPct).toBeCloseTo(2.6, 1);
    // median = 3
    expect(s.medianClosedReturnPct).toBe(3);
    // falseNegativeRate = 2/5 (>= +5%: 7, 15)
    expect(s.falseNegativeRate).toBeCloseTo(0.4, 2);
    expect(s.reliable).toBe(true);
  });

  it('표본 < 5 → reliable=false 지만 통계는 계산됨', async () => {
    recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-20',
      signalPriceKrw: 1000, gateScore: 16, rejectionReason: 'test',
    });
    // 만료 전 갱신 + 만료 후 closed
    await refreshRejectionShadow({
      now: new Date('2026-04-27T01:00:00.000Z'),
      priceFetcher: async () => 1100, // +10%
    });
    await refreshRejectionShadow({
      now: new Date('2026-05-05T01:00:00.000Z'),
      priceFetcher: async () => 9999,
    });
    const s = summarizeRejectionShadow();
    expect(s.closedCount).toBe(1);
    expect(s.avgClosedReturnPct).toBe(10);
    expect(s.falseNegativeRate).toBe(1); // 1/1 (>= +5%)
    expect(s.reliable).toBe(false);
  });

  it('active entry 는 통계에서 제외 (currentReturnPct 있어도)', async () => {
    recordRejection({
      stockCode: 'A', stockName: 'A', signalDate: '2026-04-27',
      signalPriceKrw: 1000, gateScore: 16, rejectionReason: 'test',
    });
    await refreshRejectionShadow({
      now: new Date('2026-04-29T01:00:00.000Z'), // 아직 활성
      priceFetcher: async () => 1100,
    });
    const s = summarizeRejectionShadow();
    expect(s.activeCount).toBe(1);
    expect(s.closedCount).toBe(0);
    expect(s.avgClosedReturnPct).toBe(0);
  });
});
