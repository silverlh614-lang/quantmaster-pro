/**
 * @responsibility calcStage1Score UNIVERSE_RS_GATE 0-floor RS 보너스 회귀 (강세장 주도주 포착)
 *
 * RS = 종목20d − 시장20d (둘 다 *퍼센트*, 동일 단위 → 정규화 불필요). risk-on 분기에서만
 * clamp(RS, 0, cap) 가점. 0-floor 가 핵심: 시장 못 이김=0(차감 아님) → 순위 변별 발생.
 * flag OFF / benchmark 부재 / 평시 분기면 기존 9개 항과 byte-identical.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { calcStage1Score } from './pipelineHelpers.js';
import type { YahooQuoteExtended } from './stockScreener.js';
import type { RegimeLevel } from '../../src/types/core.js';

const RISK_ON: RegimeLevel = 'R2_BULL';
const NEUTRAL: RegimeLevel = 'R4_NEUTRAL';

function q(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    symbol: 'TEST.KS', name: 't',
    price: 10_000, volume: 200_000, avgVolume: 100_000,
    atr: 300, atr20avg: 500,
    changePercent: 1.5,
    per: 10, ma20: 9_500, ma5: 9_800,
    rsi14: 50, rsi5dAgo: 45,
    isHighRisk: false,
    return5d: 3, return20d: 10, high20d: 10_500, low20d: 9_000,
    recentCloses10d: undefined, recentVolumes10d: undefined,
    recentHighs10d: undefined, recentLows10d: undefined,
    dailyVolumeDrying: false,
    ...overrides,
  } as YahooQuoteExtended;
}

describe('calcStage1Score — UNIVERSE_RS_GATE 0-floor RS 보너스', () => {
  afterEach(() => {
    delete process.env.UNIVERSE_RS_GATE_ENABLED;
    delete process.env.STAGE1_RISK_ON_LEADER_CAPTURE_ENABLED;
  });

  function enableBoth(): void {
    process.env.UNIVERSE_RS_GATE_ENABLED = 'true';
    process.env.STAGE1_RISK_ON_LEADER_CAPTURE_ENABLED = 'true'; // risk-on 분기 진입 조건
  }

  it('flag ON + risk-on — leader(종목20d > 시장20d) 가점 (RS 만큼, cap 3)', () => {
    enableBoth();
    // benchmark 5% (퍼센트). leader return20d=10% → RS=5 → +5 클램프 cap 3 → +3.
    const leader = q({ return20d: 10 });
    const baseNoBenchmark = calcStage1Score(leader, RISK_ON);            // 보너스 0(benchmark 부재)
    const withBenchmark = calcStage1Score(leader, RISK_ON, 5);           // +min(10-5,3)=+3
    expect(withBenchmark - baseNoBenchmark).toBeCloseTo(3, 6);
  });

  it('flag ON + risk-on — RS<cap 이면 RS 만큼만 가점 (단위 정합: 둘 다 %)', () => {
    enableBoth();
    // return20d=8%, benchmark=6% → RS=2 < cap 3 → +2 (퍼센트 직접 차감, 정규화 없음).
    const stock = q({ return20d: 8 });
    const base = calcStage1Score(stock, RISK_ON);
    const withBm = calcStage1Score(stock, RISK_ON, 6);
    expect(withBm - base).toBeCloseTo(2, 6);
  });

  it('flag ON + risk-on — laggard(종목20d ≤ 시장20d) 가점 0 (0-floor, 대칭 차감 아님)', () => {
    enableBoth();
    // return20d=-9%(낙폭과대 반등주), benchmark=7.5% → RS=-16.5 → clamp 0 → 보너스 0(차감 아님).
    const laggard = q({ return20d: -9 });
    const base = calcStage1Score(laggard, RISK_ON);
    const withBm = calcStage1Score(laggard, RISK_ON, 7.5);
    expect(withBm).toBeCloseTo(base, 6);
  });

  it('flag ON + risk-on — leader 가 laggard 보다 높은 점수 (순위 변별 발생)', () => {
    enableBoth();
    // 동일 비-RS 입력에서 return20d 만 차이 → RS 보너스로 변별. (단순 재정렬 no-op 함정 회피 검증)
    const leader = q({ return20d: 12 });
    const laggard = q({ return20d: -5 });
    const sLeader = calcStage1Score(leader, RISK_ON, 7.5);
    const sLaggard = calcStage1Score(laggard, RISK_ON, 7.5);
    expect(sLeader).toBeGreaterThan(sLaggard);
  });

  it('flag OFF — benchmark 전달돼도 보너스 0 (byte-equivalent)', () => {
    process.env.STAGE1_RISK_ON_LEADER_CAPTURE_ENABLED = 'true'; // risk-on 분기는 진입
    delete process.env.UNIVERSE_RS_GATE_ENABLED;                // RS gate OFF
    const stock = q({ return20d: 20 });
    const withBm = calcStage1Score(stock, RISK_ON, 5);
    const without = calcStage1Score(stock, RISK_ON);
    expect(withBm).toBeCloseTo(without, 6);
  });

  it('flag ON + benchmark 부재(undefined) — 보너스 0 (결손≠페널티)', () => {
    enableBoth();
    const stock = q({ return20d: 20 });
    const a = calcStage1Score(stock, RISK_ON);          // 3번째 인자 미전달
    const b = calcStage1Score(stock, RISK_ON, undefined);
    expect(a).toBeCloseTo(b, 6);
  });

  it('flag ON + benchmark 비유한(NaN) — 보너스 0 (graceful)', () => {
    enableBoth();
    const stock = q({ return20d: 20 });
    const base = calcStage1Score(stock, RISK_ON);
    const withNaN = calcStage1Score(stock, RISK_ON, Number.NaN);
    expect(withNaN).toBeCloseTo(base, 6);
  });

  it('flag ON + return20d 결손(NaN) — 보너스 0 (결손≠페널티)', () => {
    enableBoth();
    const stock = q({ return20d: Number.NaN });
    const base = calcStage1Score(q({ return20d: 8 }), RISK_ON); // 정상 종목 비교용 아님 — 결손 보너스 0 확인
    const withMissing = calcStage1Score(stock, RISK_ON, 5);
    // return20d NaN → 보너스 분기 미진입. 나머지 항은 q() 기본과 동일하므로 보너스 0 종목 점수와 일치.
    const noRsBonus = calcStage1Score(stock, RISK_ON); // benchmark 부재 → 보너스 0 baseline
    expect(withMissing).toBeCloseTo(noRsBonus, 6);
    expect(base).toBeGreaterThan(0);
  });

  it('flag ON + 평시(non-risk-on) 분기 — RS 보너스 미적용 (byte-equivalent)', () => {
    enableBoth();
    // NEUTRAL regime → riskOnRelax=false → else 분기 → RS 보너스 코드 미실행.
    const stock = q({ return20d: 20 });
    const withBm = calcStage1Score(stock, NEUTRAL, 5);
    const without = calcStage1Score(stock, NEUTRAL);
    expect(withBm).toBeCloseTo(without, 6);
  });
});
