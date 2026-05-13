/**
 * Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 회귀 — 사용자 §10 명시 10 mandatory 테스트
 * + 12+ 정적 grep 가드 + literal type contract + 통합 시나리오.
 *
 * 안전 invariants (회귀 차단):
 *   - LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient/auth /
 *     kisClient/orders / kisClient/holdings / kisClient/query / orchestrator /
 *     autoTradeEngine / trancheExecutor / buyPipeline 모두 0줄).
 *   - KIS 주문 함수 5종 import 0건 (정적 grep, stripComments 후).
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건.
 *   - 외부 fetch / axios / node-fetch / 외부 API 신규 호출 0건.
 *   - providerIssue=true / marketSignal=false / executionImpact='NONE' /
 *     shadowLearningAllowed=true / telegramAllowed=false / engineModeImpact='NONE' /
 *     learningTag='CASE_KIS_REALDATA_500' literal type 컴파일 타임 강제.
 *   - ENV `KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED=true` (ADR-0157 정확 비교 —
 *     `'1'`/`'TRUE'`/`'yes'`/빈값 모두 거부) 1줄 즉시 Patch-001 직후 동작 100% 복원.
 *   - 호출자 측 inline ENV 검사 0건 — SSOT 헬퍼 위임 의무.
 *   - emergencyStop / SELL_ONLY / SHADOW_ONLY 자동 전환 0건.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROVIDER_HEALTH_ISOLATION_CONSTANTS,
  __resetProviderHealthIsolationForTests,
  __setShadowCasesMaxForTests,
  applyInvestorFlowProviderIssueOverride,
  buildProviderHealthIsolationRuntimeSummary,
  classifyKisRealDataError,
  evaluateCircuitTransition,
  formatProviderHealthIsolationSection,
  getLastGoodValue,
  getProviderCircuitSnapshot,
  isProviderHealthIsolationDisabled,
  listLastGoodValueEntries,
  listShadowCaseRecords,
  recordProviderFailure,
  recordProviderSuccess,
  recordShadowCaseForKis500,
  selectFallbackProvider,
  setLastGoodValue,
  shouldSkipProviderCall,
} from './providerHealthIsolationPatch003.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

afterEach(() => {
  delete process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED;
  vi.restoreAllMocks();
  __resetProviderHealthIsolationForTests();
});

beforeEach(() => {
  __resetProviderHealthIsolationForTests();
  delete process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED;
});

/* ────────────────────────── Group A: ENV gate (4) ──────────────────────────── */

describe('Group A — ENV gate (ADR-0157 정확 비교)', () => {
  it('default OFF — isProviderHealthIsolationDisabled() === false', () => {
    delete process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED;
    expect(isProviderHealthIsolationDisabled()).toBe(false);
  });

  it('=== "true" 정확 비교 통과', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = 'true';
    expect(isProviderHealthIsolationDisabled()).toBe(true);
  });

  it("`'1'`/`'TRUE'`/`'yes'` 모두 거부 (ADR-0157)", () => {
    for (const v of ['1', 'TRUE', 'yes', 'Yes', 'on']) {
      process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = v;
      expect(isProviderHealthIsolationDisabled()).toBe(false);
    }
  });

  it('빈 문자열 — 거부', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = '';
    expect(isProviderHealthIsolationDisabled()).toBe(false);
  });
});

/* ────────────────────────── Group B: 절대 임계 SSOT (3) ────────────────────── */

