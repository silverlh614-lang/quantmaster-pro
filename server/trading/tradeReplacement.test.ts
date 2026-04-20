/**
 * tradeReplacement.test.ts — Phase 4-⑦ 포지션 교체 평가 회귀.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  proposeReplacement,
  isInReplacementCooldown,
  markReplacement,
  _resetReplacementCooldowns,
  TRADE_REPLACEMENT_COOLDOWN_MS,
} from './tradeReplacement.js';

describe('tradeReplacement — proposeReplacement', () => {
  beforeEach(() => _resetReplacementCooldowns());

  it('3 조건 모두 충족 → proposed=true', () => {
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 51_000, gateScore: 5, sector: '반도체', momentumSlowing: true },
        { stockCode: '000660', stockName: 'B', entryPrice: 50_000, currentPrice: 50_800, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(true);
    expect(d.targetToExit?.stockCode).toMatch(/^(005930|000660)$/);
  });

  it('수익률 < 1.5% → 미충족 (no_match)', () => {
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 50_500, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(false);
  });

  it('모멘텀 둔화 미확인 → 미충족', () => {
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 55_000, gateScore: 5, sector: '반도체', momentumSlowing: false },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(false);
  });

  it('gate Δ < 1.5 → 미충족', () => {
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 55_000, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 6.0, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(false);
  });

  it('섹터 중복 없음 (보유 섹터 1개뿐) → 미충족', () => {
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 55_000, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 1]]) },
    });
    expect(d.proposed).toBe(false);
  });

  it('동일 섹터 후보 → 섹터 중복 해소 안 됨 (미충족)', () => {
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 55_000, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '반도체' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(false);
  });

  it('쿨다운 내 종목은 평가 제외', () => {
    markReplacement('005930');
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 55_000, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(false);
  });

  it('쿨다운 만료 시점 이후에는 다시 평가', () => {
    markReplacement('005930', Date.now() - TRADE_REPLACEMENT_COOLDOWN_MS - 1);
    expect(isInReplacementCooldown('005930')).toBe(false);
    const d = proposeReplacement({
      held: [
        { stockCode: '005930', stockName: 'A', entryPrice: 50_000, currentPrice: 55_000, gateScore: 5, sector: '반도체', momentumSlowing: true },
      ],
      candidate: { stockCode: '035720', stockName: 'C', liveGate: 7.5, sector: '소프트웨어' },
      sectorExposure: { countsBySector: new Map([['반도체', 2]]) },
    });
    expect(d.proposed).toBe(true);
  });
});
