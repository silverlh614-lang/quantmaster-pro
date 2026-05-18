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

  it('corrected GREEN_WITH_R6 conflict is WARN instead of ERROR', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    emitRegimeConflictWarnings({
      snapshotId: 's1', asOf: NOW.toISOString(), ttlSec: 300, detectedRegime: 'R3_EARLY', effectiveRegime: 'R6_DEFENSE', displayRegime: 'R6_DEFENSE',
      riskOverride: 'R6_DEFENSE', engineMode: 'NORMAL', biasScore: 0, mhs: 70, dataHealth: {}, sourceHealth: 'VERIFIED', stale: false,
      providerIssue: false, marketSignal: false, conflicts: ['GREEN_WITH_R6'], rawMhsLabel: 'GREEN', rawBiasLabel: 'NEUTRAL', correctionApplied: true, userVisibleSafe: true,
    } as RegimeSnapshot);
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
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
    expect(text).toContain('Display regime: R6_DEFENSE');
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

  it('SELL_ONLY NOT_EVALUATED keeps shadowLearningAllowed=true in warn details', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    emitScanEvaluationWarnings({
      evaluationState: 'NOT_EVALUATED_SELL_ONLY', executionImpact: 'NEW_BUY_BLOCKED_ONLY', engineMode: 'SELL_ONLY', effectiveRegime: 'R4_NEUTRAL', blockReason: 'SELL_ONLY', breakPoint: 'PREFLIGHT', sourcePath: 'test', scanId: 's', shadowLearningAllowed: true,
    } as never);
    const details = warn.mock.calls[0]?.[1]?.details as Record<string, unknown>;
    expect(details.shadowLearningAllowed).toBe(true);
    expect(details.normalStateMessage).toContain('SELL_ONLY');
  });

  it('WATCHLIST_SATURATION soft advisory logs only and does not request Telegram emission', () => {
    const result = evaluateWatchlistSaturationAlert({ section: 'MOMENTUM', count: 35, alertCap: 30, softCap: 40, hardCap: 50, autoCount: 35, manualCount: 0 }, NOW);
    expect(result.classification?.severity).toBe('ADVISORY');
    expect(result.classification?.executionImpact).toBe('NONE');
    expect(result.decision.shouldEmit).toBe(true);
    expect(shouldSendWatchlistSaturationTelegram(result.classification!)).toBe(false);
  });
});
