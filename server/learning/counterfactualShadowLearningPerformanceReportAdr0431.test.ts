// @responsibility ADR-0431 Counterfactual Shadow Learning Performance Report 회귀 테스트.
//
// 사용자 §J 정합 — counterfactual ledger 와 provisional / 일반 shadow 절대 분리,
// learningOnly !== true / source !== 'ADR-0430' 무시. 외부 API 호출 0
// (priceProvider 의존성 주입 default 미전달 → PENDING).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buildCounterfactualShadowPerformanceReport,
  formatCounterfactualShadowPerformanceMessage,
  formatCounterfactualShadowSummaryLine,
  isCounterfactualShadowPerfReportDisabled,
  isValidCounterfactualEntry,
  isHorizonReached,
  resolveCounterfactualEntryPrice,
  COUNTERFACTUAL_HORIZON_OFFSET_MS,
  type CounterfactualShadowHorizon,
  type CounterfactualShadowPriceProvider,
} from './counterfactualShadowLearningPerformanceReport.js';
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORT_PATH = join(__dirname, 'counterfactualShadowLearningPerformanceReport.ts');
const REPORT_SOURCE = readFileSync(REPORT_PATH, 'utf-8');
const ADAPTER_PATH = join(__dirname, 'counterfactualShadowPriceProviderAdapter.ts');
const ADAPTER_SOURCE = readFileSync(ADAPTER_PATH, 'utf-8');

function makeEntry(
  overrides: Partial<CounterfactualShadowLearningLedgerEntry> & {
    entryPrice?: number;
    metadata?: Record<string, unknown>;
  } = {},
): CounterfactualShadowLearningLedgerEntry {
  const base: CounterfactualShadowLearningLedgerEntry = {
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: false,
    symbol: '005930',
    name: '삼성전자',
    scanId: '2026-05-07:scan-1',
    createdAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
    reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'LEARNING_ONLY', 'SELL_ONLY'],
    blockedBy: ['SELL_ONLY'],
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    virtualAccountImpact: 'NONE',
    regime: 'R3_EARLY',
    gate1Passed: true,
    gate2Passed: false,
    routerSeverity: 'HARD_BLOCK',
    routerLabel: 'SELL_ONLY_HARD_BLOCK',
    ...overrides,
  };
  return base;
}

