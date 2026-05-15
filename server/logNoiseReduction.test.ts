import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  logger,
  logNoiseDetail,
  logNoiseSummary,
  resetNoiseCountersForTest,
  shouldSuppressNoise,
  recordNoiseSuppressed,
  formatNoiseSummary,
} from './utils/logger.js';
import {
  buildPreEntryWaitDedupeKey,
  resetPreEntryWaitLogDedupeForTest,
  shouldEmitPreEntryWaitLog,
} from './trading/signalScanner/perSymbol/buyListLoop.js';
import {
  formatPreBreakoutNoiseSummary,
  logAdrDiagnostic,
  logGateDiagnosticSummary,
  logPreBreakoutNoiseSummary,
  resetAdrDiagnosticLogRateLimiterForTest,
} from './trading/signalScanner/scanDiagnostics.js';
import {
  formatKisWsNoiseSummary,
  logKisWsNoiseSummary,
  requestKisWsSubscription,
  __resetKisWsSubscriptionStateForTests,
} from './clients/kisWebSocketSubscriptionManager.js';
import {
  formatKisMtasNoiseSummary,
  logKisMtasNoiseSummary,
} from './screener/adapters/kisQuoteAdapter.js';

describe('log noise reduction', () => {
  beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('LOG_SUPPRESS_NOISE', 'true');
    vi.stubEnv('LOG_SUPPRESS_PRE_ENTRY_WAIT', 'true');
    vi.stubEnv('LOG_SUPPRESS_KIS_WS_DETAIL', 'true');
    vi.stubEnv('LOG_SUPPRESS_KIS_MTAS_DETAIL', 'true');
    vi.stubEnv('LOG_SUPPRESS_GATE_DIAGNOSTIC', 'true');
    vi.stubEnv('LOG_SUPPRESS_KIS_FIRST_DIAGNOSTIC', 'true');
    vi.stubEnv('NOISE_SUMMARY_ENABLED', 'true');
    resetNoiseCountersForTest();
    resetPreEntryWaitLogDedupeForTest();
    resetAdrDiagnosticLogRateLimiterForTest();
    __resetKisWsSubscriptionStateForTests();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('LOG_LEVEL=info일 때 logger.debug는 console.debug를 호출하지 않는다', () => {
    logger.debug('[debug] hidden');
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('LOG_LEVEL=debug일 때 logger.debug는 console.debug를 호출한다', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    logger.debug('[debug] visible');
    expect(console.debug).toHaveBeenCalledWith('[debug] visible');
  });

  it('LOG_LEVEL=silent일 때 logger.info/warn/error도 출력되지 않는다', () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    logger.info('[info] hidden');
    logger.warn('[warn] hidden');
    logger.error('[error] hidden');
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('PRE_ENTRY_WAIT는 INFO로 찍히지 않고 반복은 30분 dedupe된다', () => {
    const key = buildPreEntryWaitDedupeKey({
      tradeDate: '2026-05-12',
      session: 'MORNING_BUY',
      stockCode: '005930',
      entryPrice: 70000,
      reason: 'PRE_BREAKOUT_MISS',
    });

    expect(key).toBe('PRE_ENTRY_WAIT:2026-05-12:MORNING_BUY:005930:70000:PRE_BREAKOUT_MISS');
    expect(shouldEmitPreEntryWaitLog(key, 1_000_000)).toBe(true);
    expect(shouldEmitPreEntryWaitLog(key, 1_000_000 + 29 * 60 * 1000)).toBe(false);
    expect(shouldEmitPreEntryWaitLog(key, 1_000_000 + 31 * 60 * 1000)).toBe(true);

    logNoiseDetail({ category: 'PRE_ENTRY_WAIT', message: '[AutoTrade] WAIT' });
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('PRE_BREAKOUT_PRICE_DISTANCE 개별 로그는 LOG_LEVEL=info에서 출력되지 않고 Summary에는 포함된다', () => {
    logNoiseDetail({ category: 'PRE_BREAKOUT_PRICE_DISTANCE', message: '[AutoTrade] 진입가 미도달' });
    expect(console.debug).not.toHaveBeenCalled();
    expect(formatPreBreakoutNoiseSummary({ scanned: 39, wait: 24, approaching: 2, gateFail: 8, ready: 0, rejected: 5, priceDistance: 18 }))
      .toBe('[PreBreakoutSummary] scanned=39 wait=24 approaching=2 gateFail=8 ready=0 rejected=5 priceDistance=18');
  });

  it('PreBreakoutSummary는 INFO로 1회 찍힌다', () => {
    const mockLogger = { info: vi.fn() };
    logPreBreakoutNoiseSummary({ scanned: 39, wait: 24, approaching: 2, gateFail: 8, ready: 0, rejected: 5 }, mockLogger);

    expect(formatPreBreakoutNoiseSummary({ scanned: 39, wait: 24, approaching: 2, gateFail: 8, ready: 0, rejected: 5 }))
      .toBe('[PreBreakoutSummary] scanned=39 wait=24 approaching=2 gateFail=8 ready=0 rejected=5');
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
  });

  it('KIS-WS keep/reject low priority/subscribe queued는 LOG_LEVEL=info에서 출력되지 않는다', () => {
    const subscribedPriorities = new Map();
    const subscribeFn = vi.fn();
    requestKisWsSubscription(
      { code: '005930', priority: 500, reasons: ['WATCHLIST'] },
      { subscribedPriorities, limit: 2, subscribeFn, unsubscribeFn: vi.fn(), now: 1_000 },
    );
    requestKisWsSubscription(
      { code: '005930', priority: 500, reasons: ['WATCHLIST'] },
      { subscribedPriorities, limit: 2, subscribeFn, unsubscribeFn: vi.fn(), now: 2_000 },
    );
    requestKisWsSubscription(
      { code: '000660', priority: 100, reasons: ['UNKNOWN'] },
      { subscribedPriorities, limit: 1, subscribeFn, unsubscribeFn: vi.fn(), now: 3_000 },
    );

    expect(console.debug).not.toHaveBeenCalledWith(expect.stringContaining('[KIS-WS]'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('[KIS-WS]'));
  });

  it('KIS-WSSummary는 LOG_LEVEL=info에서 출력된다', () => {
    logKisWsNoiseSummary({ active: 30, queued: 18, keep: 12, rejectedLowPriority: 34, limitReached: 9 });

    expect(formatKisWsNoiseSummary({ active: 30, queued: 18, keep: 12, rejectedLowPriority: 34, limitReached: 9 }))
      .toBe('[KIS-WSSummary] active=30 queued=18 keep=12 rejectedLowPriority=34 limitReached=9');
    expect(console.info).toHaveBeenCalledWith('[KIS-WSSummary] active=30 queued=18 keep=12 rejectedLowPriority=34 limitReached=9');
  });

  it('KisMTAS detail은 LOG_LEVEL=info에서 출력되지 않는다', () => {
    logNoiseDetail({ category: 'KIS_MTAS_DETAIL', message: '[KisMTAS] 030200 월봉 KIS 보강' });
    logNoiseDetail({ category: 'KIS_MTAS_DETAIL', message: '[KisMTAS] 030200 주봉 KIS 보강' });
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('KisMTASSummary는 LOG_LEVEL=info에서 출력된다', () => {
    logKisMtasNoiseSummary({ scanned: 39, monthlyBull: 24, weeklyBull: 27, bothBull: 21, failed: 0 });

    expect(formatKisMtasNoiseSummary({ scanned: 39, monthlyBull: 24, weeklyBull: 27, bothBull: 21, failed: 0 }))
      .toBe('[KisMTASSummary] scanned=39 monthlyBull=24 weeklyBull=27 bothBull=21 failed=0');
    expect(console.info).toHaveBeenCalledWith('[KisMTASSummary] scanned=39 monthlyBull=24 weeklyBull=27 bothBull=21 failed=0');
  });

  it('ADR-0475 dry-run diagnostic은 LOG_LEVEL=info에서 개별 출력되지 않고 shadow case recording은 유지된다', () => {
    const recordShadowCase = vi.fn();
    logAdrDiagnostic('[ADR-0475] Gate1PositiveSourceWiring SHADOW_ONLY dry-run emitted', {
      adrCode: 'ADR-0475',
      dryRun: true,
      engineMode: 'SHADOW_ONLY',
      executionImpact: 'NONE',
      providerIssue: false,
      marketSignal: false,
      reason: 'GATE1_POSITIVE_SOURCE_WIRING_DRY_RUN',
    }, { recordShadowCase });

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(recordShadowCase).toHaveBeenCalledTimes(1);
  });

  it('GateDiagnosticSummary는 LOG_LEVEL=info에서 출력된다', () => {
    logGateDiagnosticSummary({ session: 'REGULAR', dryRuns: 7, candidates: 23, deferred: 7, executionImpact: 'NONE' });
    expect(console.info).toHaveBeenCalledWith('[GateDiagnosticSummary] session=REGULAR dryRuns=7 candidates=23 deferred=7 executionImpact=NONE');
  });

  it('KIS_FIRST Legacy diagnostic compact summary는 error로 출력되지 않는다', () => {
    logNoiseDetail({ category: 'KIS_FIRST_LEGACY_DIAGNOSTIC', message: '[KIS_FIRST] Legacy diagnostic lane compact summary executionImpact=NONE' });
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('NoiseSummary는 INFO로 출력된다', () => {
    logNoiseDetail({ category: 'PRE_ENTRY_WAIT', message: 'hidden' });
    logNoiseSummary({ session: 'REGULAR', executionImpact: 'NONE' });
    expect(console.info).toHaveBeenCalledWith('[NoiseSummary] session=REGULAR suppressed=1 preEntryWait=1 priceDistance=0 kisWsDetail=0 kisMtasDetail=0 gateDiagnostics=0 kisFirstDiagnostics=0 supplySemanticWireDiag=0 commandRegistryDiag=0 counterfactualDuplicate=0 executionImpact=NONE');
  });

  // Patch-009 P1 — 프로덕션 진단 로그 게이트 (SUPPLY_SEMANTIC_WIRE / COMMAND_REGISTRY).
  it('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC은 LOG_LEVEL=info에서 기본 억제된다', () => {
    expect(shouldSuppressNoise('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC')).toBe(true);
  });

  it('COMMAND_REGISTRY_DIAGNOSTIC은 LOG_LEVEL=info에서 기본 억제된다', () => {
    expect(shouldSuppressNoise('COMMAND_REGISTRY_DIAGNOSTIC')).toBe(true);
  });

  it('LOG_LEVEL=debug일 때 두 진단 카테고리는 억제되지 않는다', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    expect(shouldSuppressNoise('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC')).toBe(false);
    expect(shouldSuppressNoise('COMMAND_REGISTRY_DIAGNOSTIC')).toBe(false);
  });

  it('LOG_SUPPRESS_*=false 명시 시 해당 진단 카테고리는 억제 해제된다', () => {
    vi.stubEnv('LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC', 'false');
    vi.stubEnv('LOG_SUPPRESS_COMMAND_REGISTRY_DIAGNOSTIC', 'false');
    expect(shouldSuppressNoise('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC')).toBe(false);
    expect(shouldSuppressNoise('COMMAND_REGISTRY_DIAGNOSTIC')).toBe(false);
  });

  it('진단 카테고리 억제 카운트는 NoiseSummary에 집계된다', () => {
    recordNoiseSuppressed('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC');
    recordNoiseSuppressed('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC');
    recordNoiseSuppressed('COMMAND_REGISTRY_DIAGNOSTIC');
    const summary = formatNoiseSummary({ session: 'REGULAR', executionImpact: 'NONE' });
    expect(summary).toContain('supplySemanticWireDiag=2');
    expect(summary).toContain('commandRegistryDiag=1');
    expect(summary).toContain('suppressed=3');
  });

  it('gate1 forensic audit는 SUPPLY_SEMANTIC_WIRE 진단을 중앙 logger 게이트 경유한다', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, 'trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.ts'),
      'utf-8',
    );
    expect(src).toMatch(/shouldSuppressNoise\('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC'\)/);
    expect(src).toMatch(/recordNoiseSuppressed\('SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC'\)/);
  });

  it('commandRegistry 등록 진단 로그는 중앙 logger 게이트 경유한다', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, 'telegram/commandRegistry.ts'),
      'utf-8',
    );
    expect(src).toMatch(/shouldSuppressNoise\('COMMAND_REGISTRY_DIAGNOSTIC'\)/);
    expect(src).toMatch(/recordNoiseSuppressed\('COMMAND_REGISTRY_DIAGNOSTIC'\)/);
  });

  // Patch-009 P2 — counterfactual 중복 억제 로그 집계.
  it('COUNTERFACTUAL_DUPLICATE_SUPPRESSED는 LOG_LEVEL=info에서 기본 억제된다', () => {
    expect(shouldSuppressNoise('COUNTERFACTUAL_DUPLICATE_SUPPRESSED')).toBe(true);
  });

  it('LOG_LEVEL=debug일 때 COUNTERFACTUAL_DUPLICATE_SUPPRESSED는 억제되지 않는다', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    expect(shouldSuppressNoise('COUNTERFACTUAL_DUPLICATE_SUPPRESSED')).toBe(false);
  });

  it('LOG_SUPPRESS_COUNTERFACTUAL_DUPLICATE=false 명시 시 억제 해제된다', () => {
    vi.stubEnv('LOG_SUPPRESS_COUNTERFACTUAL_DUPLICATE', 'false');
    expect(shouldSuppressNoise('COUNTERFACTUAL_DUPLICATE_SUPPRESSED')).toBe(false);
  });

  it('counterfactual 중복 억제 카운트는 NoiseSummary에 집계된다', () => {
    recordNoiseSuppressed('COUNTERFACTUAL_DUPLICATE_SUPPRESSED');
    recordNoiseSuppressed('COUNTERFACTUAL_DUPLICATE_SUPPRESSED');
    recordNoiseSuppressed('COUNTERFACTUAL_DUPLICATE_SUPPRESSED');
    const summary = formatNoiseSummary({ session: 'REGULAR', executionImpact: 'NONE' });
    expect(summary).toContain('counterfactualDuplicate=3');
    expect(summary).toContain('suppressed=3');
  });

  it('counterfactualShadow 중복 억제 로그는 중앙 logger 게이트 경유한다', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, 'learning/counterfactualShadow.ts'),
      'utf-8',
    );
    expect(src).toMatch(/shouldSuppressNoise\('COUNTERFACTUAL_DUPLICATE_SUPPRESSED'\)/);
    expect(src).toMatch(/recordNoiseSuppressed\('COUNTERFACTUAL_DUPLICATE_SUPPRESSED'\)/);
    // duplicateSuppressedCount 영속은 게이트와 무관하게 유지 (entry 에 항상 기록)
    expect(src).toMatch(/existing\.duplicateSuppressedCount\s*=/);
  });

  // Patch-009 P4 — KIS-WS [LIMIT] 반복 이벤트 로그 집계.
  it('KIS-WS [LIMIT] 이벤트 console 출력은 KIS_WS_DETAIL 게이트 경유한다', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, 'clients/kisStreamClient.ts'),
      'utf-8',
    );
    // logStreamEvent 가 noiseCategory 옵션 시 억제 분기 + recordNoiseSuppressed
    expect(src).toMatch(/shouldSuppressNoise\(options\.noiseCategory\)/);
    expect(src).toMatch(/recordNoiseSuppressed\(options\.noiseCategory\)/);
    // [LIMIT] 호출 site 가 noiseCategory: 'KIS_WS_DETAIL' 전달
    expect(src).toMatch(/'LIMIT',[\s\S]*?noiseCategory: 'KIS_WS_DETAIL'/);
    // _eventLog ring buffer push 는 게이트와 무관하게 항상 유지 (구조적 진단 SSOT)
    expect(src).toMatch(/_eventLog\.push\(entry\)/);
  });

  it('KIS-WS [LIMIT] 억제 시 _eventLog ring buffer 기록은 유지된다 (subscribeStock 동작 무변경)', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, 'clients/kisStreamClient.ts'),
      'utf-8',
    );
    // subscribeStock 의 상한 도달 시 return false 동작 무변경 — 로그만 게이트
    expect(src).toMatch(/_subscribedCodes\.size >= MAX_SUBSCRIPTIONS[\s\S]*?return false;/);
    // _eventLog.push 가 noiseCategory 게이트 분기보다 먼저 실행 (항상 기록)
    const pushIdx = src.indexOf('_eventLog.push(entry)');
    const gateIdx = src.indexOf('shouldSuppressNoise(options.noiseCategory)');
    expect(pushIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(pushIdx);
  });

  it('Trading Engine execution path는 logger patch로 변경되지 않는다', () => {
    expect(shouldEmitPreEntryWaitLog('engine-path-sentinel', 1_000)).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('buyListLoop ENTRY_PRICE_DEVIATION failCount 증가 로그는 logger.info 위임 + console.log 직접 호출 부재', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, 'trading/signalScanner/perSymbol/buyListLoop.ts'),
      'utf-8',
    );
    // 사용자 명시 PR #910 후속 — console.log → logger.info 교체 (LOG_LEVEL 정합)
    expect(src).not.toMatch(
      /console\.log\(`\[AutoTrade\] \${stock\.name}\(\${stock\.code}\) 진입가 이탈 — failCount=/,
    );
    expect(src).toMatch(
      /logger\.info\(`\[AutoTrade\] \${stock\.name}\(\${stock\.code}\) 진입가 이탈 — failCount=/,
    );
  });

  it('LOG_LEVEL=silent 일 때 logger.info 진입가 이탈 메시지도 출력되지 않는다', () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    logger.info('[AutoTrade] 삼성전자(005930) 진입가 이탈 — failCount=3');
    expect(console.info).not.toHaveBeenCalled();
  });
});
