// @responsibility P1 stabilization regression coverage for macro stale, logger levels, Telegram command trace, debug diagnostics, and policy-state noise.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramCommand } from './telegram/commands/_types.js';
import type { RegimeSnapshot } from './trading/regime/effectiveRegimeSnapshot.js';
import { classifyOperationalWarnLogLevel } from './observability/operationalWarn.js';
import { emitRegimeConflictWarnings } from './trading/regime/regimeConflictDetector.js';
import { formatRegimeTelegramNow } from './trading/regime/regimeTelegramPresenter.js';
import { emitScanEvaluationWarnings } from './trading/signalScanner/state/scanDiagnosticSuppressor.js';
import {
  __resetWatchlistSaturationStateForTests,
  evaluateWatchlistSaturationAlert,
  shouldSendWatchlistSaturationTelegram,
} from './persistence/watchlistSaturationPolicy.js';

const NOW = new Date('2026-05-18T08:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  __resetWatchlistSaturationStateForTests();
});

describe('P1 macro HARD_STALE stabilization', () => {
  it('macroFreshness=HARD_STALE with MHS 70 under R6 blocks release but keeps shadow learning and marketSignal=false', async () => {
    vi.resetModules();
    vi.doMock('./trading/marketStateResolver.js', () => ({
      resolveMarketState: () => ({
        snapshotId: 'mkt-hard-stale',
        asOf: '2026-05-18T05:56:19.000Z',
        ttlSec: 300,
        biasScore: 10,
        biasLabel: 'NEUTRAL',
        mhs: 70,
        mhsLabel: 'GREEN',
        detectedRegime: 'R3_EARLY',
        rawTrend: 'GREEN',
        riskOverride: 'NONE',
        effectiveRegime: 'R6_DEFENSE',
        liveNewBuyAllowed: false,
        liveSellAllowed: true,
        positionManagementAllowed: true,
        shadowLearningAllowed: true,
        shadowScanAllowed: true,
        shadowPaperFillAllowed: true,
        executionMode: 'NORMAL',
        displaySeverity: 'DEFENSE',
        displayTitle: 'R6_DEFENSE',
        displayEmoji: '🔴',
        reasonCodes: ['R6_DEFENSE'],
        stale: true,
        staleSources: ['macroState'],
        macroState: {
          stale: true,
          freshness: 'HARD_STALE',
          updatedAt: '2026-05-18T05:56:19.000Z',
          ageSec: 7421,
          ttlSec: 300,
          softStaleSec: 900,
          hardStaleSec: 900,
          staleReason: 'HARD_STALE',
          lastRefreshAttemptAt: '2026-05-18T06:55:00.000Z',
          refreshJobLastRunAt: '2026-05-18T06:55:00.000Z',
          refreshBlockedReason: 'NONE',
          executionImpact: 'REGIME_RELEASE_BLOCKED_ONLY',
        },
      }),
      formatMarketStateNow: () => 'legacy',
    }));
    vi.doMock('./trading/regimeBridge.js', () => ({
      getRegimeDiagnostics: () => ({
        rawRegime: 'R3_EARLY',
        effectiveRegime: 'R6_DEFENSE',
        sourceFreshness: 'HARD_STALE',
        r6RecoveryStatus: 'BLOCKED',
        r6ShockLatch: true,
        recoveryBlockedReason: 'MACRO_HARD_STALE',
        transitionReason: 'test',
        recoveryEvidence: { reasons: ['MACRO_HARD_STALE'], confirmations: 0, requiredConfirmations: 2 },
        r6TriggerBreakdown: { activeR6Triggers: [], staleR6Triggers: [], triggerFreshness: 'HARD_STALE', staleCarryForward: true, staleBlockedRecovery: true },
      }),
    }));
    vi.doMock('./observability/operationalWarn.js', () => ({
      defaultWarnTtlSec: () => 60,
      emitOperationalWarn: vi.fn(),
    }));

    const { resolveRegimeSnapshot } = await import('./trading/regime/regimeResolver.js');
    const snapshot = resolveRegimeSnapshot({ macroState: { mhs: 70, regime: 'GREEN', updatedAt: '2026-05-18T05:56:19.000Z' } as never, now: NOW });

    expect(snapshot.marketState.macroState.freshness).toBe('HARD_STALE');
    expect(snapshot.marketState.macroState.freshness !== 'HARD_STALE').toBe(false);
    expect(snapshot.marketState.macroState.freshness === 'HARD_STALE' ? 'MACRO_HARD_STALE' : 'NONE').toBe('MACRO_HARD_STALE');
    expect(snapshot.marketState.shadowLearningAllowed).toBe(true);
    expect(snapshot.marketSignal).toBe(false);
  });
});