describe('Group B — PROVIDER_HEALTH_ISOLATION_CONSTANTS 절대 변경 금지 SSOT', () => {
  it('사용자 §J #3 임계 정합 — 60s 3건 / 5min 10건 / 연속 5건', () => {
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.CIRCUIT_TRIP_BURST_WINDOW_60S_MS).toBe(60_000);
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.CIRCUIT_TRIP_BURST_THRESHOLD_60S).toBe(3);
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.CIRCUIT_TRIP_BURST_WINDOW_5MIN_MS).toBe(300_000);
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.CIRCUIT_TRIP_BURST_THRESHOLD_5MIN).toBe(10);
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.CIRCUIT_TRIP_CONSECUTIVE_THRESHOLD).toBe(5);
  });

  it('사용자 §J #5 TTL 정합 — fresh 30s, stale 180s', () => {
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.LGV_TTL_FRESH_SEC).toBe(30);
    expect(PROVIDER_HEALTH_ISOLATION_CONSTANTS.LGV_TTL_STALE_SEC).toBe(180);
  });

  it('Object.freeze drift 가드', () => {
    expect(Object.isFrozen(PROVIDER_HEALTH_ISOLATION_CONSTANTS)).toBe(true);
  });
});

/* ────────────────────────── Group C: Circuit breaker state machine (8) ────── */

describe('Group C — Circuit breaker state machine (사용자 §J #3, §J #4)', () => {
  it('CLOSED → 1회 실패 → 여전히 CLOSED (consecutiveFailures=1)', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const snap = recordProviderFailure(cls, new Date('2026-05-13T10:00:00Z'));
    expect(snap.state).toBe('CLOSED');
    expect(snap.consecutiveFailures).toBe(1);
    expect(snap.tripReason).toBe(null);
  });

  it('60s 3건 burst → OPEN + tripReason=HTTP_500_BURST_60S', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date('2026-05-13T10:00:00Z');
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    const snap = recordProviderFailure(cls, new Date(t.getTime() + 30_000));
    expect(snap.state).toBe('OPEN');
    expect(snap.tripReason).toBe('HTTP_500_BURST_60S');
    expect(snap.cooldownUntil).toBeTruthy();
  });

  it('연속 5건 실패 → OPEN + tripReason=CONSECUTIVE_FAILURES (60s window 초과)', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date('2026-05-13T10:00:00Z');
    // 첫 2개를 60s window 밖으로 (60s 임계 회피하고 connectiveFailures 임계 진입)
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 70_000));
    recordProviderFailure(cls, new Date(t.getTime() + 140_000));
    recordProviderFailure(cls, new Date(t.getTime() + 210_000));
    const snap = recordProviderFailure(cls, new Date(t.getTime() + 280_000));
    expect(snap.state).toBe('OPEN');
    // 정확 trip reason 은 가장 먼저 충족한 것 — consecutive 임계가 5 이고
    // 다른 burst 모두 충족 안 함 → CONSECUTIVE_FAILURES
    expect(snap.tripReason).toBe('CONSECUTIVE_FAILURES');
  });

  it('OPEN → cooldown 만료 → HALF_OPEN 자동 전이 (evaluateCircuitTransition)', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date('2026-05-13T10:00:00Z');
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 5_000));
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    expect(getProviderCircuitSnapshot(new Date(t.getTime() + 10_000)).state).toBe('OPEN');
    const later = new Date(t.getTime() + 70_000); // 60s+ → cooldown 만료
    const snap = evaluateCircuitTransition(later);
    expect(snap.state).toBe('HALF_OPEN');
  });

  it('HALF_OPEN 후 성공 → CLOSED + reset', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date('2026-05-13T10:00:00Z');
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 5_000));
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    evaluateCircuitTransition(new Date(t.getTime() + 70_000));
    const snap = recordProviderSuccess(new Date(t.getTime() + 75_000));
    expect(snap.state).toBe('CLOSED');
    expect(snap.consecutiveFailures).toBe(0);
    expect(snap.tripReason).toBe(null);
  });

  it('shouldSkipProviderCall — OPEN 시 true, CLOSED 시 false, HALF_OPEN 시 false', () => {
    expect(shouldSkipProviderCall()).toBe(false); // CLOSED
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date('2026-05-13T10:00:00Z');
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 5_000));
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    expect(shouldSkipProviderCall(new Date(t.getTime() + 15_000))).toBe(true); // OPEN
    // cooldown 만료 후 — HALF_OPEN, skip=false (1회 test 허용)
    expect(shouldSkipProviderCall(new Date(t.getTime() + 75_000))).toBe(false);
  });

  it('snapshot 의 invariant literal — providerIssue=true / marketSignal=false / executionImpact=NONE / engineModeImpact=NONE / shadowLearningAllowed=true', () => {
    const snap = getProviderCircuitSnapshot();
    expect(snap.providerIssue).toBe(true);
    expect(snap.marketSignal).toBe(false);
    expect(snap.executionImpact).toBe('NONE');
    expect(snap.engineModeImpact).toBe('NONE');
    expect(snap.shadowLearningAllowed).toBe(true);
  });

  it('ENV disabled — recordFailure / Success 호출이 state 갱신 0', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = 'true';
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    recordProviderFailure(cls);
    recordProviderFailure(cls);
    recordProviderFailure(cls);
    recordProviderFailure(cls);
    const snap = getProviderCircuitSnapshot();
    expect(snap.state).toBe('CLOSED');
    expect(snap.consecutiveFailures).toBe(0);
  });
});

