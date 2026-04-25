// @responsibility: diagnostics.ts 회귀 — deriveYahooStatus 6분기 + computeVerdict 12분기 + collectHealthSnapshot 통합.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  deriveYahooStatus,
  computeVerdict,
  collectHealthSnapshot,
  type HealthVerdict,
} from './diagnostics.js';
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics.js';
import type { YahooHealthSnapshot } from '../trading/marketDataRefresh.js';

// ── 외부 SSOT stub ──────────────────────────────────────────────────────────
import * as watchlistRepo from '../persistence/watchlistRepo.js';
import * as shadowRepo from '../persistence/shadowTradeRepo.js';
import * as state from '../state.js';
import * as kisClient from '../clients/kisClient.js';
import * as kisStream from '../clients/kisStreamClient.js';
import * as gemini from '../clients/geminiClient.js';
import * as marketRefresh from '../trading/marketDataRefresh.js';
import * as scheduler from '../orchestrator/adaptiveScanScheduler.js';
import * as scanner from '../trading/signalScanner.js';
import * as paths from '../persistence/paths.js';
import * as krxOpenApi from '../clients/krxOpenApi.js';
import * as intradayYield from '../alerts/intradayYieldTicker.js';

const FRESH_HEARTBEAT: YahooHealthSnapshot = {
  lastSuccessAt: Date.now() - 60_000,
  lastFailureAt: 0,
  consecutiveFailures: 0,
  status: 'OK',
};

const STALE_HEARTBEAT: YahooHealthSnapshot = {
  lastSuccessAt: Date.now() - 3 * 60 * 60_000,
  lastFailureAt: 0,
  consecutiveFailures: 0,
  status: 'STALE',
};

const DOWN_HEARTBEAT: YahooHealthSnapshot = {
  lastSuccessAt: Date.now() - 13 * 60 * 60_000,
  lastFailureAt: Date.now() - 60_000,
  consecutiveFailures: 6,
  status: 'DOWN',
};

const UNKNOWN_HEARTBEAT: YahooHealthSnapshot = {
  lastSuccessAt: 0,
  lastFailureAt: 0,
  consecutiveFailures: 0,
  status: 'UNKNOWN',
};

// ── deriveYahooStatus ───────────────────────────────────────────────────────

describe('deriveYahooStatus — 6분기 분류 SSOT', () => {
  it('candidates>0 + 모두 실패 → DOWN/HAS_CANDIDATES', () => {
    const summary: ScanSummary = {
      time: '10:00 KST',
      candidates: 5,
      trackB: 5,
      swing: 3,
      catalyst: 2,
      momentum: 0,
      yahooFails: 5,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
    };
    const r = deriveYahooStatus(summary, FRESH_HEARTBEAT);
    expect(r.status).toBe('DOWN');
    expect(r.detail).toBe('HAS_CANDIDATES');
  });

  it('candidates>0 + 50% 초과 실패 → DEGRADED', () => {
    const summary: ScanSummary = {
      time: '10:00 KST', candidates: 10, trackB: 10, swing: 5, catalyst: 5, momentum: 0,
      yahooFails: 7, gateMisses: 0, rrrMisses: 0, entries: 0,
    };
    expect(deriveYahooStatus(summary, FRESH_HEARTBEAT).status).toBe('DEGRADED');
  });

  it('candidates>0 + 50% 이하 실패 → OK', () => {
    const summary: ScanSummary = {
      time: '10:00 KST', candidates: 10, trackB: 10, swing: 5, catalyst: 5, momentum: 0,
      yahooFails: 3, gateMisses: 0, rrrMisses: 0, entries: 0,
    };
    expect(deriveYahooStatus(summary, FRESH_HEARTBEAT).status).toBe('OK');
  });

  it('candidates=0 + heartbeat OK → HEARTBEAT_OK/OK', () => {
    const summary: ScanSummary = {
      time: '10:00 KST', candidates: 0, trackB: 0, swing: 0, catalyst: 0, momentum: 0,
      yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0,
    };
    const r = deriveYahooStatus(summary, FRESH_HEARTBEAT);
    expect(r.detail).toBe('HEARTBEAT_OK');
    expect(r.status).toBe('OK');
  });

  it('candidates=0 + heartbeat STALE → HEARTBEAT_STALE/STALE', () => {
    const summary: ScanSummary = {
      time: '10:00 KST', candidates: 0, trackB: 0, swing: 0, catalyst: 0, momentum: 0,
      yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0,
    };
    const r = deriveYahooStatus(summary, STALE_HEARTBEAT);
    expect(r.detail).toBe('HEARTBEAT_STALE');
    expect(r.status).toBe('STALE');
  });

  it('candidates=0 + heartbeat DOWN → HEARTBEAT_DOWN/DOWN', () => {
    const r = deriveYahooStatus(null, DOWN_HEARTBEAT);
    expect(r.detail).toBe('HEARTBEAT_DOWN');
    expect(r.status).toBe('DOWN');
  });

  it('candidates=0 + heartbeat UNKNOWN + scan summary candidates=0 → NO_CANDIDATES/OK', () => {
    const summary: ScanSummary = {
      time: '10:00 KST', candidates: 0, trackB: 0, swing: 0, catalyst: 0, momentum: 0,
      yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0,
    };
    const r = deriveYahooStatus(summary, UNKNOWN_HEARTBEAT);
    expect(r.detail).toBe('NO_CANDIDATES');
    expect(r.status).toBe('OK');
  });

  it('summary=null + heartbeat UNKNOWN → NO_SCAN_HISTORY/UNKNOWN', () => {
    const r = deriveYahooStatus(null, UNKNOWN_HEARTBEAT);
    expect(r.detail).toBe('NO_SCAN_HISTORY');
    expect(r.status).toBe('UNKNOWN');
  });
});