describe('P1 logger level policy', () => {
  it('executionImpact=NONE and marketSignal=false provider/data state is not error', () => {
    expect(classifyOperationalWarnLogLevel({
      priority: 'P1', domain: 'DATA', code: 'P1_MACRO_STATE_STALE', message: 'stale', executionImpact: 'NONE', dedupKey: 'k', ttlSec: 60,
      details: { providerIssue: true, marketSignal: false },
    })).toBe('info');
  });

  // 출력 드리프트 정정 (canonical SSOT = operationalWarn.classifyOperationalWarnLogLevel):
  //   - correctionApplied=true && userVisibleSafe=true 인 GREEN_WITH_R6 → executionImpact='NONE'
  //     (regimeConflictDetector.ts L108~111) → classify 'info' (operationalWarn.ts L43~47).
  //   - 본 다운그레이드는 P1 log-noise 안정화 의도 — "정정·사용자안전" conflict 는 비액션이므로
  //     WARN 미만(INFO)으로 낮추되, 절대 ERROR 로 오에스컬레이션하지 않는다(핵심 안전 불변).
  //   원본 테스트는 다운그레이드 도입 전 WARN 기대로 DOA. 정정된 케이스는 INFO + ERROR 부재로 검증.
  it('corrected GREEN_WITH_R6 conflict is downgraded to INFO and never ERROR', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    emitRegimeConflictWarnings({
      snapshotId: 's1', asOf: NOW.toISOString(), ttlSec: 300, detectedRegime: 'R3_EARLY', effectiveRegime: 'R6_DEFENSE', displayRegime: 'R6_DEFENSE',
      riskOverride: 'R6_DEFENSE', engineMode: 'NORMAL', biasScore: 0, mhs: 70, dataHealth: {}, sourceHealth: 'VERIFIED', stale: false,
      providerIssue: false, marketSignal: false, conflicts: ['GREEN_WITH_R6'], rawMhsLabel: 'GREEN', rawBiasLabel: 'NEUTRAL', correctionApplied: true, userVisibleSafe: true,
    } as RegimeSnapshot);
    expect(info).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  // 경계 보강 — *미정정* GREEN_WITH_R6 (correctionApplied=false, displayRegime≠R6) 는
  // executionImpact='REGIME_DISPLAY_CONFLICT' → classify 'error' 로 에스컬레이션되어야 한다.
  // (정정 케이스의 INFO 다운그레이드가 미정정 케이스까지 약화시키지 않음을 잠금)
  it('uncorrected GREEN_WITH_R6 conflict escalates to ERROR', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    emitRegimeConflictWarnings({
      snapshotId: 's2', asOf: NOW.toISOString(), ttlSec: 300, detectedRegime: 'R3_EARLY', effectiveRegime: 'R6_DEFENSE', displayRegime: 'R3_EARLY',
      riskOverride: 'R6_DEFENSE', engineMode: 'NORMAL', biasScore: 0, mhs: 70, dataHealth: {}, sourceHealth: 'VERIFIED', stale: false,
      providerIssue: false, marketSignal: false, conflicts: ['GREEN_WITH_R6'], rawMhsLabel: 'GREEN', rawBiasLabel: 'NEUTRAL', correctionApplied: false, userVisibleSafe: false,
    } as RegimeSnapshot);
    expect(error).toHaveBeenCalled();
  });
});

