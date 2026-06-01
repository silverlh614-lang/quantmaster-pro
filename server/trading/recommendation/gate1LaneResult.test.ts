// @responsibility buildGate1LaneResult 단위 테스트 — LIVE_HARD_PASS 미러식 byte-identical·ENV OFF·SEARCH 3분기 OR degrade·INDEX_RALLY 차단/providerIssue 비변환 검증.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_GATE1_REQUIRED_SCORE } from '../gateConfig.js';
import type { CandidateSnapshot } from '../signalScanner/entryFilterDecomposition/types.js';
import { buildGate1LaneResult, type Gate1LaneResultInput } from './gate1LaneResult.js';
import type { MarketRallyLens } from './recommendationTypes.js';

const ENV_KEY = 'MARKET_RALLY_LENS_ENABLED';

/** gate1DryRunObservationLedgerAdr0476.ts:500 의 hardPass 정의와 동일 boolean 식 (byte-identical 비교용). */
function hardPassRef(s: CandidateSnapshot): boolean {
  return s.gate1Passed === true && s.minSignalScorePassed === true;
}

function enabledLens(overrides: Partial<MarketRallyLens> = {}): MarketRallyLens {
  return {
    enabled: true,
    reason: 'KOSPI_RALLY_1_5',
    kospiReturnPct: 1.8,
    kosdaqReturnPct: null,
    marketBreadth: null,
    investorFlow: { foreignNetBuy5d: 1000, marketInstitutionNetBuyApprox: 500, label: 'BULLISH' },
    executionImpact: 'NONE',
    recommendationOnly: true,
    snapshotId: 'snap_test',
    asOf: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function disabledLens(): MarketRallyLens {
  return { ...enabledLens(), enabled: false, reason: 'NO_RALLY' };
}

function baseInput(overrides: Partial<Gate1LaneResultInput> = {}): Gate1LaneResultInput {
  return {
    candidateSnapshots: [],
    rallyLens: enabledLens(),
    asOf: '2026-06-01T00:00:00.000Z',
    snapshotId: 'snap_test',
    ...overrides,
  };
}

describe('buildGate1LaneResult', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = 'true';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  // ── T1: LIVE_HARD_PASS byte-identical 전수 비교 ──
  describe('T1 LIVE_HARD_PASS byte-identical', () => {
    it('각 심볼 liveHardPass === (gate1Passed && minSignalScorePassed) 전수 일치', () => {
      const snapshots: CandidateSnapshot[] = [
        { symbol: 'A', gateScore: 75, gate1Passed: true, minSignalScorePassed: true },
        { symbol: 'B', gateScore: 75, gate1Passed: true, minSignalScorePassed: false },
        { symbol: 'C', gateScore: 75, gate1Passed: false, minSignalScorePassed: true },
        { symbol: 'D', gateScore: 75, gate1Passed: false, minSignalScorePassed: false },
        { symbol: 'E', gateScore: 75 }, // 둘 다 undefined → false
        { symbol: 'F', gateScore: 75, gate1Passed: true }, // minSignalScorePassed undefined → false
      ];
      const result = buildGate1LaneResult(baseInput({ candidateSnapshots: snapshots }));
      expect(result.symbols).toHaveLength(snapshots.length);
      result.symbols.forEach((row, i) => {
        expect(row.liveHardPass).toBe(hardPassRef(snapshots[i]));
      });
      // 명시 기대값
      expect(result.symbols[0].liveHardPass).toBe(true);
      expect(result.symbols[1].liveHardPass).toBe(false);
      expect(result.symbols[2].liveHardPass).toBe(false);
      expect(result.symbols[3].liveHardPass).toBe(false);
      expect(result.symbols[4].liveHardPass).toBe(false);
      expect(result.symbols[5].liveHardPass).toBe(false);
      expect(result.liveHardPassCount).toBe(1);
    });

    it('requiredScore 는 minSignalRequiredScore ?? LEGACY(70) read-only (override 없음)', () => {
      const snapshots: CandidateSnapshot[] = [
        { symbol: 'A', gateScore: 80, minSignalRequiredScore: 65 },
        { symbol: 'B', gateScore: 80 }, // default 70
      ];
      const result = buildGate1LaneResult(baseInput({ candidateSnapshots: snapshots }));
      expect(result.symbols[0].requiredScore).toBe(65);
      expect(result.symbols[1].requiredScore).toBe(LEGACY_GATE1_REQUIRED_SCORE);
      expect(result.symbols[0].scoreGap).toBe(80 - 65);
      expect(result.symbols[1].scoreGap).toBe(80 - 70);
    });

    it('liveHardPass 는 gateScore<required 여도 미러식 그대로 (재계산/임계 비교 없음)', () => {
      // gateScore 40 < required 70 이지만 gate1Passed/minSignalScorePassed 가 true 면 liveHardPass=true
      const snapshots: CandidateSnapshot[] = [
        { symbol: 'A', gateScore: 40, gate1Passed: true, minSignalScorePassed: true, minSignalRequiredScore: 70 },
      ];
      const result = buildGate1LaneResult(baseInput({ candidateSnapshots: snapshots }));
      expect(result.symbols[0].liveHardPass).toBe(true);
    });
  });

  // ── T2: ENV OFF / rallyLens disabled ──
  describe('T2 ENV OFF / rallyLens disabled', () => {
    it('ENV 미설정 → enabled:false, symbols:[], counts 0, 리터럴 고정', () => {
      delete process.env[ENV_KEY];
      const result = buildGate1LaneResult(
        baseInput({
          candidateSnapshots: [{ symbol: 'A', gateScore: 90, gate1Passed: true, minSignalScorePassed: true }],
        }),
      );
      expect(result.enabled).toBe(false);
      expect(result.symbols).toEqual([]);
      expect(result.liveHardPassCount).toBe(0);
      expect(result.searchRecommendationPassCount).toBe(0);
      expect(result.indexRallyWatchPassCount).toBe(0);
      expect(result.buySignal).toBe(false);
      expect(result.executionImpact).toBe('NONE');
      expect(result.recommendationOnly).toBe(true);
    });

    it('rallyLens.enabled=false → enabled:false (ENV ON 이어도)', () => {
      const result = buildGate1LaneResult(
        baseInput({
          rallyLens: disabledLens(),
          candidateSnapshots: [{ symbol: 'A', gateScore: 90, gate1Passed: true, minSignalScorePassed: true }],
        }),
      );
      expect(result.enabled).toBe(false);
      expect(result.symbols).toEqual([]);
    });
  });

  // ── T3: SEARCH_RECOMMENDATION_PASS 3분기 OR + degrade ──
  describe('T3 SEARCH 3분기 OR + degrade', () => {
    it('분기1: finalScore>=50 단독 통과', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A', gateScore: 50 }] }),
      );
      expect(result.symbols[0].searchRecommendationPass).toBe(true);
      expect(result.symbols[0].laneLabels).toContain('SEARCH_RECOMMENDATION_PASS');
    });

    it('분기2: finalScore>=45 + 보조조건(supply BULLISH) 통과', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A', gateScore: 46, supplyConfluenceState: 'BULLISH' }] }),
      );
      expect(result.symbols[0].searchRecommendationPass).toBe(true);
    });

    it('분기2: 45~49 인데 보조조건 전부 미충족 → false', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A', gateScore: 46 }] }),
      );
      expect(result.symbols[0].searchRecommendationPass).toBe(false);
    });

    it('분기3: finalScore>=40 + rallyLens.enabled + liquidity OK 통과', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A', gateScore: 42, volumeLiquidityPassed: true }] }),
      );
      expect(result.symbols[0].searchRecommendationPass).toBe(true);
    });

    it('보조조건 입력 부재 → degradeReasons 라벨 + false 취급 (비변환)', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A', gateScore: 46 }] }),
      );
      const reasons = result.symbols[0].degradeReasons;
      expect(reasons).toContain('PRICE_MOMENTUM_NOT_AVAILABLE');
      expect(reasons).toContain('RS_NOT_AVAILABLE');
      expect(reasons).toContain('SUPPLY_NOT_AVAILABLE');
      expect(reasons).toContain('SECTOR_ENERGY_NOT_AVAILABLE');
      expect(reasons).toContain('LIQUIDITY_NOT_AVAILABLE');
      expect(result.symbols[0].searchRecommendationPass).toBe(false);
    });

    it('finalScore(gateScore) 부재 → 전 lane false + FINAL_SCORE_NOT_AVAILABLE', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A' }] }),
      );
      const row = result.symbols[0];
      expect(row.finalScore).toBeNull();
      expect(row.scoreGap).toBeNull();
      expect(row.searchRecommendationPass).toBe(false);
      expect(row.indexRallyWatchPass).toBe(false);
      expect(row.degradeReasons).toContain('FINAL_SCORE_NOT_AVAILABLE');
      expect(row.laneLabels).toEqual(['NO_LANE']);
    });
  });

  // ── T4: INDEX_RALLY_WATCH_PASS 차단 경로 + providerIssue 비변환 ──
  describe('T4 INDEX_RALLY_WATCH 차단 + providerIssue 비변환', () => {
    const fresh: CandidateSnapshot = {
      symbol: 'A',
      gateScore: 55,
      priceDataFresh: true,
      supplyConfluenceState: 'BULLISH',
      volumeLiquidityPassed: true,
    };

    it('정상: rallyLens.enabled + finalScore>=40 + fresh + health + liq → pass', () => {
      const result = buildGate1LaneResult(baseInput({ candidateSnapshots: [{ ...fresh }] }));
      expect(result.symbols[0].indexRallyWatchPass).toBe(true);
      expect(result.symbols[0].laneLabels).toContain('INDEX_RALLY_WATCH_PASS');
    });

    it('quoteFresh 부재 → 차단 + QUOTE_FRESHNESS_NOT_AVAILABLE', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ ...fresh, priceDataFresh: false }] }),
      );
      expect(result.symbols[0].indexRallyWatchPass).toBe(false);
      expect(result.symbols[0].degradeReasons).toContain('QUOTE_FRESHNESS_NOT_AVAILABLE');
    });

    it('sourceHealth 미검증(BEARISH) → 차단 + SOURCE_HEALTH_NOT_AVAILABLE', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ ...fresh, supplyConfluenceState: 'BEARISH' }] }),
      );
      expect(result.symbols[0].indexRallyWatchPass).toBe(false);
      expect(result.symbols[0].degradeReasons).toContain('SOURCE_HEALTH_NOT_AVAILABLE');
    });

    it('liquidity hard-fail (volumeLiquidityPassed=false) → 차단', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ ...fresh, volumeLiquidityPassed: false }] }),
      );
      expect(result.symbols[0].indexRallyWatchPass).toBe(false);
    });

    it('DATA_HOLD → 차단 + DATA_HOLD', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ ...fresh }], dataHold: true }),
      );
      expect(result.symbols[0].indexRallyWatchPass).toBe(false);
      expect(result.symbols[0].degradeReasons).toContain('DATA_HOLD');
    });

    it('providerIssue=true → 차단 + RALLY_UNKNOWN_PROVIDER_ISSUE (불변식#6 bullish/bearish 비변환)', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ ...fresh }], providerIssue: true }),
      );
      const row = result.symbols[0];
      expect(row.indexRallyWatchPass).toBe(false);
      expect(row.degradeReasons).toContain('RALLY_UNKNOWN_PROVIDER_ISSUE');
      // 비변환: liveHardPass/searchRecommendationPass 는 providerIssue 로 bearish 전환되지 않음.
      // (searchRecommendationPass 는 finalScore 55>=50 으로 정상 true 유지)
      expect(row.searchRecommendationPass).toBe(true);
    });

    it('rallyLens.enabled=false 면 INDEX_RALLY lane 자체 비활성 (전체 disabled)', () => {
      const result = buildGate1LaneResult(
        baseInput({ rallyLens: disabledLens(), candidateSnapshots: [{ ...fresh }] }),
      );
      expect(result.enabled).toBe(false);
    });
  });

  // ── T6 일부: 리터럴 고정 + 집계 카운트 ──
  describe('T6 리터럴 고정 / 집계', () => {
    it('buySignal:false · executionImpact:NONE · recommendationOnly:true 활성 시에도 고정', () => {
      const result = buildGate1LaneResult(
        baseInput({ candidateSnapshots: [{ symbol: 'A', gateScore: 90, gate1Passed: true, minSignalScorePassed: true }] }),
      );
      expect(result.enabled).toBe(true);
      expect(result.buySignal).toBe(false);
      expect(result.executionImpact).toBe('NONE');
      expect(result.recommendationOnly).toBe(true);
      expect(result.snapshotId).toBe('snap_test');
    });

    it('count 집계가 심볼별 pass 와 일치', () => {
      const snapshots: CandidateSnapshot[] = [
        { symbol: 'A', gateScore: 90, gate1Passed: true, minSignalScorePassed: true }, // live
        { symbol: 'B', gateScore: 55 }, // search
        { symbol: 'C', gateScore: 10 }, // none
      ];
      const result = buildGate1LaneResult(baseInput({ candidateSnapshots: snapshots }));
      expect(result.liveHardPassCount).toBe(1);
      expect(result.searchRecommendationPassCount).toBeGreaterThanOrEqual(1);
      expect(result.symbols[2].laneLabels).toEqual(['NO_LANE']);
    });
  });
});
