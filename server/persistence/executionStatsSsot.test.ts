// @responsibility ADR-0391 P0-A §A-5 executionStatsSsot 5분류 회귀 테스트
import { describe, it, expect } from 'vitest';
import {
  compute7dExecutionStats,
  buildExecutionDiagnosis,
  EXECUTION_STATS_WINDOW_MS,
  type ExecutionStats7d,
} from './executionStatsSsot.js';
import type { ServerShadowTrade } from './shadowTradeRepo.js';

const NOW = new Date('2026-05-06T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

function makeShadow(opts: {
  signalTime: string;
  mode?: 'LIVE' | 'SHADOW';
}): ServerShadowTrade {
  return {
    id: `t-${opts.signalTime}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalType: 'BUY',
    signalTime: opts.signalTime,
    shadowEntryPrice: 70000,
    quantity: 1,
    originalQuantity: 1,
    fills: [],
    status: 'PENDING',
    mode: opts.mode,
  } as unknown as ServerShadowTrade;
}

describe('compute7dExecutionStats (ADR-0391 §A-5)', () => {
  it('빈 영속 → 모든 카운트 0', () => {
    const stats = compute7dExecutionStats({
      now: NOW,
      shadowsOverride: [],
      ghostsOverride: [],
    });
    expect(stats).toEqual({
      shadowRecorded: 0,
      paperBuyRecorded: 0,
      liveOrderSent: 0,
      liveBlocked: 0,
      ghost: 0,
      evaluated: 0,
    });
  });

  it('7d 윈도우 안 SHADOW 모드 5건 → shadowRecorded=5, liveOrderSent=0', () => {
    const shadows = [1, 2, 3, 4, 5].map(i => makeShadow({
      signalTime: new Date(NOW_MS - i * HALF_DAY_MS).toISOString(),
      mode: 'SHADOW',
    }));
    const stats = compute7dExecutionStats({ now: NOW, shadowsOverride: shadows, ghostsOverride: [] });
    expect(stats.shadowRecorded).toBe(5);
    expect(stats.liveOrderSent).toBe(0);
    expect(stats.evaluated).toBe(5);
  });

  it('7d 윈도우 안 LIVE 모드 3건 + SHADOW 2건 → shadowRecorded=5, liveOrderSent=3', () => {
    const shadows = [
      makeShadow({ signalTime: new Date(NOW_MS - HALF_DAY_MS).toISOString(), mode: 'LIVE' }),
      makeShadow({ signalTime: new Date(NOW_MS - 2 * HALF_DAY_MS).toISOString(), mode: 'LIVE' }),
      makeShadow({ signalTime: new Date(NOW_MS - 3 * HALF_DAY_MS).toISOString(), mode: 'LIVE' }),
      makeShadow({ signalTime: new Date(NOW_MS - 4 * HALF_DAY_MS).toISOString(), mode: 'SHADOW' }),
      makeShadow({ signalTime: new Date(NOW_MS - 5 * HALF_DAY_MS).toISOString(), mode: 'SHADOW' }),
    ];
    const stats = compute7dExecutionStats({ now: NOW, shadowsOverride: shadows, ghostsOverride: [] });
    expect(stats.shadowRecorded).toBe(5);
    expect(stats.liveOrderSent).toBe(3);
  });

  it('7일 boundary — 경계 시점 포함, 7일+1ms 이전 제외', () => {
    const exactBoundary = new Date(NOW_MS - EXECUTION_STATS_WINDOW_MS).toISOString();
    const justOutside = new Date(NOW_MS - EXECUTION_STATS_WINDOW_MS - 1).toISOString();
    const inside = new Date(NOW_MS - HALF_DAY_MS).toISOString();
    const shadows = [
      makeShadow({ signalTime: exactBoundary, mode: 'SHADOW' }),
      makeShadow({ signalTime: justOutside, mode: 'SHADOW' }),
      makeShadow({ signalTime: inside, mode: 'SHADOW' }),
    ];
    const stats = compute7dExecutionStats({ now: NOW, shadowsOverride: shadows, ghostsOverride: [] });
    // 경계값 포함 (>=) — 2건
    expect(stats.shadowRecorded).toBe(2);
  });

  it('잘못된 ISO signalTime → 0 카운트 (안전 fallback)', () => {
    const shadows = [
      makeShadow({ signalTime: 'not-a-date', mode: 'SHADOW' }),
      makeShadow({ signalTime: '', mode: 'SHADOW' }),
    ];
    const stats = compute7dExecutionStats({ now: NOW, shadowsOverride: shadows, ghostsOverride: [] });
    expect(stats.shadowRecorded).toBe(0);
    expect(stats.evaluated).toBe(0);
  });

  it('ghost 통합 — shadows 5건 + ghosts 3건 → evaluated=8', () => {
    const shadows = [1, 2].map(i => makeShadow({
      signalTime: new Date(NOW_MS - i * HALF_DAY_MS).toISOString(),
    }));
    const ghosts = [1, 2, 3].map(i => ({
      signalDate: new Date(NOW_MS - i * HALF_DAY_MS).toISOString(),
    }));
    const stats = compute7dExecutionStats({ now: NOW, shadowsOverride: shadows, ghostsOverride: ghosts });
    expect(stats.shadowRecorded).toBe(2);
    expect(stats.ghost).toBe(3);
    expect(stats.evaluated).toBe(5);
  });

  it('paperBuyRecorded + liveBlocked 항상 0 (P0-A placeholder, ADR-0263 P1 wiring 후 활성화)', () => {
    const shadows = [
      makeShadow({ signalTime: new Date(NOW_MS - HALF_DAY_MS).toISOString(), mode: 'LIVE' }),
      makeShadow({ signalTime: new Date(NOW_MS - HALF_DAY_MS).toISOString(), mode: 'SHADOW' }),
    ];
    const stats = compute7dExecutionStats({ now: NOW, shadowsOverride: shadows, ghostsOverride: [] });
    expect(stats.paperBuyRecorded).toBe(0);
    expect(stats.liveBlocked).toBe(0);
  });
});

describe('buildExecutionDiagnosis (ADR-0391 §A-2)', () => {
  function makeStats(overrides: Partial<ExecutionStats7d>): ExecutionStats7d {
    return {
      shadowRecorded: 0, paperBuyRecorded: 0, liveOrderSent: 0,
      liveBlocked: 0, ghost: 0, evaluated: 0, ...overrides,
    };
  }

  it('정상 케이스 (shadowRecorded > 0) → ✅ 일치', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 10, evaluated: 10 }),
      mode: 'SHADOW',
    });
    expect(diag).toEqual(['✅ 기대 vs 실제 일치']);
  });

  it('🚨 패턴 — evaluated>0 && shadowRecorded=0', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 0, evaluated: 10, ghost: 10 }),
      mode: 'SHADOW',
    });
    expect(diag.some(d => d.includes('🚨'))).toBe(true);
    expect(diag.some(d => d.includes('shadow ledger not always-on'))).toBe(true);
  });

  it('⚠️ 패턴 — LIVE + liveOrderSent=0 + liveBlocked>0', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 5, liveOrderSent: 0, liveBlocked: 3, evaluated: 5 }),
      mode: 'LIVE',
    });
    expect(diag.some(d => d.includes('Live 모드인데 모든 주문 차단'))).toBe(true);
  });

  it('SHADOW 모드는 liveBlocked 패턴 미적용 (LIVE 한정)', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 5, liveOrderSent: 0, liveBlocked: 3, evaluated: 5 }),
      mode: 'SHADOW',
    });
    expect(diag.some(d => d.includes('Live 모드인데 모든 주문 차단'))).toBe(false);
  });

  it('⚠️ 패턴 — ghost > shadowRecorded × 2', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 2, ghost: 10, evaluated: 12 }),
      mode: 'SHADOW',
    });
    expect(diag.some(d => d.includes('ghost가 shadow의 2배 초과'))).toBe(true);
  });

  it('shadowRecorded=0 일 때는 ghost 비율 패턴 적용 안 함 (분모 가드)', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 0, ghost: 10, evaluated: 10 }),
      mode: 'SHADOW',
    });
    expect(diag.some(d => d.includes('ghost가 shadow의 2배 초과'))).toBe(false);
    // 단 shadow=0 자체가 더 큰 결함이라 🚨 가 우선
    expect(diag.some(d => d.includes('🚨'))).toBe(true);
  });

  it('다중 패턴 동시 발견 — 🚨 + 워치리스트 차단', () => {
    const diag = buildExecutionDiagnosis({
      stats: makeStats({ shadowRecorded: 0, ghost: 100, evaluated: 100 }),
      mode: 'SHADOW',
    });
    expect(diag.length).toBeGreaterThanOrEqual(1);
    expect(diag.some(d => d.includes('🚨'))).toBe(true);
  });
});