/* ────────────────────────── Group D: Last Good Value cache (8) ─────────────── */

describe('Group D — Last Good Value cache (사용자 §J #5)', () => {
  it('setLastGoodValue + getLastGoodValue — fresh (≤30s) → HIGH', () => {
    const t = new Date('2026-05-13T10:00:00Z');
    setLastGoodValue({ symbol: '005930', value: 75000, receivedAt: t });
    const entry = getLastGoodValue({ symbol: '005930', now: new Date(t.getTime() + 10_000) });
    expect(entry).not.toBeNull();
    expect(entry!.confidence).toBe('HIGH');
    expect(entry!.value).toBe(75000);
    expect(entry!.staleAgeSec).toBe(10);
  });

  it('30~180s → STALE', () => {
    const t = new Date('2026-05-13T10:00:00Z');
    setLastGoodValue({ symbol: '005930', value: 75000, receivedAt: t });
    const entry = getLastGoodValue({ symbol: '005930', now: new Date(t.getTime() + 60_000) });
    expect(entry!.confidence).toBe('STALE');
  });

  it('>180s → MISSING', () => {
    const t = new Date('2026-05-13T10:00:00Z');
    setLastGoodValue({ symbol: '005930', value: 75000, receivedAt: t });
    const entry = getLastGoodValue({ symbol: '005930', now: new Date(t.getTime() + 200_000) });
    expect(entry!.confidence).toBe('MISSING');
  });

  it('providerDegraded=true — fresh 시 HIGH → DEGRADED 격하', () => {
    const t = new Date('2026-05-13T10:00:00Z');
    setLastGoodValue({ symbol: '005930', value: 75000, receivedAt: t });
    const entry = getLastGoodValue({
      symbol: '005930',
      now: new Date(t.getTime() + 10_000),
      providerDegraded: true,
    });
    expect(entry!.confidence).toBe('DEGRADED');
  });

  it('value ≤0 / NaN — silent skip (entry 영속 0)', () => {
    setLastGoodValue({ symbol: 'A', value: 0 });
    setLastGoodValue({ symbol: 'B', value: -10 });
    setLastGoodValue({ symbol: 'C', value: Number.NaN });
    setLastGoodValue({ symbol: 'D', value: Number.POSITIVE_INFINITY });
    expect(listLastGoodValueEntries().length).toBe(0);
  });

  it('ENV disabled — set/get 모두 no-op', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = 'true';
    setLastGoodValue({ symbol: '005930', value: 75000 });
    expect(listLastGoodValueEntries().length).toBe(0);
    expect(getLastGoodValue({ symbol: '005930' })).toBe(null);
  });

  it('symbol 미존재 — getLastGoodValue null 반환', () => {
    expect(getLastGoodValue({ symbol: 'NONEXISTENT' })).toBe(null);
  });

  it('literal invariant — providerIssue=false / marketSignal=true / executionImpact=NONE / shadowLearningAllowed=true', () => {
    setLastGoodValue({ symbol: '005930', value: 75000 });
    const entry = getLastGoodValue({ symbol: '005930' });
    expect(entry!.providerIssue).toBe(false);
    expect(entry!.marketSignal).toBe(true);
    expect(entry!.executionImpact).toBe('NONE');
    expect(entry!.shadowLearningAllowed).toBe(true);
    expect(entry!.provider).toBe('KIS_REALDATA');
  });
});