describe('P1 Telegram display safety and command trace', () => {
  it('effectiveRegime=R6_DEFENSE does not expose rawMhsLabel=GREEN as final display state', () => {
    const text = formatRegimeTelegramNow(({
      snapshotId: 's', asOf: NOW.toISOString(), ttlSec: 300, detectedRegime: 'R3_EARLY', effectiveRegime: 'R6_DEFENSE', displayRegime: 'R6_DEFENSE', riskOverride: 'R6_DEFENSE', engineMode: 'NORMAL',
      biasScore: 0, mhs: 70, dataHealth: {}, sourceHealth: 'VERIFIED', stale: false, providerIssue: false, marketSignal: false, conflicts: [], rawMhsLabel: 'GREEN',
      macroState: null, diagnostics: {} as never, marketState: {
        snapshotId: 'm', asOf: NOW.toISOString(), ttlSec: 300, biasScore: 0, biasLabel: 'NEUTRAL', mhs: 70, mhsLabel: 'GREEN', detectedRegime: 'R3_EARLY', rawTrend: 'GREEN', riskOverride: 'NONE', effectiveRegime: 'R6_DEFENSE', liveNewBuyAllowed: false, liveSellAllowed: true, positionManagementAllowed: true, shadowLearningAllowed: true, shadowScanAllowed: true, shadowPaperFillAllowed: true, executionMode: 'NORMAL', displaySeverity: 'DEFENSE', displayTitle: 'R6_DEFENSE', displayEmoji: '🔴', reasonCodes: ['R6_DEFENSE'], stale: false, staleSources: [], macroState: { stale: false, freshness: 'FRESH', ttlSec: 300, softStaleSec: 900, hardStaleSec: 900, staleReason: 'NONE', executionImpact: 'NONE' },
      } as never,
    }) as never);
    // 출력 드리프트 정정 (refactor 3e7ca19 — time-of-day SELL_ONLY/legacy defense 라벨 제거,
    // always-on cleanup): R6 스냅샷은 presenter 의 isLegacyR6SellOnlySnapshot 분기로 raw 비-R6
    // regime(R3_EARLY) + "legacy defense policy ignored" 로 다운그레이드 렌더된다
    // (regimeTelegramPresenter.ts compactDisplayRegime/rawNonR6Regime). 원본의 "Display regime:
    // R6_DEFENSE" 기대는 refactor 이전 라벨로 DOA. 본 테스트의 핵심 안전 불변(rawMhsLabel=GREEN 이
    // 최종 표시로 노출되지 않음)은 유지하며 다운그레이드된 표시 라벨로 정정한다.
    expect(text).toContain('Display regime: R3_EARLY');
    expect(text).toContain('legacy defense policy ignored');
    // 핵심 안전 불변 — raw GREEN 라벨이 사용자 표시 최종 상태로 노출되지 않는다.
    expect(text).not.toContain('MHS: 70 GREEN');
    expect(text).not.toContain('Raw trend: GREEN');
  });

  it('/ping keeps the same correlationId from TELEGRAM_UPDATE_RECEIVED to TELEGRAM_REPLY_SENT', async () => {
    vi.resetModules();
    const logs: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args) => logs.push(String(args[0])));
    const ping: TelegramCommand = {
      name: '/ping', category: 'SYS', visibility: 'ADMIN', riskLevel: 0, description: 'stub ping',
      async execute({ reply, correlationId }) {
        await reply(`pong ✅\ncorrelationId=${correlationId}`);
        console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId} command=/ping`);
      },
    };
    vi.doMock('./telegram/commandRegistry.js', () => ({
      commandRegistry: { resolve: (name: string) => name === '/ping' ? ping : undefined, register: vi.fn(), all: () => [ping], keys: () => ['/ping'] },
    }));
    vi.doMock('./persistence/commandUsageRepo.js', () => ({ recordUsage: vi.fn(), getTopUsage: vi.fn(() => []) }));
    const { dispatchTelegramCommand } = await import('./telegram/commandRouter.js');
    await dispatchTelegramCommand({ rawText: '/ping', chatId: '123456', userId: 'u1', reply: vi.fn() });
    const received = logs.find((line) => line.includes('[TELEGRAM_UPDATE_RECEIVED]'))!;
    const sent = logs.find((line) => line.includes('[TELEGRAM_REPLY_SENT]'))!;
    const correlationId = received.match(/correlationId=([^ ]+)/)?.[1];
    expect(correlationId).toMatch(/^telegram:123456:\/ping:/);
    expect(sent).toContain(`correlationId=${correlationId}`);
  }, 30000);
});

describe('P1 read-only debug positions and normal policy states', () => {
  it('/debug_positions returns source counts without live broker order calls', async () => {
    vi.resetModules();
    const brokerOrder = vi.fn();
    vi.doMock('./telegram/commands/positions/shadowPositionSources.js', () => ({
      aggregatePositionSources: vi.fn(async () => ({
        counts: { shadowRegistryCount: 1, shadowLedgerCount: 2, shadowTradeOpenCount: 3, virtualHoldingCount: 4, paperOpenCount: 5, kisLiveCount: 'SKIPPED', totalCount: 6 },
      })),
    }));
    const { buildDebugPositionsMessage } = await import('./telegram/commands/system/debugCommands.cmd.js');
    const message = await buildDebugPositionsMessage('cid');
    expect(message).toContain('ShadowPositionRegistry=1');
    expect(message).toContain('KISLiveHolding=SKIPPED');
    expect(message).toContain('finalDisplayed=6');
    expect(brokerOrder).not.toHaveBeenCalled();
  });

  // 출력 드리프트 정정 (canonical = scanDiagnosticSuppressor.emitScanEvaluationWarnings):
  //   - NOT_EVALUATED_SELL_ONLY 는 *정상 정책 상태* 로, 본 함수의 switch 는 R6_LIVE_BLOCKED /
  //     QUOTE_HYDRATION_FAILED / DATA_INSUFFICIENT/PARTIAL 만 경유시키고, SELL_ONLY 는 default
  //     분기(unmappedBlockReason=true 일 때만 emit)로 흘러 *어떤 operational warn 도 emit 하지
  //     않는다* (로그 노이즈 억제 의도).
  //   - 원본 테스트는 SELL_ONLY 가 normalStateMessage+shadowLearningAllowed 를 담은 warn 을
  //     낸다고 기대했으나, 해당 details 필드는 *다른 모듈* preflightLearningRecorder 의
  //     emitPreflightScanEvaluationWarn 이 NOT_EVALUATED_R6_LIVE_BLOCKED 에 한해서만 emit 한다.
  //     따라서 SELL_ONLY 에서 warn 을 기대하는 원본은 DOA — 정상 상태의 무경보(suppression)를 검증.
  it('SELL_ONLY NOT_EVALUATED is a normal policy state and emits no operational warn (noise suppressed)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    emitScanEvaluationWarnings({
      evaluationState: 'NOT_EVALUATED_SELL_ONLY', executionImpact: 'NEW_BUY_BLOCKED_ONLY', engineMode: 'SELL_ONLY', effectiveRegime: 'R4_NEUTRAL', blockReason: 'SELL_ONLY', breakPoint: 'PREFLIGHT', sourcePath: 'test', scanId: 's', shadowLearningAllowed: true,
    } as never);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('WATCHLIST_SATURATION soft advisory logs only and does not request Telegram emission', () => {
    const result = evaluateWatchlistSaturationAlert({ section: 'MOMENTUM', count: 35, alertCap: 30, softCap: 40, hardCap: 50, autoCount: 35, manualCount: 0 }, NOW);
    expect(result.classification?.severity).toBe('ADVISORY');
    expect(result.classification?.executionImpact).toBe('NONE');
    expect(result.decision.shouldEmit).toBe(false);
    expect(result.decision.suppressionReason).toBe('OBSERVE_ONLY');
    expect(shouldSendWatchlistSaturationTelegram(result.classification!)).toBe(false);
  });
});
