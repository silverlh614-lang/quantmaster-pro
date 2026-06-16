// @responsibility ADR-0428 Provisional Shadow Performance Report 회귀 테스트.
//
// 사용자 §J 정합 — 일반 shadow buy 와 분리, source: ADR-0426 만 대상, provisional !== true 무시.
// 외부 API 호출 0 (priceProvider 의존성 주입 default 미전달 → PENDING).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buildProvisionalShadowPerformanceReport,
  formatProvisionalShadowPerformanceMessage,
  formatProvisionalShadowSummaryLine,
  isProvisionalShadowPerfReportDisabled,
  HORIZON_OFFSET_MS,
  type ProvisionalShadowHorizon,
  type ProvisionalShadowPriceProvider,
} from './provisionalShadowPerformanceReport.js';
import type { ProvisionalShadowLedgerEntry } from '../persistence/provisionalShadowLedger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORT_PATH = join(__dirname, 'provisionalShadowPerformanceReport.ts');
const REPORT_SOURCE = readFileSync(REPORT_PATH, 'utf-8');

function makeEntry(overrides: Partial<ProvisionalShadowLedgerEntry> = {}): ProvisionalShadowLedgerEntry {
  return {
    eventType: 'PROVISIONAL_SHADOW_ENTRY',
    provisional: true,
    source: 'ADR-0426',
    symbol: '005930',
    name: '삼성전자',
    scanId: '2026-05-07:scan-1',
    scannedAtKst: '2026-05-07T10:00:00+09:00',
    createdAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
    reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'NO_HARD_RISK', 'GATE2_NOT_CONFIRMED'],
    regime: 'R3_EARLY',
    gate1Passed: true,
    gate2Passed: false,
    liveAllowed: false,
    shadowAllowed: true,
    routerSeverity: 'SOFT_DEGRADE',
    ...overrides,
  };
}

