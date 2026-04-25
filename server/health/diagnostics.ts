// @responsibility: 8축 시스템 헬스 스냅샷 SSOT — /health 텔레그램 cmd 와 /api/health/pipeline HTTP 라우트 공용.
//
// ADR-0017 후속 — health.cmd.ts (텍스트 포맷) 와 systemRouter.ts (JSON 포맷) 가
// 동일한 8축 데이터를 90% 중복 수집하던 구조를 본 모듈로 통합. 호출자는 포맷팅만 담당.
//
// 8축: 워치리스트 / 포지션 / KIS / KRX / Yahoo / Gemini / Volume / Stream + 운영 메타(uptime/mem/commit).
// 외부 HTTP probe (Yahoo·DART) 는 호출자 선택 — `runExternalProbes()` 별도 함수.
// 스냅샷 코어는 순수 (외부 fetch 없음) — 단위 테스트 가능.

import { loadShadowTrades, getRemainingQty } from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getEmergencyStop, getDailyLossPct } from '../state.js';
import {
  getKisTokenRemainingHours,
  getRealDataTokenRemainingHours,
} from '../clients/kisClient.js';
import { getStreamStatus } from '../clients/kisStreamClient.js';
import { getGeminiRuntimeState, type GeminiRuntimeState } from '../clients/geminiClient.js';
import {
  getYahooHealthSnapshot,
  type YahooHealthSnapshot,
} from '../trading/marketDataRefresh.js';
import { getLastScanAt } from '../orchestrator/adaptiveScanScheduler.js';
import {
  getLastBuySignalAt,
  getLastScanSummary,
  isOpenShadowStatus,
} from '../trading/signalScanner.js';
import { verifyVolumeMount } from '../persistence/paths.js';
import { getKrxOpenApiStatus, isKrxOpenApiHealthy } from '../clients/krxOpenApi.js';
import { getCachedIntradayYield } from '../alerts/intradayYieldTicker.js';
import { guardedFetch } from '../utils/egressGuard.js';
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

// ─── 타입 ────────────────────────────────────────────────────────────────

export type HealthVerdict =
  | '🟢 OK'
  | '🟡 AUTO_TRADE_DISABLED'
  | '🟡 KIS_NOT_CONFIGURED'
  | '🟡 KIS_TOKEN_EXPIRED'
  | '🟡 KRX_TOKEN_NOT_CONFIGURED'
  | '🟡 KRX_TOKEN_UNHEALTHY'
  | '🟡 SCANNER_IDLE'
  | '🟡 YAHOO_DOWN'
  | '🔴 EMERGENCY_STOP'
  | '🔴 DAILY_LOSS_LIMIT'
  | '🔴 VOLUME_UNMOUNTED'
  | '🔴 WATCHLIST_EMPTY';

export type YahooApiStatus = 'OK' | 'STALE' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
export type YahooApiDetail =
  | 'NO_SCAN_HISTORY'
  | 'NO_CANDIDATES'
  | 'HAS_CANDIDATES'
  | 'HEARTBEAT_OK'
  | 'HEARTBEAT_STALE'
  | 'HEARTBEAT_DOWN';

export type StreamStatus = ReturnType<typeof getStreamStatus>;

export interface HealthSnapshot {
  // ── 운영 메타 ──
  uptimeHours: string;        // "1.5"
  memMB: number;              // heap used in MB
  commitSha: string;          // 7-char SHA or 'unknown'

  // ── 1축: 워치리스트 + 포지션 ──
  watchlistCount: number;
  activePositions: number;

  // ── 2축: 자동매매 모드 ──
  autoTradeEnabled: boolean;
  autoTradeMode: string;      // 'SHADOW' | 'LIVE' | ...

  // ── 3축: 비상정지 + 일일손실 ──
  emergencyStop: boolean;
  dailyLossPct: number;
  dailyLossLimit: number;
  dailyLossLimitReached: boolean;

  // ── 4축: KIS ──
  kisConfigured: boolean;     // KIS_APP_KEY 존재 여부
  kisTokenHours: number;      // 0 = 만료
  kisTokenValid: boolean;     // LIVE 모드일 때만 의미 있음 (SHADOW 는 항상 true)
  realDataTokenHours: number;

  // ── 5축: KRX OpenAPI ──
  krxTokenConfigured: boolean;
  krxTokenValid: boolean;
  krxCircuitState: string;
  krxFailures: number;

  // ── 6축: Yahoo (집계 상태) ──
  yahoo: {
    /** 호환 — 단일 라벨. */
    status: YahooApiStatus;
    /** 더 자세한 분기 라벨 (UI 회피용). */
    detail: YahooApiDetail;
    /** marketDataRefresh.getYahooHealthSnapshot() 원본. */
    heartbeat: YahooHealthSnapshot;
  };