describe('ADR-0431 Counterfactual Shadow Learning Performance Report', () => {
  // ──────────────────────────────────────────────────────────────────────
  // 1. §B: 빈 entries → totalEntries=0
  // ──────────────────────────────────────────────────────────────────────
  it('§B: 빈 ledger → totalEntries=0 (정상 안내)', async () => {
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [],
      nowKst: '2026-05-08T10:00:00+09:00',
    });
    expect(summary.totalEntries).toBe(0);
    expect(summary.observedEntries).toBe(0);
    expect(summary.pendingEntries).toBe(0);
    expect(summary.insufficientDataEntries).toBe(0);
    expect(summary.topWinners).toEqual([]);
    expect(summary.topLosers).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. §J: source 또는 learningOnly 또는 eventType 위반 entry 무시 (혼합 차단)
  // ──────────────────────────────────────────────────────────────────────
  it('§J: source !== ADR-0430 / learningOnly !== true / eventType 위반 entry 무시', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generalShadow: any = {
      eventType: 'BUY',
      source: 'GENERAL_SHADOW',
      learningOnly: false,
      symbol: '005930',
      createdAtKst: '2026-05-07T10:00:00+09:00',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provisional: any = {
      eventType: 'PROVISIONAL_SHADOW_ENTRY',
      source: 'ADR-0426',
      learningOnly: false,
      provisional: true,
      symbol: '005930',
      createdAtKst: '2026-05-07T10:00:00+09:00',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrongLearningOnly: any = {
      eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
      source: 'ADR-0430',
      learningOnly: false, // ← invariant 위반
      symbol: '005930',
      createdAtKst: '2026-05-07T10:00:00+09:00',
    };
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [generalShadow, provisional, wrongLearningOnly, makeEntry()],
      nowKst: '2026-05-08T10:00:00+09:00',
    });
    expect(summary.totalEntries).toBe(1); // makeEntry() 만 통과
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. §I: priceProvider 미전달 → 모든 horizon PENDING (외부 호출 0)
  // ──────────────────────────────────────────────────────────────────────
  it('§I: priceProvider 미전달 → 모든 horizon PENDING — 손실 카운트 아님', async () => {
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [makeEntry()],
      nowKst: '2026-05-12T15:00:00+09:00',
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.pendingEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
    expect(summary.insufficientDataEntries).toBe(0);
    expect(Object.keys(summary.avgReturnByHorizon)).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. §D §C: priceProvider 정상 + entryPrice 있을 때 returnPct 계산
  // ──────────────────────────────────────────────────────────────────────
  it('§D §C: priceProvider 정상 + entryPrice → returnPct 계산', async () => {
    const provider: CounterfactualShadowPriceProvider = async (_symbol, horizon) => {
      const priceMap: Partial<Record<CounterfactualShadowHorizon, number>> = {
        T_PLUS_30M: 102000,
        T_PLUS_1H: 103000,
        SAME_DAY_CLOSE: 104000,
      };
      const price = priceMap[horizon];
      if (price === undefined) {
        return { available: false, reason: 'horizon not provided', status: 'DATA_UNAVAILABLE' };
      }
      return {
        available: true,
        price,
        observedAtKst: '2026-05-07T11:00:00+09:00',
        source: 'INTRADAY_CANDLE_CACHE',
      };
    };
    const entry = makeEntry({ entryPrice: 100000 });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(1);
    expect(summary.avgReturnByHorizon.T_PLUS_30M).toBeCloseTo(2.0, 1);
    expect(summary.avgReturnByHorizon.T_PLUS_1H).toBeCloseTo(3.0, 1);
    expect(summary.avgReturnByHorizon.SAME_DAY_CLOSE).toBeCloseTo(4.0, 1);
    expect(summary.winRateByHorizon.T_PLUS_30M).toBe(1);
    expect(summary.topWinners).toHaveLength(1);
    expect(summary.topWinners[0].summary.bestReturnPct).toBeCloseTo(4.0, 1);
    expect(summary.blockedByBreakdown.SELL_ONLY).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. §I: entryPrice 부재 → INSUFFICIENT_DATA (failed 와 분리)
  // ──────────────────────────────────────────────────────────────────────
  it('§I: entryPrice 부재 시 INSUFFICIENT_DATA — 손실 카운트 아님', async () => {
    const provider: CounterfactualShadowPriceProvider = async () => ({
      available: true,
      price: 105000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [makeEntry()], // entryPrice 부재 + 다른 fallback 도 부재
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
    expect(summary.pendingEntries).toBe(0);
    expect(summary.insufficientDataEntries).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. §D: entryPrice fallback chain — entryPriceHint 사용
  // ──────────────────────────────────────────────────────────────────────
  it('§D: entryPriceHint fallback — entryPrice 부재 + entryPriceHint 만 있을 때 정상 계산', async () => {
    const provider: CounterfactualShadowPriceProvider = async () => ({
      available: true,
      price: 110000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const entry = makeEntry({ entryPriceHint: 100000 });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(1);
    expect(summary.avgReturnByHorizon.T_PLUS_30M).toBeCloseTo(10.0, 1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. §D: entryPrice fallback chain — conditionSnapshot.price 사용
  // ──────────────────────────────────────────────────────────────────────
  it('§D: conditionSnapshot.price fallback', async () => {
    const provider: CounterfactualShadowPriceProvider = async () => ({
      available: true,
      price: 95000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const entry = makeEntry({
      conditionSnapshot: { price: 100000, foo: 'bar' },
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(1);
    expect(summary.avgReturnByHorizon.T_PLUS_30M).toBeCloseTo(-5.0, 1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. §I: priceProvider throw → ERROR + 다른 entry 무영향
  // ──────────────────────────────────────────────────────────────────────
  it('§I: priceProvider throw → ERROR (catch 격리) — 손실 아님', async () => {
    const provider: CounterfactualShadowPriceProvider = async () => {
      throw new Error('mock provider failure');
    };
    const entry = makeEntry({ entryPrice: 100000 });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
    // ERROR 도 손실 카운트 아님 — observedEntries 만 OBSERVED 로 카운트.
  });

  // ──────────────────────────────────────────────────────────────────────
  // 9. Horizon offset SSOT 정합 + 도달 검증
  // ──────────────────────────────────────────────────────────────────────
  it('COUNTERFACTUAL_HORIZON_OFFSET_MS SSOT 정합 + Object.freeze', () => {
    expect(COUNTERFACTUAL_HORIZON_OFFSET_MS.T_PLUS_30M).toBe(30 * 60 * 1_000);
    expect(COUNTERFACTUAL_HORIZON_OFFSET_MS.T_PLUS_1H).toBe(60 * 60 * 1_000);
    expect(COUNTERFACTUAL_HORIZON_OFFSET_MS.T_PLUS_3D_CLOSE).toBe(80 * 60 * 60 * 1_000);
    expect(Object.isFrozen(COUNTERFACTUAL_HORIZON_OFFSET_MS)).toBe(true);
  });

  it('horizon 미도달 → PENDING (entry 직후 1분)', async () => {
    const provider: CounterfactualShadowPriceProvider = async () => ({
      available: true,
      price: 105000,
      observedAtKst: '2026-05-07T10:00:00+09:00',
    });
    const entry = makeEntry({
      createdAtKst: '2026-05-07T09:55:00+09:00',
      entryPrice: 100000,
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-07T09:56:00+09:00', // 1분 후
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.pendingEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 10. ENV 우회
  // ──────────────────────────────────────────────────────────────────────
  it('ENV COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED=true → 빈 summary', async () => {
    const original = process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED;
    process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED = 'true';
    try {
      const summary = await buildCounterfactualShadowPerformanceReport({
        entries: [makeEntry({ entryPrice: 100000 })],
        nowKst: '2026-05-12T15:00:00+09:00',
      });
      expect(summary.totalEntries).toBe(0);
      expect(isCounterfactualShadowPerfReportDisabled()).toBe(true);
    } finally {
      if (original !== undefined)
        process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED = original;
      else delete process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED;
    }
  });

  it('ENV "1"/"TRUE"/"yes" 거부 (정확 비교 ADR-0157)', () => {
    const original = process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED;
    try {
      for (const v of ['1', 'TRUE', 'yes']) {
        process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED = v;
        expect(isCounterfactualShadowPerfReportDisabled()).toBe(false);
      }
    } finally {
      if (original !== undefined)
        process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED = original;
      else delete process.env.COUNTERFACTUAL_SHADOW_PERF_REPORT_DISABLED;
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // 11. blockedByBreakdown 분포 — 다중 blocker 정합
  // ──────────────────────────────────────────────────────────────────────
  it('§G: blockedByBreakdown 다중 blocker 빈도 정합', async () => {
    const e1 = makeEntry({ symbol: '005930', scanId: 's1', blockedBy: ['SELL_ONLY'] });
    const e2 = makeEntry({
      symbol: '000660',
      scanId: 's2',
      blockedBy: ['VIX_BLOCK', 'ROUTER_HARD_BLOCK'],
    });
    const e3 = makeEntry({
      symbol: '035420',
      scanId: 's3',
      blockedBy: ['SELL_ONLY', 'FOMC_BLOCK'],
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [e1, e2, e3],
      nowKst: '2026-05-12T15:00:00+09:00',
    });
    expect(summary.totalEntries).toBe(3);
    expect(summary.blockedByBreakdown.SELL_ONLY).toBe(2);
    expect(summary.blockedByBreakdown.VIX_BLOCK).toBe(1);
    expect(summary.blockedByBreakdown.ROUTER_HARD_BLOCK).toBe(1);
    expect(summary.blockedByBreakdown.FOMC_BLOCK).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 12. avgReturn / winRate by horizon (observed only — PENDING / DATA_UNAVAILABLE 제외)
  // ──────────────────────────────────────────────────────────────────────
  it('§F: avgReturnByHorizon / winRateByHorizon 분모 OBSERVED only — PENDING 제외', async () => {
    // 두 entry — 한 entry 만 OBSERVED, 다른 한 entry 는 horizon 미도달.
    const provider: CounterfactualShadowPriceProvider = async () => ({
      available: true,
      price: 110000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const e1 = makeEntry({
      symbol: '005930',
      scanId: 's1',
      entryPrice: 100000,
      createdAtKst: '2026-05-07T09:00:00+09:00',
    });
    const e2 = makeEntry({
      symbol: '000660',
      scanId: 's2',
      entryPrice: 100000,
      createdAtKst: '2026-05-12T14:55:00+09:00', // horizon 미도달
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [e1, e2],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(2);
    // T_PLUS_30M: e1 만 OBSERVED, e2 는 PENDING → 분모 1
    const avg30m = summary.avgReturnByHorizon.T_PLUS_30M;
    expect(avg30m).toBeCloseTo(10.0, 1);
    expect(summary.winRateByHorizon.T_PLUS_30M).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 13. Top winners / losers ordering
  // ──────────────────────────────────────────────────────────────────────
  it('§G: topWinners — bestReturnPct desc / topLosers — worstReturnPct asc', async () => {
    const provider: CounterfactualShadowPriceProvider = async (symbol) => {
      const map: Record<string, number> = {
        '005930': 110000, // +10%
        '000660': 105000, // +5%
        '035420': 92000, // -8%
      };
      return {
        available: true,
        price: map[symbol] ?? 100000,
        observedAtKst: '2026-05-07T11:00:00+09:00',
      };
    };
    const entries = [
      makeEntry({ symbol: '005930', scanId: 's1', entryPrice: 100000 }),
      makeEntry({ symbol: '000660', scanId: 's2', entryPrice: 100000 }),
      makeEntry({ symbol: '035420', scanId: 's3', entryPrice: 100000 }),
    ];
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries,
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
      topN: 3,
    });
    expect(summary.topWinners[0].symbol).toBe('005930'); // +10%
    expect(summary.topWinners[1].symbol).toBe('000660'); // +5%
    expect(summary.topLosers[0].symbol).toBe('035420'); // -8%
  });

  // ──────────────────────────────────────────────────────────────────────
  // 14. labelBreakdown — 라벨별 카운트
  // ──────────────────────────────────────────────────────────────────────
  it('§G: labelBreakdown 라벨별 분포', async () => {
    const e1 = makeEntry({
      symbol: '005930',
      scanId: 's1',
      label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
    });
    const e2 = makeEntry({
      symbol: '000660',
      scanId: 's2',
      label: 'R3_COUNTERFACTUAL_UNDER_HARD_BLOCK',
    });
    const e3 = makeEntry({
      symbol: '035420',
      scanId: 's3',
      label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [e1, e2, e3],
      nowKst: '2026-05-12T15:00:00+09:00',
    });
    expect(summary.labelBreakdown['R3_COUNTERFACTUAL_UNDER_SELL_ONLY']).toBe(2);
    expect(summary.labelBreakdown['R3_COUNTERFACTUAL_UNDER_HARD_BLOCK']).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 15. §E: maxEntries 제한 (외부 호출 폭주 차단)
  // ──────────────────────────────────────────────────────────────────────
  it('§E: maxEntries 제한 — 최신 N건만 처리', async () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry({
        symbol: `S${i.toString().padStart(6, '0')}`,
        scanId: `scan-${i}`,
        createdAtKst: `2026-05-${((i % 30) + 1).toString().padStart(2, '0')}T10:00:00+09:00`,
      }),
    );
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries,
      nowKst: '2026-06-15T10:00:00+09:00',
      maxEntries: 10,
    });
    expect(summary.totalEntries).toBe(10);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 16. formatter — totalEntries=0 (사용자 §I)
  // ──────────────────────────────────────────────────────────────────────
  it('§I: formatter totalEntries=0 → 정상 안내 (실패 아님)', async () => {
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [],
      nowKst: '2026-05-08T10:00:00+09:00',
    });
    const message = formatCounterfactualShadowPerformanceMessage(summary);
    expect(message).toContain('Counterfactual Shadow Report (ADR-0431)');
    expect(message).toContain('아직 counterfactual shadow learning entry 가 없습니다');
    expect(message).toContain('SELL_ONLY/HARD_BLOCK 발생 시 ADR-0430');
    // 학습 전용 marker 명시
    expect(message).toContain('실매수/가상계좌 영향 0');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 17. formatter observed 표시 (사용자 §G)
  // ──────────────────────────────────────────────────────────────────────
  it('§G: formatter observed entries 표시 — 6 horizon 포맷', async () => {
    const provider: CounterfactualShadowPriceProvider = async (_symbol, horizon) => {
      const priceMap: Partial<Record<CounterfactualShadowHorizon, number>> = {
        T_PLUS_30M: 101000,
        T_PLUS_1H: 102000,
        SAME_DAY_CLOSE: 105000,
      };
      const price = priceMap[horizon];
      return price !== undefined
        ? { available: true, price, observedAtKst: '2026-05-07T11:00:00+09:00' }
        : { available: false, reason: 'no data', status: 'DATA_UNAVAILABLE' };
    };
    const entry = makeEntry({ entryPrice: 100000 });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    const message = formatCounterfactualShadowPerformanceMessage(summary);
    expect(message).toContain('Counterfactual Shadow Report (ADR-0431)');
    expect(message).toContain('totalEntries:');
    expect(message).toContain('observed:');
    expect(message).toContain('Label Breakdown');
    expect(message).toContain('R3_COUNTERFACTUAL_UNDER_SELL_ONLY: 1건');
    expect(message).toContain('BlockedBy Breakdown');
    expect(message).toContain('SELL_ONLY: 1건');
    expect(message).toContain('Horizon 성과');
    expect(message).toContain('+30m');
    expect(message).toContain('+1h');
    expect(message).toContain('close');
    expect(message).toContain('Top winners');
    expect(message).toContain('005930');
    expect(message).toContain('자동 paper/live 승격 0');
    expect(message).toContain('learning=✅');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 18. §H: /scan_blockers 짧은 요약
  // ──────────────────────────────────────────────────────────────────────
  it('§H: formatCounterfactualShadowSummaryLine — 짧은 요약 (+ insufficient 카운트)', () => {
    const summary = {
      totalEntries: 9,
      observedEntries: 5,
      pendingEntries: 3,
      insufficientDataEntries: 1,
      labelBreakdown: { R3_COUNTERFACTUAL_UNDER_SELL_ONLY: 9 },
      blockedByBreakdown: { SELL_ONLY: 9 },
      avgReturnByHorizon: {},
      winRateByHorizon: {},
      topWinners: [],
      topLosers: [],
      generatedAtKst: '2026-05-08T10:00:00+09:00',
    };
    const line = formatCounterfactualShadowSummaryLine(summary);
    expect(line).toContain('Counterfactual Shadow');
    expect(line).toContain('ledger:');
    expect(line).toContain('9');
    expect(line).toContain('observed:');
    expect(line).toContain('5');
    expect(line).toContain('pending:');
    expect(line).toContain('3');
    expect(line).toContain('insufficient:');
    expect(line).toContain('1');
    expect(line).toContain('/shadow_counterfactual');
  });

  it('§H: formatCounterfactualShadowSummaryLine totalEntries=0 → null', () => {
    const summary = {
      totalEntries: 0,
      observedEntries: 0,
      pendingEntries: 0,
      insufficientDataEntries: 0,
      labelBreakdown: {},
      blockedByBreakdown: {},
      avgReturnByHorizon: {},
      winRateByHorizon: {},
      topWinners: [],
      topLosers: [],
      generatedAtKst: '2026-05-08T10:00:00+09:00',
    };
    expect(formatCounterfactualShadowSummaryLine(summary)).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 19. helper unit — isValidCounterfactualEntry / isHorizonReached / resolveCounterfactualEntryPrice
  // ──────────────────────────────────────────────────────────────────────
  it('isValidCounterfactualEntry — 3중 검증 SSOT', () => {
    expect(isValidCounterfactualEntry(makeEntry())).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrongSource: any = { ...makeEntry(), source: 'ADR-0426' };
    expect(isValidCounterfactualEntry(wrongSource)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrongLearning: any = { ...makeEntry(), learningOnly: false };
    expect(isValidCounterfactualEntry(wrongLearning)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrongEvent: any = { ...makeEntry(), eventType: 'BUY' };
    expect(isValidCounterfactualEntry(wrongEvent)).toBe(false);
  });

  it('isHorizonReached — entry 후 경과 시간 검증', () => {
    const entryAt = '2026-05-07T10:00:00+09:00';
    const entryMs = Date.parse(entryAt);
    expect(isHorizonReached(entryAt, 'T_PLUS_30M', entryMs + 30 * 60 * 1000)).toBe(true);
    expect(isHorizonReached(entryAt, 'T_PLUS_30M', entryMs + 29 * 60 * 1000)).toBe(false);
    expect(isHorizonReached('invalid-iso', 'T_PLUS_30M', Date.now())).toBe(false);
  });

  it('resolveCounterfactualEntryPrice — fallback chain 우선순위 SSOT', () => {
    // 1. 직접 entryPrice 우선
    expect(resolveCounterfactualEntryPrice(makeEntry({ entryPrice: 100000 }))).toBe(100000);
    // 2. entryPriceHint
    expect(resolveCounterfactualEntryPrice(makeEntry({ entryPriceHint: 99000 }))).toBe(99000);
    // 3. metadata.entryPriceHint
    expect(
      resolveCounterfactualEntryPrice(
        makeEntry({ metadata: { entryPriceHint: 88000 } }),
      ),
    ).toBe(88000);
    // 4. conditionSnapshot.price
    expect(
      resolveCounterfactualEntryPrice(makeEntry({ conditionSnapshot: { price: 77000 } })),
    ).toBe(77000);
    // 5. conditionSnapshot.lastPrice
    expect(
      resolveCounterfactualEntryPrice(
        makeEntry({ conditionSnapshot: { lastPrice: 66000 } }),
      ),
    ).toBe(66000);
    // 6. metadata.quoteSnapshot.lastPrice
    expect(
      resolveCounterfactualEntryPrice(
        makeEntry({ metadata: { quoteSnapshot: { lastPrice: 55000 } } }),
      ),
    ).toBe(55000);
    // 부재 → undefined
    expect(resolveCounterfactualEntryPrice(makeEntry())).toBeUndefined();
    // NaN / 0 / 음수 거부
    expect(resolveCounterfactualEntryPrice(makeEntry({ entryPrice: 0 }))).toBeUndefined();
    expect(resolveCounterfactualEntryPrice(makeEntry({ entryPrice: -1 }))).toBeUndefined();
    expect(resolveCounterfactualEntryPrice(makeEntry({ entryPrice: NaN }))).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 20. formatter — 모든 horizon pending → insufficient data
  // ──────────────────────────────────────────────────────────────────────
  it('formatter 모든 horizon pending → insufficient data 표기', async () => {
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [makeEntry()],
      nowKst: '2026-05-12T15:00:00+09:00',
    });
    const message = formatCounterfactualShadowPerformanceMessage(summary);
    expect(message).toContain('insufficient data');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 21. record schema — literal markers 보존 (혼합 차단 invariant)
  // ──────────────────────────────────────────────────────────────────────
  it('record schema literal — source ADR-0430 / learningOnly true / executionShadow false / virtualAccountImpact NONE', async () => {
    const provider: CounterfactualShadowPriceProvider = async () => ({
      available: true,
      price: 105000,
      observedAtKst: '2026-05-07T11:00:00+09:00',
    });
    const summary = await buildCounterfactualShadowPerformanceReport({
      entries: [makeEntry({ entryPrice: 100000 })],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    const r = summary.topWinners[0];
    expect(r.source).toBe('ADR-0430');
    expect(r.learningOnly).toBe(true);
    expect(r.executionShadow).toBe(false);
    expect(r.virtualAccountImpact).toBe('NONE');
    expect(r.routerSnapshot?.learningShadowAllowed).toBe(true);
    expect(r.routerSnapshot?.shadowAllowed).toBe(false);
    expect(r.routerSnapshot?.liveAllowed).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 22. §J 정적 grep 가드 — 일반 shadow / provisional 분리, LIVE 매매 영향 0
  // ──────────────────────────────────────────────────────────────────────
  describe('§J 정적 grep 가드 — counterfactual ledger 분리 + LIVE 매매 영향 0', () => {
    function stripComments(src: string): string {
      return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    }
    const STRIPPED_SOURCE = stripComments(REPORT_SOURCE);
    const STRIPPED_ADAPTER = stripComments(ADAPTER_SOURCE);

    it('shadowTradeRepo / shadow-trades.json import 0건', () => {
      expect(STRIPPED_SOURCE).not.toMatch(
        /shadowTradeRepo|appendShadow|saveShadowTrades|shadow-trades\.json/,
      );
      expect(STRIPPED_ADAPTER).not.toMatch(
        /shadowTradeRepo|appendShadow|saveShadowTrades|shadow-trades\.json/,
      );
    });

    it('provisionalShadowLedger import 0건 — 본 모듈은 counterfactual ledger 만', () => {
      // 어댑터는 priceProvider 시그니처 (타입) 만 import — 영속 ledger 직접 read 0건.
      expect(STRIPPED_SOURCE).not.toMatch(/provisionalShadowLedger|provisional-shadow-ledger\.json/);
      expect(STRIPPED_ADAPTER).not.toMatch(/loadProvisionalShadowLedger|provisional-shadow-ledger\.json/);
    });

    it('KIS 주문 함수 5종 import 0건', () => {
      expect(STRIPPED_SOURCE).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
      expect(STRIPPED_ADAPTER).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
      expect(STRIPPED_ADAPTER).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    });

    it('Gate threshold / STRONG_BUY 변경 키워드 부재', () => {
      expect(STRIPPED_SOURCE).not.toMatch(
        /setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX|STRONG_BUY_OVERRIDE/,
      );
    });

    it('자동 paper/live 승격 키워드 부재', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/promoteToPaper|promoteToLive|autoPromote/);
      expect(STRIPPED_ADAPTER).not.toMatch(/promoteToPaper|promoteToLive|autoPromote/);
    });

    it('직접 fetch / axios / node-fetch import 0건', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/^import.*['"](?:fetch|axios|node-fetch)/m);
      expect(STRIPPED_SOURCE).not.toMatch(/\bfetch\(/);
      expect(STRIPPED_ADAPTER).not.toMatch(/^import.*['"](?:fetch|axios|node-fetch)/m);
      expect(STRIPPED_ADAPTER).not.toMatch(/\bfetch\(/);
    });

    it('virtual account holdings/cash 변경 키워드 부재', () => {
      expect(STRIPPED_SOURCE).not.toMatch(
        /setVirtualAccountHoldings|updateVirtualAccountCash|mutateHoldings|setEquity/,
      );
    });

    it('isValidCounterfactualEntry — eventType + source + learningOnly 3중 검증 본문 보존', () => {
      expect(STRIPPED_SOURCE).toContain("entry.eventType === 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY'");
      expect(STRIPPED_SOURCE).toContain("entry.source === 'ADR-0430'");
      expect(STRIPPED_SOURCE).toContain('entry.learningOnly === true');
    });

    it('ADR-0431 inline comment 본문 보존 (사용자 §G 정합)', () => {
      // 사용자 명시 ADR comment block 이 코드 헤더 또는 함수 근처에 정확히 존재.
      expect(REPORT_SOURCE).toContain('ADR-0431');
      expect(REPORT_SOURCE).toContain('learning-only samples');
      expect(REPORT_SOURCE).toContain('treat PENDING/DATA_UNAVAILABLE');
      expect(REPORT_SOURCE).toContain('correctly blocked');
    });
  });
});
