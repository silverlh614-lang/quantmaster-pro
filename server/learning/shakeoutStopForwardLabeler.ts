// @responsibility ADR-0625 실행 청산(HIT_STOP) 포지션 손절-후 N일 수익률 셰이크아웃 라벨러 — 관측 전용, 주문 import 0, ENV default OFF.
/**
 * shakeoutStopForwardLabeler.ts — ADR-0625 손절-후 N일 수익률 outcome 라벨러 (관측 전용).
 *
 * 실행 포지션이 HIT_STOP 으로 청산된 뒤 종목이 급등(=셰이크아웃)했는지를 정량 학습.
 * 대상: `loadShadowTrades()` 중 `status==='HIT_STOP'` && `exitTime` 존재 && `exitOutcome!=='BE'`
 * (BE=PROFIT_PROTECTION 본절은 셰이크아웃 관심사 아님 — ADR-0112/0625).
 *
 * 각 horizon(1/3/5/10 영업일)의 종가를 KIS 일봉(L1, read-only) 으로 추적 →
 * 청산가 대비 최대 회복률(`maxRecoveryPct`) 산출 → `>= SHAKEOUT_RECOVERY_THRESHOLD_PCT(5.0%)`
 * 이면 셰이크아웃(`isShakeout=true`). 라벨은 `shadow-trades.json` 본체와 물리 분리된
 * 별도 ledger(shakeoutStopOutcomeRepo)에 영속 — 원본 무수정.
 *
 * ## 안전 invariant 7종 (ADR-0625 §3)
 *   1. LIVE 매매 본체 0줄 변경 — signalScanner/entryEngine/exitEngine/kisClient/
 *      orchestrator/autoTradeEngine git diff 0줄.
 *   2. KIS 주문 함수 import 0건 — place/cancel 주문 함수 5종 정적 grep 가드.
 *   3. KIS 호출 read-only 만 — `fetcher`(일봉) 주입, 미전달 시 전건 errors++(quota 0).
 *   4. ENV default OFF — `=== 'true'` 정확 비교 (ADR-0157).
 *   5. 호출자 1건(cron) — `runShakeoutStopForwardLabeler` grep = 모듈+테스트+cron.
 *   6. 원본 불변성 — `shadow-trades.json` 무수정, RESOLVED 라벨 재방문 차단(repo).
 *   7. providerIssue ≠ marketSignal — 종가 결손은 horizon skip·다음 cron 재시도,
 *      약세 신호 변환 0 (9대 불변식 #6).
 *
 * ## priceFetcher 의존성 주입
 * 본 모듈 본체는 default fetcher 미정의 — 호출자(cron)가 의무적으로
 * `fetchHistoricalClosePrice`(KIS 일봉 primary + Yahoo fallback)를 주입.
 * 미전달 시 전건 `errors++` + console.warn 1회 (KIS quota 0 침범 안전 default).
 */

import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadLabels, upsertLabel } from '../persistence/shakeoutStopOutcomeRepo.js';
// addBusinessDays 는 futureReturnResolver SSOT 재사용 (중복 구현 금지 — ADR-0625 §4-D-3).
import { addBusinessDays } from './futureReturnResolver.js';

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** ADR-0625 §1 — 추적 horizon 1/3/5/10 영업일. */
export const SHAKEOUT_FORWARD_HORIZONS = [1, 3, 5, 10] as const;
export type ShakeoutForwardHorizon = (typeof SHAKEOUT_FORWARD_HORIZONS)[number];

/** ADR-0625 §1 본문 SSOT — 청산가 대비 +5% 이상 회복 = 셰이크아웃 (하드코딩 금지·드리프트 차단). */
export const SHAKEOUT_RECOVERY_THRESHOLD_PCT = 5.0;

/** 청산 후 N일 수익률 라벨 — 1 청산 포지션당 1행. 영속: shakeoutStopOutcomeRepo. */
export interface ShakeoutStopOutcomeLabel {
  tradeId: string;            // ServerShadowTrade.id (대상 식별 키)
  stockCode: string;
  exitTimeKst: string;        // YYYY-MM-DD (exitTime KST 정규화)
  exitPrice: number;          // 청산가 (회복률 기준가)
  stopLossExitType?: 'INITIAL' | 'REGIME' | 'INITIAL_AND_REGIME' | 'PROFIT_PROTECTION';
  forwardClose1d?: number; forwardClose3d?: number; forwardClose5d?: number; forwardClose10d?: number;
  forwardReturn1d?: number; forwardReturn3d?: number; forwardReturn5d?: number; forwardReturn10d?: number;
  maxRecoveryPct?: number;    // max((forwardCloseNd − exitPrice)/exitPrice×100)
  isShakeout?: boolean;       // RESOLVED 시점 확정: maxRecoveryPct >= SHAKEOUT_RECOVERY_THRESHOLD_PCT
  maturity: 'PENDING' | 'RESOLVED';
  observationOnly: true;      // 컴파일 타임 관측 전용 표식 (executionImpact=NONE 계약)
}

export interface ShakeoutLabelerResult {
  totalCandidates: number;
  resolvedNow: number;
  pending: number;
  shakeoutCount: number;
  errors: number;
  durationMs: number;
}