  // ── 7축: Gemini ──
  geminiRuntime: GeminiRuntimeState;

  // ── 8축: Volume + Stream ──
  volume: { ok: boolean; error?: string };
  stream: StreamStatus;

  // ── 부가: 스캐너 ──
  lastScanTs: number;
  lastBuyTs: number;
  lastScanSummary: ScanSummary | null;

  // ── 부가: IPYL (systemRouter 표시용) ──
  intradayYield: ReturnType<typeof getCachedIntradayYield>;

  // ── 종합 ──
  verdict: HealthVerdict;
}

export interface HealthProbeResult {
  yahoo: { ok: boolean; detail: string };
  dart: { ok: boolean; detail: string };
}

// ─── 핵심: 스냅샷 수집 ───────────────────────────────────────────────────

export function collectHealthSnapshot(): HealthSnapshot {
  const watchlist = loadWatchlist();
  const shadows = loadShadowTrades();
  const emergencyStop = getEmergencyStop();
  const dailyLossPct = getDailyLossPct();
  const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
  const autoTradeEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
  const autoTradeMode = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
  const kisConfigured = !!process.env.KIS_APP_KEY;
  const kisTokenHours = getKisTokenRemainingHours();
  const realDataTokenHours = getRealDataTokenRemainingHours();
  const kisTokenValid = kisConfigured && (autoTradeMode !== 'LIVE' || kisTokenHours > 0);

  const krxStatus = getKrxOpenApiStatus();
  const krxTokenConfigured = krxStatus.authKeyConfigured;
  const krxTokenValid = isKrxOpenApiHealthy();

  const lastScanTs = getLastScanAt();
  const lastBuyTs = getLastBuySignalAt();
  const lastScanSummary = getLastScanSummary();

  const heartbeat = getYahooHealthSnapshot();
  const { detail: yahooDetail, status: yahooStatus } = deriveYahooStatus(
    lastScanSummary,
    heartbeat,
  );

  const volumeCheck = verifyVolumeMount();
  const streamStatus = getStreamStatus();
  const geminiRuntime = getGeminiRuntimeState();

  const activePositions = shadows.filter(
    s => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0,
  ).length;

  const verdict = computeVerdict({
    emergencyStop,
    dailyLossPct,
    dailyLossLimit,
    volumeOk: volumeCheck.ok,
    watchlistCount: watchlist.length,
    autoTradeEnabled,
    autoTradeMode,
    kisConfigured,
    kisTokenValid,
    krxTokenConfigured,
    krxTokenValid,
    lastScanTs,
    yahooStatus,
  });

  const commitSha = (
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    'unknown'
  ).slice(0, 7);

  return {
    uptimeHours: (process.uptime() / 3600).toFixed(1),
    memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    commitSha,
    watchlistCount: watchlist.length,
    activePositions,
    autoTradeEnabled,
    autoTradeMode,
    emergencyStop,
    dailyLossPct,
    dailyLossLimit,
    dailyLossLimitReached: dailyLossPct >= dailyLossLimit,
    kisConfigured,
    kisTokenHours,
    kisTokenValid,
    realDataTokenHours,
    krxTokenConfigured,
    krxTokenValid,
    krxCircuitState: krxStatus.circuitState,
    krxFailures: krxStatus.failures,
    yahoo: {
      status: yahooStatus,
      detail: yahooDetail,
      heartbeat,
    },
    geminiRuntime,
    volume: { ok: volumeCheck.ok, error: volumeCheck.error },
    stream: streamStatus,
    lastScanTs,
    lastBuyTs,
    lastScanSummary,
    intradayYield: getCachedIntradayYield(),
    verdict,
  };
}

// ─── Yahoo 상태 분류 ─────────────────────────────────────────────────────

/**
 * Yahoo 가용성 분기 — systemRouter 의 6분기 detail 라벨을 SSOT 화.
 * 우선순위:
 *   1) 스캔 후보 ≥ 1: 후보 대비 fail 비율로 OK / DEGRADED / DOWN
 *   2) heartbeat OK / STALE / DOWN: 1시간/4시간/12시간 또는 5회 연속실패 임계
 *   3) 스캔 후보 = 0: 정상 idle
 *   4) 그 외: UNKNOWN
 */