/* ────────────────────────── Group E: Fallback router (7) ───────────────────── */

describe('Group E — selectFallbackProvider (사용자 §J #4 우선순위)', () => {
  it('KIS quote 정상 → KIS_QUOTE (HIGH)', () => {
    const dec = selectFallbackProvider({ kisQuoteAvailable: true });
    expect(dec.selectedFallback).toBe('KIS_QUOTE');
    expect(dec.confidence).toBe('HIGH');
    expect(dec.marketSignalAllowed).toBe(true);
  });

  it('KIS quote 불가 + cached value 가용 → KIS_CACHED (cachedConfidence 반영)', () => {
    const dec = selectFallbackProvider({
      kisQuoteAvailable: false,
      cachedValueAvailable: true,
      cachedConfidence: 'DEGRADED',
    });
    expect(dec.selectedFallback).toBe('KIS_CACHED');
    expect(dec.confidence).toBe('DEGRADED');
  });

  it('KIS quote + cache 불가 + KRX 가용 → KRX (DEGRADED)', () => {
    const dec = selectFallbackProvider({ krxAvailable: true });
    expect(dec.selectedFallback).toBe('KRX');
    expect(dec.confidence).toBe('DEGRADED');
  });

  it('KRX 불가 + Yahoo 가용 → YAHOO (DEGRADED)', () => {
    const dec = selectFallbackProvider({ yahooAvailable: true });
    expect(dec.selectedFallback).toBe('YAHOO');
    expect(dec.confidence).toBe('DEGRADED');
  });

  it('모든 fallback 실패 → CONFIDENCE_LOW + marketSignalAllowed=false', () => {
    const dec = selectFallbackProvider({});
    expect(dec.selectedFallback).toBe('CONFIDENCE_LOW');
    expect(dec.confidence).toBe('LOW');
    expect(dec.marketSignalAllowed).toBe(false);
  });

  it('우선순위 invariant — KIS_QUOTE > KIS_CACHED > KRX > YAHOO', () => {
    const dec = selectFallbackProvider({
      kisQuoteAvailable: true,
      cachedValueAvailable: true,
      cachedConfidence: 'HIGH',
      krxAvailable: true,
      yahooAvailable: true,
    });
    expect(dec.selectedFallback).toBe('KIS_QUOTE');
  });

  it('ENV disabled — selectedFallback=NONE + marketSignalAllowed=false', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = 'true';
    const dec = selectFallbackProvider({ kisQuoteAvailable: true });
    expect(dec.selectedFallback).toBe('NONE');
    expect(dec.confidence).toBe('MISSING');
    expect(dec.marketSignalAllowed).toBe(false);
  });
});

/* ────────────────────────── Group F: InvestorFlow override (7) ─────────────── */