export type HistoricalCloseFetcher = (symbol: string, asOf: Date) => Promise<number | null>;

export interface ShakeoutLabelerInput {
  /** default `new Date()` — 테스트 시 시각 주입. */
  now?: Date;
  /** KIS 일봉 read-only fetcher. 미전달 시 전건 errors++ + warn 1회 (KIS quota 0 안전). */
  fetcher?: HistoricalCloseFetcher;
  /** default `SHAKEOUT_RECOVERY_THRESHOLD_PCT` — 테스트 임계 주입. */
  recoveryThresholdPct?: number;
}

/**
 * ENV `SHAKEOUT_STOP_FORWARD_LABELER_ENABLED=true` 정확 비교 (ADR-0157).
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부, default OFF — 운영자 명시 활성화 의무.
 */
export function isShakeoutStopForwardLabelerEnabled(): boolean {
  return process.env.SHAKEOUT_STOP_FORWARD_LABELER_ENABLED === 'true';
}

// ── horizon 필드 키 매핑 ────────────────────────────────────────────────────────

function closeFieldKey(
  h: ShakeoutForwardHorizon,
): 'forwardClose1d' | 'forwardClose3d' | 'forwardClose5d' | 'forwardClose10d' {
  switch (h) {
    case 1: return 'forwardClose1d';
    case 3: return 'forwardClose3d';
    case 5: return 'forwardClose5d';
    case 10: return 'forwardClose10d';
  }
}

function returnFieldKey(
  h: ShakeoutForwardHorizon,
): 'forwardReturn1d' | 'forwardReturn3d' | 'forwardReturn5d' | 'forwardReturn10d' {
  switch (h) {
    case 1: return 'forwardReturn1d';
    case 3: return 'forwardReturn3d';
    case 5: return 'forwardReturn5d';
    case 10: return 'forwardReturn10d';
  }
}

// ── 일자 헬퍼 ────────────────────────────────────────────────────────────────────

function ymdToUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ISO/YYYY-MM-DD exitTime 을 KST 일자(YYYY-MM-DD)로 정규화. 잘못된 형식 → 빈 문자열. */
function normalizeExitTimeKst(exitTime: string): string {
  if (!exitTime || typeof exitTime !== 'string') return '';
  // exitTime 은 `new Date().toISOString()` (UTC) — KST 변환 후 일자 추출.
  const ms = Date.parse(exitTime);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `now`(UTC) 를 KST YYYY-MM-DD. */
function nowToKstYmd(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `exitYmd + horizon 영업일 ≤ nowYmd` 이면 도달. */
function isHorizonReached(exitYmd: string, horizon: number, nowYmd: string): boolean {
  const target = addBusinessDays(exitYmd, horizon);
  if (!target) return false;
  return target <= nowYmd;
}

// ── 메인 진입점 ─────────────────────────────────────────────────────────────────

/**
 * 실행 청산(HIT_STOP) 포지션의 손절-후 N일 수익률 셰이크아웃 라벨링.
 *
 * 동작 결정 트리:
 *   1. ENV OFF → 즉시 `{ ...empty, durationMs: 0 }` (fetch 0·repo 미변경).
 *   2. `loadShadowTrades()` 필터(HIT_STOP·exitTime·exitOutcome≠BE).
 *   3. tradeId 별 기존 라벨 merge (RESOLVED skip — 불변성).
 *   4. 도달 horizon 만 fetcher 호출 (try/catch 격리·null→errors++·약세변환 0).
 *   5. 전 horizon 채워지면 maxRecoveryPct·isShakeout 확정·maturity='RESOLVED'.
 *   6. upsert + 집계 반환.
 */
export async function runShakeoutStopForwardLabeler(
  input?: ShakeoutLabelerInput,
): Promise<ShakeoutLabelerResult> {
  const t0 = Date.now();
  const empty: ShakeoutLabelerResult = {
    totalCandidates: 0,
    resolvedNow: 0,
    pending: 0,
    shakeoutCount: 0,
    errors: 0,
    durationMs: 0,
  };

  // (1) ENV gate — default OFF.
  if (!isShakeoutStopForwardLabelerEnabled()) {
    return empty;
  }

  const now = input?.now ?? new Date();
  const nowYmd = nowToKstYmd(now);
  const fetcher = input?.fetcher;
  const threshold = input?.recoveryThresholdPct ?? SHAKEOUT_RECOVERY_THRESHOLD_PCT;

  // (2) 대상 필터 — HIT_STOP·exitTime·exitOutcome≠BE.
  const trades = loadShadowTrades();
  const candidates = trades.filter(
    (t) =>
      t.status === 'HIT_STOP' &&
      typeof t.exitTime === 'string' &&
      !!t.exitTime &&
      t.exitOutcome !== 'BE' &&
      typeof t.exitPrice === 'number' &&
      Number.isFinite(t.exitPrice) &&
      (t.exitPrice as number) > 0,
  );

  if (candidates.length === 0) {
    return { ...empty, durationMs: Date.now() - t0 };
  }

  // fetcher 미전달 가드 — 전건 errors + console.warn 1회 (KIS quota 0 안전 default).
  if (!fetcher) {
    console.warn(
      '[ShakeoutStopForwardLabeler] fetcher 미전달 — 전건 errors. ADR-0625 §4-D-3 의무 (cron 이 fetchHistoricalClosePrice 주입).',
    );
    return {
      totalCandidates: candidates.length,
      resolvedNow: 0,
      pending: candidates.length,
      shakeoutCount: 0,
      errors: candidates.length,
      durationMs: Date.now() - t0,
    };
  }

  // (3) 기존 라벨 인덱스 (RESOLVED skip 판정용).
  const existingLabels = loadLabels();
  const byTradeId = new Map<string, ShakeoutStopOutcomeLabel>();
  for (const l of existingLabels) byTradeId.set(l.tradeId, l);

  let resolvedNow = 0;
  let pending = 0;
  let shakeoutCount = 0;
  let errors = 0;

  for (const trade of candidates) {
    const existing = byTradeId.get(trade.id);
    // RESOLVED 라벨 재방문 차단 (불변성 — repo 도 이중 방어).
    if (existing && existing.maturity === 'RESOLVED') {
      continue;
    }

    const exitYmd = normalizeExitTimeKst(trade.exitTime as string);
    if (!exitYmd) {
      // 잘못된 exitTime — silent skip (영속 데이터 손상 보호).
      continue;
    }
    const exitPrice = trade.exitPrice as number;

    // 기존 PENDING 라벨 merge (없으면 신규 PENDING 골격).
    const label: ShakeoutStopOutcomeLabel = existing
      ? { ...existing }
      : {
          tradeId: trade.id,
          stockCode: trade.stockCode,
          exitTimeKst: exitYmd,
          exitPrice,
          stopLossExitType: trade.stopLossExitType,
          maturity: 'PENDING',
          observationOnly: true,
        };

    // (4) 도달 horizon 만 fetch.
    for (const h of SHAKEOUT_FORWARD_HORIZONS) {
      const cKey = closeFieldKey(h);
      const existingClose = label[cKey];
      if (typeof existingClose === 'number' && Number.isFinite(existingClose)) continue; // 이미 채움.
      if (!isHorizonReached(exitYmd, h, nowYmd)) continue; // 미도달 — 다음 cron.

      const asOfYmd = addBusinessDays(exitYmd, h);
      if (!asOfYmd) continue; // lookahead 초과 (정상 시 발생 안 함).
      const asOf = new Date(ymdToUtcMidnight(asOfYmd));

      let close: number | null = null;
      try {
        close = await fetcher(trade.stockCode, asOf);
      } catch (e) {
        // throw → errors++ + 다음 horizon (약세 변환 0·불변식 #6).
        errors++;
        console.warn(
          `[ShakeoutStopForwardLabeler] fetcher throw ${trade.stockCode} h=${h}d:`,
          e instanceof Error ? e.message : String(e),
        );
        continue;
      }

      if (close === null || !Number.isFinite(close) || close <= 0) {
        // 종가 결손 → errors++ + horizon skip (providerIssue ≠ bearish, 다음 cron 재시도).
        errors++;
        continue;
      }

      label[cKey] = close;
      label[returnFieldKey(h)] = ((close - exitPrice) / exitPrice) * 100;
    }

    // (5) 성숙 판정 — 전 horizon 종가 채워지면 RESOLVED.
    const allClosesPresent = SHAKEOUT_FORWARD_HORIZONS.every((h) => {
      const v = label[closeFieldKey(h)];
      return typeof v === 'number' && Number.isFinite(v);
    });

    if (allClosesPresent) {
      const recoveries = SHAKEOUT_FORWARD_HORIZONS.map(
        (h) => ((label[closeFieldKey(h)] as number) - exitPrice) / exitPrice * 100,
      );
      const maxRecoveryPct = Math.max(...recoveries);
      label.maxRecoveryPct = maxRecoveryPct;
      label.isShakeout = maxRecoveryPct >= threshold;
      label.maturity = 'RESOLVED';
      resolvedNow++;
      if (label.isShakeout) shakeoutCount++;
    } else {
      label.maturity = 'PENDING';
      pending++;
    }

    // (6) upsert (repo 가 RESOLVED 불변성 이중 방어).
    upsertLabel(label);
  }

  return {
    totalCandidates: candidates.length,
    resolvedNow,
    pending,
    shakeoutCount,
    errors,
    durationMs: Date.now() - t0,
  };
}

// ── 테스트 전용 export ─────────────────────────────────────────────────────────
export const __testOnly = {
  normalizeExitTimeKst,
  nowToKstYmd,
  isHorizonReached,
  closeFieldKey,
  returnFieldKey,
};

// ── 호출자 표시 ─────────────────────────────────────────────────────────────────
//
// 본 모듈은 다음 1개 호출자만 가짐 (절대 규칙):
//   - server/scheduler/learningJobs.ts (cron 'shakeout_stop_forward_labeling' KST 16:50)
//
// 추가 호출자(HTTP endpoint / 텔레그램 명령 등)는 별도 PR + ADR. 정적 grep 가드 회귀.