describe('ADR-0428 Provisional Shadow Performance Report', () => {
  // ────────────────────────────────────────────────────────
  // §B: 빈 entries → totalEntries=0
  // ────────────────────────────────────────────────────────
  it('§B: 빈 ledger → totalEntries=0', async () => {
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [],
      nowKst: '2026-05-08T10:00:00+09:00',
    });
    expect(summary.totalEntries).toBe(0);
    expect(summary.observedEntries).toBe(0);
    expect(summary.pendingEntries).toBe(0);
    expect(summary.topWinners).toEqual([]);
    expect(summary.topLosers).toEqual([]);
  });

  // ────────────────────────────────────────────────────────
  // §J: 일반 shadow buy (provisional !== true) 무시
  // ────────────────────────────────────────────────────────
  it('§J: provisional=false 또는 source≠ADR-0426 entry 무시', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generalShadow: any = {
      eventType: 'BUY',
      provisional: false,
      source: 'GENERAL_SHADOW',
      symbol: '005930',
      createdAtKst: '2026-05-07T10:00:00+09:00',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrongSource: any = {
      eventType: 'PROVISIONAL_SHADOW_ENTRY',
      provisional: true,
      source: 'OTHER',
      symbol: '005930',
      createdAtKst: '2026-05-07T10:00:00+09:00',
    };
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [generalShadow, wrongSource, makeEntry()],
      nowKst: '2026-05-08T10:00:00+09:00',
    });
    expect(summary.totalEntries).toBe(1); // makeEntry 만 통과
  });

  // ────────────────────────────────────────────────────────
  // §C/§D: priceProvider 미전달 → 모든 horizon PENDING
  // ────────────────────────────────────────────────────────
  it('§D: priceProvider 미전달 → 모든 horizon PENDING (외부 호출 0)', async () => {
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [makeEntry()],
      nowKst: '2026-05-12T15:00:00+09:00',  // 충분히 늦은 시점
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.pendingEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
    expect(Object.keys(summary.avgReturnByHorizon)).toEqual([]);
  });

  // ────────────────────────────────────────────────────────
  // §C: priceProvider 정상 → returnPct 계산
  // ────────────────────────────────────────────────────────
  it('§C: priceProvider 정상 + entryPrice → returnPct 계산', async () => {
    const provider: ProvisionalShadowPriceProvider = async (_symbol, horizon) => {
      const priceMap: Partial<Record<ProvisionalShadowHorizon, number>> = {
        T_PLUS_30M: 102000,
        T_PLUS_1H: 103000,
        SAME_DAY_CLOSE: 104000,
      };
      const price = priceMap[horizon];
      if (price === undefined) {
        return { available: false, reason: 'horizon not provided', status: 'DATA_UNAVAILABLE' };
      }
      return { available: true, price, observedAtKst: '2026-05-07T11:00:00+09:00' };
    };
    const entry = makeEntry({ entryPrice: 100000, entryPriceSource: 'KIS_CURRENT' });
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(1);
    expect(summary.avgReturnByHorizon.T_PLUS_30M).toBeCloseTo(2.0, 1);  // (102k-100k)/100k = 2%
    expect(summary.avgReturnByHorizon.T_PLUS_1H).toBeCloseTo(3.0, 1);
    expect(summary.avgReturnByHorizon.SAME_DAY_CLOSE).toBeCloseTo(4.0, 1);
    expect(summary.winRateByHorizon.T_PLUS_30M).toBe(1);  // 2% > 0
    expect(summary.topWinners).toHaveLength(1);
    expect(summary.topWinners[0].summary.bestReturnPct).toBeCloseTo(4.0, 1);
  });

  // ────────────────────────────────────────────────────────
  // §C: entryPrice 부재 → DATA_UNAVAILABLE
  // ────────────────────────────────────────────────────────
  it('§C: entryPrice 부재 시 DATA_UNAVAILABLE', async () => {
    const provider: ProvisionalShadowPriceProvider = async () =>
      ({ available: true, price: 105000, observedAtKst: '2026-05-07T11:00:00+09:00' });
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [makeEntry()],  // entryPrice 부재
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    // 모든 horizon DATA_UNAVAILABLE → observedEntries 0
    expect(summary.observedEntries).toBe(0);
    expect(summary.pendingEntries).toBe(0);  // PENDING 아님 (DATA_UNAVAILABLE)
  });

  // ────────────────────────────────────────────────────────
  // §C: priceProvider throw → ERROR
  // ────────────────────────────────────────────────────────
  it('§C: priceProvider throw → ERROR (catch 격리, 다른 entry 무영향)', async () => {
    const provider: ProvisionalShadowPriceProvider = async () => {
      throw new Error('mock error');
    };
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [makeEntry()],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
  });

  // ────────────────────────────────────────────────────────
  // Horizon offsets — 도달 시점 검증
  // ────────────────────────────────────────────────────────
  it('horizon 도달 전 (entry 직후) → PENDING', async () => {
    const provider: ProvisionalShadowPriceProvider = async () =>
      ({ available: true, price: 105000, observedAtKst: '2026-05-07T10:00:00+09:00' });
    const entry = makeEntry({
      createdAtKst: '2026-05-07T09:55:00+09:00',
      entryPrice: 100000,
    });
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-07T09:56:00+09:00',  // 1분 후 — T+30m 미도달
      priceProvider: provider,
    });
    expect(summary.totalEntries).toBe(1);
    // 모든 horizon PENDING (도달 전)
    expect(summary.pendingEntries).toBe(1);
    expect(summary.observedEntries).toBe(0);
  });

  it('HORIZON_OFFSET_MS SSOT 정합', () => {
    expect(HORIZON_OFFSET_MS.T_PLUS_30M).toBe(30 * 60 * 1_000);
    expect(HORIZON_OFFSET_MS.T_PLUS_1H).toBe(60 * 60 * 1_000);
    expect(Object.isFrozen(HORIZON_OFFSET_MS)).toBe(true);
  });

  // ────────────────────────────────────────────────────────
  // ENV 우회
  // ────────────────────────────────────────────────────────
  it('ENV PROVISIONAL_SHADOW_PERF_REPORT_DISABLED=true → 빈 summary', async () => {
    const original = process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED;
    process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED = 'true';
    try {
      const summary = await buildProvisionalShadowPerformanceReport({
        entries: [makeEntry()],
        nowKst: '2026-05-12T15:00:00+09:00',
      });
      expect(summary.totalEntries).toBe(0);
      expect(isProvisionalShadowPerfReportDisabled()).toBe(true);
    } finally {
      if (original !== undefined) process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED = original;
      else delete process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED;
    }
  });

  it('ENV "1"/"TRUE"/"yes" 거부 (정확 비교)', () => {
    const original = process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED;
    try {
      for (const v of ['1', 'TRUE', 'yes']) {
        process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED = v;
        expect(isProvisionalShadowPerfReportDisabled()).toBe(false);
      }
    } finally {
      if (original !== undefined) process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED = original;
      else delete process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED;
    }
  });

  // ────────────────────────────────────────────────────────
  // §E: maxEntries 제한 (외부 호출 폭주 차단)
  // ────────────────────────────────────────────────────────
  it('§E: maxEntries 제한 — 최신 N건만 처리', async () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry({
        symbol: `S${i.toString().padStart(6, '0')}`,
        scanId: `scan-${i}`,
        createdAtKst: `2026-05-${(i % 30 + 1).toString().padStart(2, '0')}T10:00:00+09:00`,
      }),
    );
    const summary = await buildProvisionalShadowPerformanceReport({
      entries,
      nowKst: '2026-06-15T10:00:00+09:00',
      maxEntries: 10,
    });
    expect(summary.totalEntries).toBe(10);
    expect(summary.labelBreakdown['R3_PROVISIONAL_LEADER_DATA_DEGRADED']).toBe(10);
  });

  // ────────────────────────────────────────────────────────
  // formatter — totalEntries=0 (사용자 §I)
  // ────────────────────────────────────────────────────────
  it('§I: formatter totalEntries=0 → 정상 안내 (실패 아님)', async () => {
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [],
      nowKst: '2026-05-08T10:00:00+09:00',
    });
    const message = formatProvisionalShadowPerformanceMessage(summary);
    expect(message).toContain('Provisional Shadow Report (ADR-0428)');
    expect(message).toContain('아직 provisional shadow entry 가 없습니다');
    expect(message).toContain('HARD_BLOCK / SELL_ONLY 상태에서는 Shadow 학습도 제한');
  });

  // ────────────────────────────────────────────────────────
  // formatter — observed entries 표시 (사용자 §G 정합)
  // ────────────────────────────────────────────────────────
  it('§G: formatter observed entries 6 항목 표시', async () => {
    const provider: ProvisionalShadowPriceProvider = async (_symbol, horizon) => {
      const priceMap: Partial<Record<ProvisionalShadowHorizon, number>> = {
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
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [entry],
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
    });
    const message = formatProvisionalShadowPerformanceMessage(summary);
    expect(message).toContain('Provisional Shadow Report (ADR-0428)');
    expect(message).toContain('totalEntries:');
    expect(message).toContain('observed:');
    expect(message).toContain('Label Breakdown');
    expect(message).toContain('R3_PROVISIONAL_LEADER_DATA_DEGRADED: 1건');
    expect(message).toContain('Horizon 성과');
    expect(message).toContain('+30m');
    expect(message).toContain('+1h');
    expect(message).toContain('close');
    expect(message).toContain('Top winners');
    expect(message).toContain('005930');
    expect(message).toContain('학습/검증');
    expect(message).toContain('자동 paper/live 승격 0');
  });

  // ────────────────────────────────────────────────────────
  // formatter — 모든 horizon pending
  // ────────────────────────────────────────────────────────
  it('formatter 모든 horizon pending → insufficient data 표기', async () => {
    const summary = await buildProvisionalShadowPerformanceReport({
      entries: [makeEntry()],
      nowKst: '2026-05-12T15:00:00+09:00',
    });
    const message = formatProvisionalShadowPerformanceMessage(summary);
    expect(message).toContain('insufficient data');
  });

  // ────────────────────────────────────────────────────────
  // §H: /scan_blockers 짧은 요약
  // ────────────────────────────────────────────────────────
  it('§H: formatProvisionalShadowSummaryLine — 짧은 요약', () => {
    const summary = {
      totalEntries: 7,
      observedEntries: 4,
      pendingEntries: 3,
      labelBreakdown: { R3_PROVISIONAL_LEADER_DATA_DEGRADED: 7 },
      avgReturnByHorizon: {},
      winRateByHorizon: {},
      topWinners: [],
      topLosers: [],
      generatedAtKst: '2026-05-08T10:00:00+09:00',
    };
    const line = formatProvisionalShadowSummaryLine(summary);
    expect(line).toContain('Provisional Shadow');
    expect(line).toContain('ledger:');
    expect(line).toContain('7');
    expect(line).toContain('observed:');
    expect(line).toContain('4');
    expect(line).toContain('pending:');
    expect(line).toContain('3');
    expect(line).toContain('/shadow_provisional');
  });

  it('§H: formatProvisionalShadowSummaryLine totalEntries=0 → null', () => {
    const summary = {
      totalEntries: 0,
      observedEntries: 0,
      pendingEntries: 0,
      labelBreakdown: {},
      avgReturnByHorizon: {},
      winRateByHorizon: {},
      topWinners: [],
      topLosers: [],
      generatedAtKst: '2026-05-08T10:00:00+09:00',
    };
    expect(formatProvisionalShadowSummaryLine(summary)).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // 정렬 — Top winners / losers
  // ────────────────────────────────────────────────────────
  it('Top winners — bestReturnPct 내림차순', async () => {
    const provider: ProvisionalShadowPriceProvider = async (symbol) => {
      const map: Record<string, number> = {
        '005930': 110000, // +10%
        '000660': 105000, // +5%
        '035420': 95000,  // -5%
      };
      return { available: true, price: map[symbol] ?? 100000, observedAtKst: '2026-05-07T11:00:00+09:00' };
    };
    const entries = [
      makeEntry({ symbol: '005930', scanId: 's1', entryPrice: 100000 }),
      makeEntry({ symbol: '000660', scanId: 's2', entryPrice: 100000 }),
      makeEntry({ symbol: '035420', scanId: 's3', entryPrice: 100000 }),
    ];
    const summary = await buildProvisionalShadowPerformanceReport({
      entries,
      nowKst: '2026-05-12T15:00:00+09:00',
      priceProvider: provider,
      topN: 3,
    });
    expect(summary.topWinners[0].symbol).toBe('005930');  // +10%
    expect(summary.topWinners[1].symbol).toBe('000660');  // +5%
    expect(summary.topLosers[0].symbol).toBe('035420');  // -5%
  });

  // ────────────────────────────────────────────────────────
  // ADR-0617: entryPrice 측정 배선 회귀
  // ────────────────────────────────────────────────────────
  describe('ADR-0617 entryPrice measurement wiring', () => {
    it('entryPrice 있는 신규 엔트리 + forward price → OBSERVED + returnPct 정확', async () => {
      const provider: ProvisionalShadowPriceProvider = async (_symbol, horizon) => {
        const priceMap: Partial<Record<ProvisionalShadowHorizon, number>> = {
          T_PLUS_30M: 71500, // (71500-65000)/65000 = +10%
        };
        const price = priceMap[horizon];
        return price !== undefined
          ? { available: true, price, observedAtKst: '2026-05-07T10:30:00+09:00' }
          : { available: false, reason: 'no data', status: 'DATA_UNAVAILABLE' };
      };
      const entry = makeEntry({ entryPrice: 65000, entryPriceSource: 'KIS_CURRENT' });
      const summary = await buildProvisionalShadowPerformanceReport({
        entries: [entry],
        nowKst: '2026-05-12T15:00:00+09:00',
        priceProvider: provider,
      });
      expect(summary.observedEntries).toBe(1);
      expect(summary.avgReturnByHorizon.T_PLUS_30M).toBeCloseTo(10.0, 1);
    });

    it('entryPrice 없는 legacy 엔트리(필드 부재) → INSUFFICIENT_DATA 유지 (하위호환, 소급 0)', async () => {
      const provider: ProvisionalShadowPriceProvider = async () =>
        ({ available: true, price: 71500, observedAtKst: '2026-05-07T10:30:00+09:00' });
      const legacyEntry = makeEntry(); // entryPrice 필드 부재 (기존 50건 형태)
      expect((legacyEntry as ProvisionalShadowLedgerEntry).entryPrice).toBeUndefined();
      const summary = await buildProvisionalShadowPerformanceReport({
        entries: [legacyEntry],
        nowKst: '2026-05-12T15:00:00+09:00',
        priceProvider: provider,
      });
      expect(summary.totalEntries).toBe(1);
      // forward price 는 있지만 entryPrice 부재 → returnPct 산출 불가 → DATA_UNAVAILABLE, observed 0.
      expect(summary.observedEntries).toBe(0);
      expect(summary.pendingEntries).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────
  // §J 정적 grep 가드 — 일반 shadow buy 와 분리
  // ────────────────────────────────────────────────────────
  describe('§J 정적 grep 가드 — 일반 shadow buy 와 분리 + LIVE 매매 영향 0', () => {
    // 정적 grep 가드 — 주석은 strip 후 코드 본체만 검사 (의도된 ADR 주석 false positive 차단).
    function stripComments(src: string): string {
      // 라인 주석 + 블록 주석 제거 (단순 휴리스틱, 본 PR 코드베이스 기준 충분)
      return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    }

    const STRIPPED_SOURCE = stripComments(REPORT_SOURCE);

    it('shadowTradeRepo / shadow-trades.json import 0건 (코드 본체)', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/shadowTradeRepo|appendShadow|saveShadowTrades|shadow-trades\.json/);
    });

    it('KIS 주문 함수 5종 import 0건 (코드 본체)', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 0건 (코드 본체)', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    });

    it('Gate threshold / STRONG_BUY 변경 키워드 부재', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX|STRONG_BUY_OVERRIDE/);
    });

    it('직접 fetch / axios / node-fetch import 0건 (priceProvider 의존성 주입만)', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/^import.*['"](?:fetch|axios|node-fetch)/m);
      expect(STRIPPED_SOURCE).not.toMatch(/\bfetch\(/);
    });

    it('자동 paper/live 승격 키워드 부재', () => {
      expect(STRIPPED_SOURCE).not.toMatch(/promoteToPaper|promoteToLive|autoPromote/);
    });

    it('isValidProvisionalEntry 검증 — provisional !== true 무시', () => {
      expect(STRIPPED_SOURCE).toContain("entry.provisional === true");
      expect(STRIPPED_SOURCE).toContain("entry.source === 'ADR-0426'");
      expect(STRIPPED_SOURCE).toContain("entry.eventType === 'PROVISIONAL_SHADOW_ENTRY'");
    });
  });
});