describe('Group F — applyInvestorFlowProviderIssueOverride (사용자 §J #9)', () => {
  it('providerIssue=false → 원본 signal 그대로 (overrideApplied=false)', () => {
    const r = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'BULLISH',
      providerIssue: false,
    });
    expect(r.resolvedSignal).toBe('BULLISH');
    expect(r.overrideApplied).toBe(false);
    expect(r.marketSignal).toBe(true);
  });

  it('providerIssue=true + BULLISH → UNKNOWN', () => {
    const r = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'BULLISH',
      providerIssue: true,
    });
    expect(r.resolvedSignal).toBe('UNKNOWN');
    expect(r.overrideApplied).toBe(true);
    expect(r.marketSignal).toBe(false);
  });

  it('providerIssue=true + BEARISH → UNKNOWN', () => {
    const r = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'BEARISH',
      providerIssue: true,
    });
    expect(r.resolvedSignal).toBe('UNKNOWN');
    expect(r.overrideApplied).toBe(true);
  });

  it('providerIssue=true + WEAK_BULLISH / WEAK_BEARISH → UNKNOWN', () => {
    const r1 = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'WEAK_BULLISH',
      providerIssue: true,
    });
    const r2 = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'WEAK_BEARISH',
      providerIssue: true,
    });
    expect(r1.resolvedSignal).toBe('UNKNOWN');
    expect(r2.resolvedSignal).toBe('UNKNOWN');
  });

  it('providerIssue=true + NEUTRAL → NEUTRAL 보존 (overrideApplied=false)', () => {
    const r = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'NEUTRAL',
      providerIssue: true,
    });
    expect(r.resolvedSignal).toBe('NEUTRAL');
    expect(r.overrideApplied).toBe(false);
  });

  it('providerIssue=true + UNKNOWN → UNKNOWN 보존', () => {
    const r = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'UNKNOWN',
      providerIssue: true,
    });
    expect(r.resolvedSignal).toBe('UNKNOWN');
    expect(r.overrideApplied).toBe(false);
  });

  it('ENV disabled — 항상 원본 signal 그대로', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = 'true';
    const r = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'BULLISH',
      providerIssue: true,
    });
    expect(r.resolvedSignal).toBe('BULLISH');
    expect(r.overrideApplied).toBe(false);
  });
});

/* ────────────────────────── Group G: Shadow case recording (5) ──────────── */

describe('Group G — recordShadowCaseForKis500 (사용자 §J #8)', () => {
  it('record 생성 + FIFO 누적 + literal type 강제', () => {
    const r = recordShadowCaseForKis500({
      symbol: '005930',
      endpoint: '/uapi/x',
      errorKind: 'TRANSIENT_SERVER_500',
      httpStatus: 500,
      providerHealth: 'DEGRADED',
      fallbackUsed: true,
      fallbackProvider: 'KRX',
      confidenceLevel: 'DEGRADED',
    });
    expect(r.learningTag).toBe('CASE_KIS_REALDATA_500');
    expect(r.providerIssue).toBe(true);
    expect(r.marketSignal).toBe(false);
    expect(r.executionImpact).toBe('NONE');
    expect(r.shadowLearningAllowed).toBe(true);
    expect(listShadowCaseRecords().length).toBe(1);
  });

  it('FIFO trim — max 초과 시 가장 오래된 항목 제거', () => {
    __setShadowCasesMaxForTests(3);
    for (let i = 0; i < 5; i += 1) {
      recordShadowCaseForKis500({
        endpoint: `/x${i}`,
        errorKind: 'TRANSIENT_SERVER_500',
        providerHealth: 'DEGRADED',
        fallbackUsed: false,
        fallbackProvider: 'NONE',
        confidenceLevel: 'LOW',
      });
    }
    const records = listShadowCaseRecords();
    expect(records.length).toBe(3);
    expect(records[0]!.endpoint).toBe('/x2'); // /x0, /x1 trim
  });

  it('console.info SHADOW_CASE_RECORDED 패턴 발화', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    recordShadowCaseForKis500({
      endpoint: '/x',
      errorKind: 'TRANSIENT_SERVER_500',
      providerHealth: 'DEGRADED',
      fallbackUsed: false,
      fallbackProvider: 'NONE',
      confidenceLevel: 'LOW',
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[SHADOW_CASE_RECORDED] learningTag=CASE_KIS_REALDATA_500'),
    );
  });

  it('ENV disabled — record 반환 되지만 영속 buffer 0 + console.info 0', () => {
    process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED = 'true';
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const r = recordShadowCaseForKis500({
      endpoint: '/x',
      errorKind: 'TRANSIENT_SERVER_500',
      providerHealth: 'DEGRADED',
      fallbackUsed: false,
      fallbackProvider: 'NONE',
      confidenceLevel: 'LOW',
    });
    expect(r.providerIssue).toBe(true); // schema 보존
    expect(listShadowCaseRecords().length).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('optional fields (symbol/httpStatus) 안전 처리', () => {
    const r = recordShadowCaseForKis500({
      endpoint: '/x',
      errorKind: 'NETWORK_TIMEOUT',
      providerHealth: 'DEGRADED',
      fallbackUsed: true,
      fallbackProvider: 'KRX',
      confidenceLevel: 'DEGRADED',
    });
    expect(r.symbol).toBeUndefined();
    expect(r.httpStatus).toBeUndefined();
  });
});

/* ────────────────────────── Group H: Runtime summary formatter (4) ────────── */

describe('Group H — formatProviderHealthIsolationSection (사용자 §J #7)', () => {
  it('CLOSED + 빈 cache + 빈 cases — null 반환 (잡음 차단)', () => {
    expect(formatProviderHealthIsolationSection()).toBe(null);
  });

  it('OPEN 상태 — section 노출 + PATCH-RUNTIME 태그 + literal invariants 명시', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date('2026-05-13T10:00:00Z');
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 5_000));
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    const section = formatProviderHealthIsolationSection();
    expect(section).not.toBe(null);
    expect(section).toContain('🔌 KIS RealData Provider Health Isolation [PATCH-RUNTIME]');
    expect(section).toContain('Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003');
    expect(section).toContain('circuit: OPEN');
    expect(section).toContain('providerIssue=true');
    expect(section).toContain('marketSignal=false');
    expect(section).toContain('executionImpact=NONE');
    expect(section).toContain('telegramAllowed=false');
    expect(section).toContain('engineModeImpact=NONE');
    expect(section).toContain('shadowLearningAllowed=true');
  });

  it('LastGoodValue 만 있어도 section 노출', () => {
    setLastGoodValue({ symbol: '005930', value: 75000 });
    const section = formatProviderHealthIsolationSection();
    expect(section).not.toBe(null);
    expect(section).toContain('lastGoodValues: 1');
  });

  it('Shadow cases 만 있어도 section 노출', () => {
    recordShadowCaseForKis500({
      endpoint: '/x',
      errorKind: 'TRANSIENT_SERVER_500',
      providerHealth: 'DEGRADED',
      fallbackUsed: false,
      fallbackProvider: 'NONE',
      confidenceLevel: 'LOW',
    });
    const section = formatProviderHealthIsolationSection();
    expect(section).not.toBe(null);
    expect(section).toContain('shadowCases: 1');
  });
});