// ── computeVerdict ──────────────────────────────────────────────────────────

const HEALTHY_INPUTS = {
  emergencyStop: false,
  dailyLossPct: 1,
  dailyLossLimit: 5,
  volumeOk: true,
  watchlistCount: 10,
  autoTradeEnabled: true,
  autoTradeMode: 'LIVE',
  kisConfigured: true,
  kisTokenValid: true,
  krxTokenConfigured: true,
  krxTokenValid: true,
  lastScanTs: Date.now(),
  yahooStatus: 'OK' as const,
};

describe('computeVerdict — 12 분기 우선순위', () => {
  it('정상 모두 OK → 🟢 OK', () => {
    expect(computeVerdict(HEALTHY_INPUTS)).toBe('🟢 OK' as HealthVerdict);
  });

  it('emergencyStop 가 가장 우선 → 🔴 EMERGENCY_STOP', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, emergencyStop: true, dailyLossPct: 99, watchlistCount: 0 }),
    ).toBe('🔴 EMERGENCY_STOP');
  });

  it('dailyLoss ≥ limit → 🔴 DAILY_LOSS_LIMIT', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, dailyLossPct: 5, dailyLossLimit: 5 }),
    ).toBe('🔴 DAILY_LOSS_LIMIT');
  });

  it('volume 미마운트 → 🔴 VOLUME_UNMOUNTED', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, volumeOk: false }),
    ).toBe('🔴 VOLUME_UNMOUNTED');
  });

  it('watchlist 빈상태 → 🔴 WATCHLIST_EMPTY', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, watchlistCount: 0 }),
    ).toBe('🔴 WATCHLIST_EMPTY');
  });

  it('자동매매 OFF → 🟡 AUTO_TRADE_DISABLED', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, autoTradeEnabled: false }),
    ).toBe('🟡 AUTO_TRADE_DISABLED');
  });

  it('KIS 미설정 → 🟡 KIS_NOT_CONFIGURED', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, kisConfigured: false }),
    ).toBe('🟡 KIS_NOT_CONFIGURED');
  });

  it('LIVE 모드 + KIS 토큰 만료 → 🟡 KIS_TOKEN_EXPIRED', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, kisTokenValid: false }),
    ).toBe('🟡 KIS_TOKEN_EXPIRED');
  });

  it('SHADOW 모드 + KIS 토큰 만료 → 검증 통과 (LIVE 만 의미)', () => {
    // SHADOW 모드에서 KIS 토큰이 만료여도 자동매매가 SHADOW 면 OK 가 되어야 한다 —
    // KIS_TOKEN_EXPIRED 는 LIVE 한정 분기. 이 케이스는 통과.
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, autoTradeMode: 'SHADOW', kisTokenValid: false }),
    ).toBe('🟢 OK');
  });

  it('KRX 미설정 → 🟡 KRX_TOKEN_NOT_CONFIGURED', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, krxTokenConfigured: false }),
    ).toBe('🟡 KRX_TOKEN_NOT_CONFIGURED');
  });

  it('KRX 서킷 OPEN → 🟡 KRX_TOKEN_UNHEALTHY', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, krxTokenValid: false }),
    ).toBe('🟡 KRX_TOKEN_UNHEALTHY');
  });

  it('lastScanTs=0 → 🟡 SCANNER_IDLE', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, lastScanTs: 0 }),
    ).toBe('🟡 SCANNER_IDLE');
  });

  it('Yahoo DOWN → 🟡 YAHOO_DOWN', () => {
    expect(
      computeVerdict({ ...HEALTHY_INPUTS, yahooStatus: 'DOWN' }),
    ).toBe('🟡 YAHOO_DOWN');
  });
});

// ── collectHealthSnapshot 통합 ───────────────────────────────────────────────

