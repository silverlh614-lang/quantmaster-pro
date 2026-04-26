// @responsibility diagnostics 헬스 진단 모듈
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
  yahoo: HealthProbeOutcome;
  dart: HealthProbeOutcome;
}

/**
 * 외부 probe 결과 분류 — 단순 ok/fail 보다 정확한 severity 매핑.
 * - OK       : 응답 정상 또는 의미상 정상 (예: DART status=013 "데이터 없음")
 * - WARN     : 일시 장애 / 비정상 응답 / 네트워크 에러
 * - CRITICAL : 인증/접근 권한 문제 — 운영자가 즉시 확인 필요
 */
export type HealthProbeSeverity = 'OK' | 'WARN' | 'CRITICAL';

export interface HealthProbeOutcome {
  severity: HealthProbeSeverity;
  /** HTTP 상태 코드 (네트워크 에러 / non-HTTP 실패 시 undefined). */
  statusCode?: number;
  /** 사람이 읽을 수 있는 사유 — 텔레그램 표시용. */
  message: string;
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

// ─── 외부 HTTP probe 분류 ────────────────────────────────────────────────

/**
 * Yahoo HTTP probe 결과 분류. 사용자 패치 권장안 — 단순 ok/fail 대신 severity 매핑.
 *
 * - 200~299 → OK
 * - 429/502/503/504 → WARN (일시 장애·rate limit, retry 가치 있음)
 * - statusCode 없음(타임아웃/네트워크) → WARN
 * - 그 외 4xx/5xx → WARN (비정상이지만 cron 다음 주기 재시도)
 */
export function classifyYahooProbe(statusCode?: number): {
  severity: HealthProbeSeverity;
  message: string;
} {
  if (statusCode === undefined) {
    return { severity: 'WARN', message: 'Yahoo probe timeout or network error' };
  }
  if (statusCode >= 200 && statusCode < 300) {
    return { severity: 'OK', message: 'Yahoo probe OK' };
  }
  if (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return { severity: 'WARN', message: `Yahoo temporary unavailable status=${statusCode}` };
  }
  return { severity: 'WARN', message: `Yahoo probe non-OK status=${statusCode}` };
}

/**
 * DART API status 코드 분류. 사용자 패치 권장안.
 *
 * DART 공식 코드 (https://opendart.fss.or.kr 명세):
 * - 000 정상 / 010 미등록키 / 011 사용한도 / 012 접근거부 / 013 조회 데이터 없음
 * - 020 요청 초과 / 100 필드 부재 / 800 시스템 점검 / 900 정의되지 않은 오류 / 901 사용자 계정 만료
 *
 * - status=000 → OK
 * - status=013 → OK (데이터 없음 — probe 자체는 도달 성공, 의미상 정상)
 * - status=010/011/012/901 → CRITICAL (인증·계정·권한)
 * - status=020/800/900 → WARN (일시·시스템·미분류 오류)
 * - 그 외 → WARN
 */
export function classifyDartStatus(status: string): {
  severity: HealthProbeSeverity;
  message: string;
} {
  switch (status) {
    case '000':
      return { severity: 'OK', message: 'DART API 정상 응답' };
    case '013':
      return { severity: 'OK', message: 'DART API reachable, no data for probe query' };
    case '010':
    case '011':
    case '012':
    case '901':
      return { severity: 'CRITICAL', message: `DART 인증/접근 문제 status=${status}` };
    case '020':
    case '800':
    case '900':
      return { severity: 'WARN', message: `DART 일시/제한 문제 status=${status}` };
    default:
      return { severity: 'WARN', message: `DART 알 수 없는 status=${status}` };
  }
}

// ─── 외부 HTTP probe (옵셔널) ────────────────────────────────────────────

/**
 * Yahoo / DART 라이브 probe. health.cmd 만 사용 (HTTP 라우트는 응답 시간 보호 위해 미사용).
 * timeoutMs 초과 시 각 probe 가 개별 reject — 다른 probe 는 영향 없음.
 *
 * 결과는 `classifyYahooProbe` / `classifyDartStatus` 로 severity 매핑 — 단순 ok/fail
 * 보다 정확하다 (예: DART status=013 "데이터 없음" 은 ❌ 가 아니라 ✅).
 */
export async function runExternalProbes(timeoutMs = 3000): Promise<HealthProbeResult> {
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

  const yahooProbe: Promise<HealthProbeOutcome> = withTimeout(
    guardedFetch(
      'https://query1.finance.yahoo.com/v7/finance/chart/^KS11?interval=1d&range=1d',
    ).then((r) => {
      const cls = classifyYahooProbe(r.status);
      return { severity: cls.severity, statusCode: r.status, message: cls.message };
    }),
  ).catch((e) => ({
    severity: 'WARN' as HealthProbeSeverity,
    message: `Yahoo probe error: ${(e as Error).message}`,
  }));

  const dartProbe: Promise<HealthProbeOutcome> = withTimeout(
    fetch(
      `https://opendart.fss.or.kr/api/list.json?crtfc_key=${process.env.DART_API_KEY ?? ''}&page_count=1`,
    ).then(async (r) => {
      if (!r.ok) {
        // HTTP 자체 실패 — DART status 분류 불가, transport 레벨로만 판단.
        return {
          severity: r.status >= 500 ? 'WARN' : 'WARN',
          statusCode: r.status,
          message: `DART HTTP ${r.status}`,
        } satisfies HealthProbeOutcome;
      }
      const j = (await r.json()) as { status?: string };
      const apiStatus = j.status ?? 'unknown';
      const cls = classifyDartStatus(apiStatus);
      return { severity: cls.severity, statusCode: r.status, message: cls.message };
    }),
  ).catch((e) => ({
    severity: 'WARN' as HealthProbeSeverity,
    message: `DART probe error: ${(e as Error).message}`,
  }));

  const [yahoo, dart] = await Promise.all([yahooProbe, dartProbe]);
  return { yahoo, dart };
}