/* ────────────────────────── Group I: 사용자 §10 mandatory 10 tests ─────────── */

describe('Group I — 사용자 §10 mandatory 10 tests', () => {
  it('Test 1: KIS RealData 500 발생 시 Trading Engine 종료 안 됨 (snapshot read-only)', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    recordProviderFailure(cls);
    recordProviderFailure(cls);
    recordProviderFailure(cls);
    const snap = getProviderCircuitSnapshot();
    // engine mode impact 가 NONE 인 한 trading engine 은 멈추지 않음.
    expect(snap.engineModeImpact).toBe('NONE');
    expect(snap.executionImpact).toBe('NONE');
  });

  it('Test 2: providerIssue=true / marketSignal=false / executionImpact=NONE', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    expect(cls.providerIssue).toBe(true);
    expect(cls.marketSignal).toBe(false);
    expect(cls.executionImpact).toBe('NONE');
  });

  it('Test 3: 60s 내 3회 500 발생 → circuit breaker OPEN', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date();
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    const snap = recordProviderFailure(cls, new Date(t.getTime() + 30_000));
    expect(snap.state).toBe('OPEN');
  });

  it('Test 4: OPEN 상태 — shouldSkipProviderCall=true, fallback 사용', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    const t = new Date();
    recordProviderFailure(cls, t);
    recordProviderFailure(cls, new Date(t.getTime() + 5_000));
    recordProviderFailure(cls, new Date(t.getTime() + 10_000));
    expect(shouldSkipProviderCall(new Date(t.getTime() + 15_000))).toBe(true);
    const fallback = selectFallbackProvider({ krxAvailable: true });
    expect(fallback.selectedFallback).toBe('KRX');
  });

  it('Test 5: Last Good Value TTL 내 → DEGRADED confidence 사용 가능', () => {
    const t = new Date();
    setLastGoodValue({ symbol: '005930', value: 75000, receivedAt: t });
    const entry = getLastGoodValue({
      symbol: '005930',
      now: new Date(t.getTime() + 10_000),
      providerDegraded: true,
    });
    expect(entry!.confidence).toBe('DEGRADED');
  });

  it('Test 6: KIS500 단독 → SELL_ONLY / SHADOW_ONLY 전환 0 (engineModeImpact=NONE)', () => {
    const cls = classifyKisRealDataError({ endpoint: '/x', httpStatus: 500 });
    for (let i = 0; i < 10; i += 1) recordProviderFailure(cls);
    const snap = getProviderCircuitSnapshot();
    expect(snap.engineModeImpact).toBe('NONE'); // 다른 provider 까지 실패해야 단계적 하향
  });

  it('Test 7: telegramAllowed=false (Patch-003 Telegram 발송 영구 금지)', () => {
    const summary = buildProviderHealthIsolationRuntimeSummary();
    expect(summary.telegramAllowed).toBe(false);
  });

  it('Test 8: KIS500 → Shadow case 기록 + shadowLearningAllowed=true', () => {
    recordShadowCaseForKis500({
      endpoint: '/x',
      errorKind: 'TRANSIENT_SERVER_500',
      providerHealth: 'DEGRADED',
      fallbackUsed: true,
      fallbackProvider: 'KRX',
      confidenceLevel: 'DEGRADED',
    });
    expect(listShadowCaseRecords().length).toBe(1);
    expect(listShadowCaseRecords()[0]!.shadowLearningAllowed).toBe(true);
  });

  it('Test 9: providerIssue=true → BULLISH/BEARISH → NEUTRAL/UNKNOWN', () => {
    const r1 = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'BULLISH',
      providerIssue: true,
    });
    const r2 = applyInvestorFlowProviderIssueOverride({
      originalSignal: 'BEARISH',
      providerIssue: true,
    });
    expect(r1.resolvedSignal).toBe('UNKNOWN');
    expect(r2.resolvedSignal).toBe('UNKNOWN');
    expect(r1.marketSignal).toBe(false);
    expect(r2.marketSignal).toBe(false);
  });

  it('Test 10: 모든 provider 실패 시에만 engineModeImpact 단계적 하향 (현재 단계는 NONE 보존)', () => {
    // 본 SSOT 는 KIS RealData 단독만 다룸. engineMode 하향은 호출자(상위 layer)가 결정.
    // 다만 본 SSOT 가 engineModeImpact='NONE' literal 만 노출 — 호출자 측 단독 하향 금지 신호.
    const snap = getProviderCircuitSnapshot();
    expect(snap.engineModeImpact).toBe('NONE');
  });
});