describe('collectHealthSnapshot — 통합 SSOT', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(watchlistRepo, 'loadWatchlist').mockReturnValue([]);
    vi.spyOn(shadowRepo, 'loadShadowTrades').mockReturnValue([]);
    vi.spyOn(state, 'getEmergencyStop').mockReturnValue(false);
    vi.spyOn(state, 'getDailyLossPct').mockReturnValue(0);
    vi.spyOn(kisClient, 'getKisTokenRemainingHours').mockReturnValue(8);
    vi.spyOn(kisClient, 'getRealDataTokenRemainingHours').mockReturnValue(8);
    vi.spyOn(kisStream, 'getStreamStatus').mockReturnValue({
      connected: true,
      subscribedCount: 5,
      activePrices: 5,
      reconnectCount: 0,
      lastPongAt: null,
      recentEvents: [],
      sessionLifespanEmaMs: null,
      stableResetThresholdMs: 0,
      close1006WindowCount: 0,
    });
    vi.spyOn(gemini, 'getGeminiRuntimeState').mockReturnValue({
      status: 'IDLE',
      label: null,
      caller: null,
      reason: null,
      updatedAt: null,
    });
    vi.spyOn(marketRefresh, 'getYahooHealthSnapshot').mockReturnValue(FRESH_HEARTBEAT);
    vi.spyOn(scheduler, 'getLastScanAt').mockReturnValue(Date.now());
    vi.spyOn(scanner, 'getLastBuySignalAt').mockReturnValue(Date.now() - 3600_000);
    vi.spyOn(scanner, 'getLastScanSummary').mockReturnValue(null);
    vi.spyOn(scanner, 'isOpenShadowStatus').mockReturnValue(false);
    vi.spyOn(paths, 'verifyVolumeMount').mockReturnValue({ ok: true });
    vi.spyOn(krxOpenApi, 'getKrxOpenApiStatus').mockReturnValue({
      enabled: true,
      authKeyConfigured: true,
      circuitState: 'CLOSED',
      failures: 0,
      cacheKeys: [],
      base: 'https://example',
    });
    vi.spyOn(krxOpenApi, 'isKrxOpenApiHealthy').mockReturnValue(true);
    vi.spyOn(intradayYield, 'getCachedIntradayYield').mockReturnValue({
      computedAt: new Date().toISOString(),
      discoveryYield: 0,
      gateYield: 0,
      signalYield: 0,
      counts: {
        universeScanned: 0,
        watchlistCount: 0,
        scanCandidates: 0,
        gateReached: 0,
        gatePassed: 0,
        buyExecuted: 0,
      },
      status: { discovery: 'gray', gate: 'gray', signal: 'gray' },
    });
  });

  it('정상 운영 환경 → verdict OK + 8축 모두 채워짐', () => {
    process.env.AUTO_TRADE_ENABLED = 'true';
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    process.env.KIS_APP_KEY = 'dummy';
    vi.spyOn(watchlistRepo, 'loadWatchlist').mockReturnValue([
      { code: '005930', addedAt: Date.now() } as never,
    ]);
    const s = collectHealthSnapshot();
    expect(s.verdict).toBe('🟢 OK');
    expect(s.watchlistCount).toBe(1);
    expect(s.activePositions).toBe(0);
    expect(s.kisConfigured).toBe(true);
    expect(s.kisTokenValid).toBe(true);
    expect(s.yahoo.status).toBe('OK');
    expect(s.stream.connected).toBe(true);
    expect(s.commitSha).toBeTruthy();
  });

  it('KIS_APP_KEY 미설정 → kisConfigured=false → verdict KIS_NOT_CONFIGURED', () => {
    process.env.AUTO_TRADE_ENABLED = 'true';
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    delete process.env.KIS_APP_KEY;
    vi.spyOn(watchlistRepo, 'loadWatchlist').mockReturnValue([
      { code: '005930' } as never,
    ]);
    const s = collectHealthSnapshot();
    expect(s.kisConfigured).toBe(false);
    expect(s.verdict).toBe('🟡 KIS_NOT_CONFIGURED');
  });

  it('volume 미마운트 → verdict VOLUME_UNMOUNTED 가 dailyLoss 보다 우선', () => {
    process.env.AUTO_TRADE_ENABLED = 'true';
    vi.spyOn(paths, 'verifyVolumeMount').mockReturnValue({ ok: false, error: 'EACCES' });
    vi.spyOn(watchlistRepo, 'loadWatchlist').mockReturnValue([
      { code: '005930' } as never,
    ]);
    const s = collectHealthSnapshot();
    expect(s.volume.ok).toBe(false);
    expect(s.volume.error).toBe('EACCES');
    expect(s.verdict).toBe('🔴 VOLUME_UNMOUNTED');
  });
});
