/**
 * @responsibility positionTruth SSOT 회귀 테스트 (ADR-0191)
 *
 * loadOpenPositions / countOpenByStockCode / detectPositionTruthDivergence /
 * isPositionTruthDivergenceCheckDisabled 4 export 의 안전 invariant 검증.
 *
 * 사용자 5/6 SHADOW 12회 가짜 매수 시나리오 — 영속 SSOT drift 자동 검출.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 으로 영속 read-only 격리 (실제 영속 파일 비의존).
vi.mock('./shadowTradeRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shadowTradeRepo.js')>();
  return {
    ...actual,
    loadShadowTrades: vi.fn(),
  };
});
vi.mock('../trading/positionAggregator.js', () => ({
  aggregateAllPositions: vi.fn(),
}));

import {
  loadOpenPositions,
  countOpenByStockCode,
  detectPositionTruthDivergence,
  isPositionTruthDivergenceCheckDisabled,
  type OpenPositionView,
} from './positionTruth.js';
import { loadShadowTrades, type ServerShadowTrade } from './shadowTradeRepo.js';
import { aggregateAllPositions } from '../trading/positionAggregator.js';

type Fill = NonNullable<ServerShadowTrade['fills']>[number];
function shadow(overrides: Partial<ServerShadowTrade> & { id: string; stockCode: string }): ServerShadowTrade {
  const base: ServerShadowTrade = {
    stockName: `종목${overrides.stockCode}`,
    signalTime: '2026-05-06T00:00:00.000Z',
    signalPrice: 10_000,
    shadowEntryPrice: 10_000,
    quantity: 10,
    stopLoss: 9_500,
    targetPrice: 11_000,
    status: 'ACTIVE',
    fills: [{ id: 'f1', type: 'BUY', qty: 10, price: 10_000, timestamp: '2026-05-06T00:00:00.000Z', subType: 'PROVISIONAL', reason: 'TEST' } as unknown as Fill],
    ...overrides,
  } as ServerShadowTrade;
  return base;
}

describe('ADR-0191 positionTruth SSOT', () => {
  beforeEach(() => {
    vi.mocked(loadShadowTrades).mockReset();
    vi.mocked(aggregateAllPositions).mockReset();
    delete process.env.POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED;
  });
  afterEach(() => {
    delete process.env.POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED;
  });

  describe('isPositionTruthDivergenceCheckDisabled', () => {
    it('default OFF — undefined 미설정', () => {
      expect(isPositionTruthDivergenceCheckDisabled()).toBe(false);
    });
    it('"true" 정확 매칭', () => {
      process.env.POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED = 'true';
      expect(isPositionTruthDivergenceCheckDisabled()).toBe(true);
    });
    it('"1" / "TRUE" / "yes" 거부 (ADR-0157 정확 비교)', () => {
      for (const v of ['1', 'TRUE', 'yes']) {
        process.env.POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED = v;
        expect(isPositionTruthDivergenceCheckDisabled()).toBe(false);
      }
    });
  });

  describe('loadOpenPositions', () => {
    it('빈 영속 → 빈 배열', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([]);
      expect(loadOpenPositions()).toEqual([]);
    });

    it('PENDING / ACTIVE / ORDER_SUBMITTED / PARTIALLY_FILLED / EUPHORIA_PARTIAL 모두 포함', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'PENDING' }),
        shadow({ id: 's2', stockCode: '058471', status: 'ACTIVE' }),
        shadow({ id: 's3', stockCode: '058472', status: 'ORDER_SUBMITTED' }),
        shadow({ id: 's4', stockCode: '058473', status: 'PARTIALLY_FILLED' }),
        shadow({ id: 's5', stockCode: '058474', status: 'EUPHORIA_PARTIAL' }),
      ]);
      const result = loadOpenPositions();
      expect(result).toHaveLength(5);
      expect(result.map(p => p.stockCode).sort()).toEqual([
        '058470', '058471', '058472', '058473', '058474',
      ]);
    });

    it('HIT_TARGET / HIT_STOP / REJECTED 자동 제외', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'ACTIVE' }),
        shadow({ id: 's2', stockCode: '058471', status: 'HIT_TARGET' }),
        shadow({ id: 's3', stockCode: '058472', status: 'HIT_STOP' }),
        shadow({ id: 's4', stockCode: '058473', status: 'REJECTED' }),
      ]);
      const result = loadOpenPositions();
      expect(result).toHaveLength(1);
      expect(result[0].stockCode).toBe('058470');
    });

    it('remainingQty=0 자동 제외 (전량 매도된 ACTIVE)', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({
          id: 's1', stockCode: '058470', status: 'ACTIVE',
          fills: [
            { id: 'b1', type: 'BUY', qty: 10, price: 10_000, timestamp: 'T0', subType: 'PROVISIONAL', reason: 'TEST' } as unknown as Fill,
            { id: 's1', type: 'SELL', qty: 10, price: 11_000, timestamp: 'T1', subType: 'PROVISIONAL', reason: 'TEST' } as unknown as Fill,
          ],
        }),
      ]);
      const result = loadOpenPositions();
      expect(result).toHaveLength(0);
    });

    it('remainingQty 정확 산출', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({
          id: 's1', stockCode: '058470', status: 'PARTIALLY_FILLED',
          fills: [
            { id: 'b1', type: 'BUY', qty: 10, price: 10_000, timestamp: 'T0', subType: 'PROVISIONAL', reason: 'TEST' } as unknown as Fill,
            { id: 's1', type: 'SELL', qty: 4, price: 11_000, timestamp: 'T1', subType: 'PROVISIONAL', reason: 'TEST' } as unknown as Fill,
          ],
        }),
      ]);
      const result = loadOpenPositions();
      expect(result).toHaveLength(1);
      expect(result[0].remainingQty).toBe(6);
    });

    it('mode 정확 분류 — LIVE / SHADOW', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'ACTIVE', mode: 'LIVE' }),
        shadow({ id: 's2', stockCode: '058471', status: 'ACTIVE', mode: 'SHADOW' }),
        shadow({ id: 's3', stockCode: '058472', status: 'ACTIVE' }), // mode 미설정 → SHADOW default
      ]);
      const result = loadOpenPositions();
      expect(result.find(p => p.stockCode === '058470')?.mode).toBe('LIVE');
      expect(result.find(p => p.stockCode === '058471')?.mode).toBe('SHADOW');
      expect(result.find(p => p.stockCode === '058472')?.mode).toBe('SHADOW');
    });

    it('loadShadowTrades throw → 빈 배열 fallback (안전)', () => {
      vi.mocked(loadShadowTrades).mockImplementation(() => {
        throw new Error('disk corrupted');
      });
      expect(() => loadOpenPositions()).not.toThrow();
      expect(loadOpenPositions()).toEqual([]);
    });
  });

  describe('countOpenByStockCode (12회 매수 시나리오)', () => {
    it('빈 배열 → 빈 Map', () => {
      expect(countOpenByStockCode([]).size).toBe(0);
    });

    it('단일 종목 1건', () => {
      const positions: OpenPositionView[] = [
        { positionId: 's1', stockCode: '058470', stockName: '리노공업', status: 'ACTIVE', remainingQty: 10, signalTime: 'T0', mode: 'SHADOW' },
      ];
      const counts = countOpenByStockCode(positions);
      expect(counts.get('058470')).toBe(1);
    });

    it('동일 종목 12회 매수 (사용자 사고 시나리오) → 12 카운트', () => {
      const positions: OpenPositionView[] = [];
      for (let i = 0; i < 12; i++) {
        positions.push({
          positionId: `s${i}`, stockCode: '058470', stockName: '리노공업',
          status: 'ACTIVE', remainingQty: 10, signalTime: `T${i}`, mode: 'SHADOW',
        });
      }
      const counts = countOpenByStockCode(positions);
      expect(counts.get('058470')).toBe(12);
    });

    it('다중 종목 분리 카운트', () => {
      const positions: OpenPositionView[] = [
        { positionId: 's1', stockCode: '058470', stockName: 'A', status: 'ACTIVE', remainingQty: 10, signalTime: 'T0', mode: 'SHADOW' },
        { positionId: 's2', stockCode: '058470', stockName: 'A', status: 'ACTIVE', remainingQty: 5, signalTime: 'T1', mode: 'SHADOW' },
        { positionId: 's3', stockCode: '005930', stockName: 'B', status: 'ACTIVE', remainingQty: 100, signalTime: 'T2', mode: 'LIVE' },
      ];
      const counts = countOpenByStockCode(positions);
      expect(counts.get('058470')).toBe(2);
      expect(counts.get('005930')).toBe(1);
    });
  });

  describe('detectPositionTruthDivergence', () => {
    it('정상 정합 (shadow=2 + aggregate=2 + 종목 일치) → divergent=false', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'ACTIVE' }),
        shadow({ id: 's2', stockCode: '005930', status: 'ACTIVE' }),
      ]);
      vi.mocked(aggregateAllPositions).mockReturnValue([
        { positionId: 's1', stockCode: '058470', stage: 'ENTRY' },
        { positionId: 's2', stockCode: '005930', stage: 'ENTRY' },
      ] as unknown as ReturnType<typeof aggregateAllPositions>);
      const report = detectPositionTruthDivergence();
      expect(report.divergent).toBe(false);
      expect(report.shadowOpenCount).toBe(2);
      expect(report.aggregateActiveCount).toBe(2);
      expect(report.divergentStockCodes).toEqual([]);
    });

    it('카운트 불일치 (12 vs 1, 사용자 사고 시나리오) → divergent=true', () => {
      const trades: ServerShadowTrade[] = [];
      for (let i = 0; i < 12; i++) {
        trades.push(shadow({ id: `s${i}`, stockCode: '058470', status: 'ACTIVE' }));
      }
      vi.mocked(loadShadowTrades).mockReturnValue(trades);
      vi.mocked(aggregateAllPositions).mockReturnValue([
        { positionId: 's0', stockCode: '058470', stage: 'ENTRY' },
      ] as unknown as ReturnType<typeof aggregateAllPositions>);
      const report = detectPositionTruthDivergence();
      expect(report.divergent).toBe(true);
      expect(report.shadowOpenCount).toBe(12);
      expect(report.aggregateActiveCount).toBe(1);
      // 종목 자체는 일치 (058470 양쪽 모두 있음) — 카운트만 다름.
      expect(report.divergentStockCodes).toEqual([]);
    });

    it('종목 갈라짐 (shadow 에는 있고 aggregate 에는 없음) → divergent=true + codes 표시', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'ACTIVE' }),
        shadow({ id: 's2', stockCode: '005930', status: 'ACTIVE' }),
      ]);
      vi.mocked(aggregateAllPositions).mockReturnValue([
        { positionId: 's1', stockCode: '058470', stage: 'ENTRY' },
      ] as unknown as ReturnType<typeof aggregateAllPositions>);
      const report = detectPositionTruthDivergence();
      expect(report.divergent).toBe(true);
      expect(report.divergentStockCodes).toEqual(['005930']);
    });

    it('aggregateAllPositions throw → detectError + divergent=true (shadow=N vs aggregate=0)', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'ACTIVE' }),
      ]);
      vi.mocked(aggregateAllPositions).mockImplementation(() => {
        throw new Error('shadow-log corrupted');
      });
      const report = detectPositionTruthDivergence();
      // aggregate throw 시 aggregateActiveCount=0 + shadow=1 → divergent=true.
      expect(report.divergent).toBe(true);
      expect(report.detectError).toContain('corrupted');
      expect(report.shadowOpenCount).toBe(1);
      expect(report.aggregateActiveCount).toBe(0);
    });

    it('ENV `POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED=true` 우회 → 항상 정합 결과', () => {
      process.env.POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED = 'true';
      vi.mocked(loadShadowTrades).mockReturnValue([
        shadow({ id: 's1', stockCode: '058470', status: 'ACTIVE' }),
      ]);
      // aggregate mock 자체가 호출되지 않아야 함 (ENV gate 우선).
      const report = detectPositionTruthDivergence();
      expect(report.divergent).toBe(false);
      expect(report.shadowOpenCount).toBe(0);
      expect(report.aggregateActiveCount).toBe(0);
      expect(vi.mocked(aggregateAllPositions)).not.toHaveBeenCalled();
    });

    it('shadow=0 + aggregate=0 → divergent=false (정합)', () => {
      vi.mocked(loadShadowTrades).mockReturnValue([]);
      vi.mocked(aggregateAllPositions).mockReturnValue([] as unknown as ReturnType<typeof aggregateAllPositions>);
      const report = detectPositionTruthDivergence();
      expect(report.divergent).toBe(false);
      expect(report.divergentStockCodes).toEqual([]);
    });
  });
});