/* ────────────────────────── Group J: 정적 grep 안전 invariants (12) ─────────── */

describe('Group J — 정적 grep 안전 invariants', () => {
  const SSOT_PATH = resolve(__dirname, 'providerHealthIsolationPatch003.ts');
  const HTTP_PATH = resolve(__dirname, 'http.ts');
  const SCAN_BLOCKERS_PATH = resolve(
    __dirname,
    '..',
    '..',
    'telegram',
    'commands',
    'system',
    'scanBlockers.cmd.ts',
  );

  it('SSOT: KIS 주문 함수 5종 import 0건', () => {
    const src = stripComments(readFileSync(SSOT_PATH, 'utf-8'));
    for (const fn of [
      'placeKisMarketOrder',
      'placeKisSellOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
      'cancelKisOrder',
    ]) {
      expect(src).not.toContain(fn);
    }
  });

  it('SSOT: autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = stripComments(readFileSync(SSOT_PATH, 'utf-8'));
    for (const sym of ['autoTradeEngine', 'orderExecutor', 'trancheExecutor']) {
      expect(src).not.toContain(sym);
    }
  });

  it('SSOT: 외부 fetch / axios / node-fetch 0건', () => {
    const src = stripComments(readFileSync(SSOT_PATH, 'utf-8'));
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    // fetch( 직접 호출 0건 (전체 SSOT — 외부 API 호출 영구 금지)
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('SSOT: ADR-0157 정확 비교 패턴 사용', () => {
    const src = readFileSync(SSOT_PATH, 'utf-8');
    expect(src).toMatch(/===\s*'true'/);
  });

  it('SSOT: literal type 강제 패턴 (providerIssue: true / false, marketSignal: true / false, executionImpact: \'NONE\')', () => {
    const src = readFileSync(SSOT_PATH, 'utf-8');
    expect(src).toContain("providerIssue: true");
    expect(src).toContain("marketSignal: false");
    expect(src).toContain("executionImpact: 'NONE'");
    expect(src).toContain("shadowLearningAllowed: true");
    expect(src).toContain("engineModeImpact: EngineModeImpact");
    expect(src).toContain("learningTag: 'CASE_KIS_REALDATA_500'");
  });

  it('SSOT: setGateThreshold / GATE_RELAX / STRONG_BUY_OVERRIDE 0건 (매매 정책 변경 금지)', () => {
    const src = stripComments(readFileSync(SSOT_PATH, 'utf-8'));
    for (const sym of ['setGateThreshold', 'GATE_RELAX', 'STRONG_BUY_OVERRIDE', 'requiredScore']) {
      expect(src).not.toContain(sym);
    }
  });

  it('http.ts wiring — recordProviderFailure / recordProviderSuccess / shouldSkipProviderCall 호출', () => {
    const src = stripComments(readFileSync(HTTP_PATH, 'utf-8'));
    expect(src).toContain('recordProviderFailure');
    expect(src).toContain('recordProviderSuccess');
    expect(src).toContain('shouldSkipProviderCall');
    expect(src).toContain('evaluateCircuitTransition');
  });

  it('http.ts: Patch-003 추적 주석 명시', () => {
    const src = readFileSync(HTTP_PATH, 'utf-8');
    expect(src).toContain('Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003');
  });

  it('scanBlockers.cmd.ts wiring — formatProviderHealthIsolationSection import + parts.push', () => {
    const src = readFileSync(SCAN_BLOCKERS_PATH, 'utf-8');
    expect(src).toContain('formatProviderHealthIsolationSection');
    expect(src).toContain('Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003');
    // try/catch 격리 — 분류 throw 가 base 메시지 차단 절대 금지
    expect(src).toMatch(
      /try\s*\{[\s\S]{0,500}formatProviderHealthIsolationSection[\s\S]{0,500}\}\s*catch/,
    );
  });

  it('SSOT: ADR-0157 ENV 정확 비교 의무 + ENV 명칭 SSOT', () => {
    const src = readFileSync(SSOT_PATH, 'utf-8');
    expect(src).toContain("KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED");
    expect(src).toContain("=== 'true'");
  });

  it('SSOT: KIS_CIRCUIT_OPEN / KIS_CIRCUIT_CLOSED / KIS_CIRCUIT_HALF_OPEN 사용자 §J 정확 형식', () => {
    const src = readFileSync(SSOT_PATH, 'utf-8');
    expect(src).toContain('[KIS_CIRCUIT_OPEN]');
    expect(src).toContain('[KIS_CIRCUIT_CLOSED]');
    expect(src).toContain('[KIS_CIRCUIT_HALF_OPEN]');
    expect(src).toContain('[SHADOW_CASE_RECORDED]');
  });

  it('SSOT: emergencyStop / SELL_ONLY / SHADOW_ONLY 자동 전환 0건', () => {
    const src = stripComments(readFileSync(SSOT_PATH, 'utf-8'));
    expect(src).not.toContain('setEmergencyStop');
    expect(src).not.toContain('setSellOnlyMode');
    expect(src).not.toContain('setShadowOnlyMode');
    expect(src).not.toContain('forceSellOnly');
  });
});