export function deriveYahooStatus(
  scanSummary: ScanSummary | null,
  heartbeat: YahooHealthSnapshot,
): { detail: YahooApiDetail; status: YahooApiStatus } {
  if (scanSummary && scanSummary.candidates > 0) {
    const failRatio = scanSummary.yahooFails / scanSummary.candidates;
    const status: YahooApiStatus =
      scanSummary.yahooFails === scanSummary.candidates
        ? 'DOWN'
        : failRatio > 0.5
          ? 'DEGRADED'
          : 'OK';
    return { detail: 'HAS_CANDIDATES', status };
  }
  if (heartbeat.status === 'OK') return { detail: 'HEARTBEAT_OK', status: 'OK' };
  if (heartbeat.status === 'STALE') return { detail: 'HEARTBEAT_STALE', status: 'STALE' };
  if (heartbeat.status === 'DOWN') return { detail: 'HEARTBEAT_DOWN', status: 'DOWN' };
  if (scanSummary && scanSummary.candidates === 0) {
    return { detail: 'NO_CANDIDATES', status: 'OK' };
  }
  return { detail: 'NO_SCAN_HISTORY', status: 'UNKNOWN' };
}

// ─── verdict 계산 (순수 함수) ─────────────────────────────────────────────

interface VerdictInputs {
  emergencyStop: boolean;
  dailyLossPct: number;
  dailyLossLimit: number;
  volumeOk: boolean;
  watchlistCount: number;
  autoTradeEnabled: boolean;
  autoTradeMode: string;
  kisConfigured: boolean;
  kisTokenValid: boolean;
  krxTokenConfigured: boolean;
  krxTokenValid: boolean;
  lastScanTs: number;
  yahooStatus: YahooApiStatus;
}

/**
 * 파이프라인 첫 번째 단절점을 반환. 우선순위 (높→낮):
 *   1. EMERGENCY_STOP / DAILY_LOSS_LIMIT / VOLUME_UNMOUNTED / WATCHLIST_EMPTY (🔴)
 *   2. AUTO_TRADE_DISABLED / KIS_NOT_CONFIGURED / KIS_TOKEN_EXPIRED (🟡)
 *   3. KRX_TOKEN_NOT_CONFIGURED / KRX_TOKEN_UNHEALTHY / SCANNER_IDLE / YAHOO_DOWN (🟡)
 *   4. OK (🟢)
 */
export function computeVerdict(i: VerdictInputs): HealthVerdict {
  if (i.emergencyStop) return '🔴 EMERGENCY_STOP';
  if (i.dailyLossPct >= i.dailyLossLimit) return '🔴 DAILY_LOSS_LIMIT';
  if (!i.volumeOk) return '🔴 VOLUME_UNMOUNTED';
  if (i.watchlistCount === 0) return '🔴 WATCHLIST_EMPTY';
  if (!i.autoTradeEnabled) return '🟡 AUTO_TRADE_DISABLED';
  if (!i.kisConfigured) return '🟡 KIS_NOT_CONFIGURED';
  if (i.autoTradeMode === 'LIVE' && !i.kisTokenValid) return '🟡 KIS_TOKEN_EXPIRED';
  if (!i.krxTokenConfigured) return '🟡 KRX_TOKEN_NOT_CONFIGURED';
  if (!i.krxTokenValid) return '🟡 KRX_TOKEN_UNHEALTHY';
  if (i.lastScanTs <= 0) return '🟡 SCANNER_IDLE';
  if (i.yahooStatus === 'DOWN') return '🟡 YAHOO_DOWN';
  return '🟢 OK';
}

// ─── 외부 HTTP probe (옵셔널) ────────────────────────────────────────────

/**
 * Yahoo / DART 라이브 probe. health.cmd 만 사용 (HTTP 라우트는 응답 시간 보호 위해 미사용).
 * timeoutMs 초과 시 각 probe 가 개별 reject — 다른 probe 는 영향 없음.
 */
export async function runExternalProbes(timeoutMs = 3000): Promise<HealthProbeResult> {
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

  const yahooProbe = withTimeout(
    guardedFetch(
      'https://query1.finance.yahoo.com/v7/finance/chart/^KS11?interval=1d&range=1d',
    ).then(r => ({ ok: r.ok, detail: r.ok ? 'OK' : `HTTP ${r.status}` })),
  ).catch(e => ({ ok: false, detail: (e as Error).message }));

  const dartProbe = withTimeout(
    fetch(
      `https://opendart.fss.or.kr/api/list.json?crtfc_key=${process.env.DART_API_KEY ?? ''}&page_count=1`,
    ).then(async r => {
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const j = (await r.json()) as { status?: string };
      return j.status === '000'
        ? { ok: true, detail: 'OK' }
        : { ok: false, detail: `status=${j.status}` };
    }),
  ).catch(e => ({ ok: false, detail: (e as Error).message }));

  const [yahoo, dart] = await Promise.all([yahooProbe, dartProbe]);
  return { yahoo, dart };
}
