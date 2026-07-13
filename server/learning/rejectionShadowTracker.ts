/**
 * @responsibility Gate Score 14~17 near-miss 거절 종목 5영업일 사후 추적 — 거짓 부정 측정
 *
 * ADR-0028 (PR-L): 자기학습 시리즈 11번째 모듈. 알파 누수의 절반인 "거의 통과할
 * 뻔한 거절" 의 사후 수익률 분포를 학습 데이터로 축적. ghostPortfolioTracker
 * (Watch/BUY 신호 받은 종목 30일 추적) 와 별도 영속 — near-miss 거절만 대상.
 *
 * signalScanner / stockScreener 의 wiring 은 본 모듈 scope 밖 — 절대 규칙 #4
 * (autoTradeEngine 단일 통로) 보호를 위해 후속 PR (Phase B 분해 후) 분리.
 */
import fs from 'fs';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { REJECTION_SHADOW_FILE, ensureDataDir } from '../persistence/paths.js';

// ─── 임계값 SSOT ────────────────────────────────────────────────────────────

/** Gate Score 임계 미달 N점 이내만 near-miss 로 분류 */
export const REJECTION_NEAR_MISS_MIN = 14;
export const REJECTION_NEAR_MISS_MAX = 17;
export const REJECTION_GATE_THRESHOLD = 18;

/** 5 영업일 (KST 평일만 카운트, 한국 공휴일 미반영 — 후속 PR) */
const TRACK_BUSINESS_DAYS = 5;

/** 영속 파일 hard cap (FIFO trim) */
const REJECTION_SHADOW_MAX = 500;

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface RejectionShadowEntry {
  id: string;
  stockCode: string;
  stockName: string;
  /** YYYY-MM-DD KST */
  signalDate: string;
  signalPriceKrw: number;
  /** Gate Score (14~17 만 본 트래커 추적) */
  gateScore: number;
  /** scoreDelta = REJECTION_GATE_THRESHOLD - gateScore (1~4) */
  scoreDelta: number;
  rejectionReason: string;
  /** 5 영업일 후 종결 (YYYY-MM-DD KST) */
  trackUntil: string;
  /** 마지막 가격 갱신 시 수익률 (%) */
  currentReturnPct?: number;
  lastUpdatedAt?: string;
  /** trackUntil 도달 또는 명시적 종결 */
  closed?: boolean;
  /**
   * ADR-0087 PR-F — 거절 시점 27조건 점수 (1~27 → 0~10).
   * Over-Strict / Good Defense 분류 분석 입력. 옵셔널 — 호출자 wiring 후속 PR.
   * 미전달 시 분석 모듈이 graceful fallback (해당 entry 제외).
   */
  conditionScores?: Record<number, number>;
}

export interface RejectionRecordInput {
  stockCode: string;
  stockName: string;
  signalDate: string;
  signalPriceKrw: number;
  gateScore: number;
  rejectionReason: string;
  /** ADR-0087 — 옵셔널 27조건 점수 스냅샷 (호출자 wiring 후속 PR) */
  conditionScores?: Record<number, number>;
}

export interface RejectionShadowSummary {
  totalCount: number;
  closedCount: number;
  activeCount: number;
  /** 종결된 entry 의 평균 수익률 (%) */
  avgClosedReturnPct: number;
  /** 종결된 entry 의 중앙값 수익률 (%) */
  medianClosedReturnPct: number;
  /** 종결된 entry 중 +5% 이상 비율 (0~1) — 거짓 부정율 */
  falseNegativeRate: number;
  /** 종결된 entry 의 분위수 */
  quartiles: { q1: number; q2: number; q3: number };
  /** 통계 신뢰 표본 수 ≥ 5 */
  reliable: boolean;
}

// ─── 영속 헬퍼 ──────────────────────────────────────────────────────────────

function loadEntries(): RejectionShadowEntry[] {
  ensureDataDir();
  if (!fs.existsSync(REJECTION_SHADOW_FILE)) return [];
  try {
    const raw = fs.readFileSync(REJECTION_SHADOW_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RejectionShadowEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: RejectionShadowEntry[]): void {
  ensureDataDir();
  // FIFO trim: 가장 오래된 항목 우선 제거
  const trimmed = entries.slice(-REJECTION_SHADOW_MAX);
  fs.writeFileSync(REJECTION_SHADOW_FILE, JSON.stringify(trimmed, null, 2));
}

// ─── 영업일 계산 (KST 평일만) ──────────────────────────────────────────────

/**
 * yyyymmdd 에 영업일 N 만큼 더한다. 토(6)/일(0) 은 스킵.
 * 한국 공휴일은 미반영 — 후속 PR 에서 한국거래소 휴장일 calendar 통합.
 */
export function addBusinessDays(yyyymmdd: string, businessDays: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  let added = 0;
  while (added < businessDays) {
    t.setUTCDate(t.getUTCDate() + 1);
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return t.toISOString().slice(0, 10);
}

// ─── 핵심 API ────────────────────────────────────────────────────────────────

/**
 * Gate Score 14~17 거절을 영속한다. 그 외 점수는 silent skip (반환 0).
 * 동일 (stockCode + signalDate) 가 이미 활성 entry 면 중복 무시 (idempotent).
 *
 * @returns 신규 추가된 entry 수 (0 또는 1)
 */
export function recordRejection(input: RejectionRecordInput): number {
  if (input.gateScore < REJECTION_NEAR_MISS_MIN || input.gateScore > REJECTION_NEAR_MISS_MAX) {
    return 0;
  }
  if (!Number.isFinite(input.signalPriceKrw) || input.signalPriceKrw <= 0) {
    return 0;
  }

  const entries = loadEntries();
  const dupKey = `${input.stockCode}|${input.signalDate}`;
  const exists = entries.some(
    e => !e.closed && `${e.stockCode}|${e.signalDate}` === dupKey,
  );
  if (exists) return 0;

  const id = `rej-shadow-${Date.now()}-${input.stockCode}`;
  const scoreDelta = REJECTION_GATE_THRESHOLD - input.gateScore;
  const trackUntil = addBusinessDays(input.signalDate, TRACK_BUSINESS_DAYS);

  entries.push({
    id,
    stockCode: input.stockCode,
    stockName: input.stockName,
    signalDate: input.signalDate,
    signalPriceKrw: input.signalPriceKrw,
    gateScore: input.gateScore,
    scoreDelta,
    rejectionReason: input.rejectionReason,
    trackUntil,
    closed: false,
    ...(input.conditionScores !== undefined && { conditionScores: input.conditionScores }),
  });

  saveEntries(entries);
  return 1;
}

export interface RefreshRejectionOptions {
  /** 기준 시각 (테스트 주입). 기본 now. */
  now?: Date;
  /** 가격 조회 — 기본 KIS fetchCurrentPrice */
  priceFetcher?: (code: string) => Promise<number | null>;
}

/**
 * 활성 entry 의 currentReturnPct 갱신 + trackUntil 만료 종결.
 * 가격 부재 / 음수 / 신호 가격 0 이면 skipped.
 */
export async function refreshRejectionShadow(
  opts: RefreshRejectionOptions = {},
): Promise<{ updated: number; closed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const fetcher = opts.priceFetcher ?? fetchCurrentPrice;

  const entries = loadEntries();
  let updated = 0;
  let closed = 0;
  let skipped = 0;

  for (const e of entries) {
    if (e.closed) continue;
    if (e.trackUntil && today > e.trackUntil) {
      e.closed = true;
      closed++;
      continue;
    }
    try {
      const price = await fetcher(e.stockCode);
      if (price == null || price <= 0 || e.signalPriceKrw <= 0) {
        skipped++;
        continue;
      }
      e.currentReturnPct = Number(
        (((price - e.signalPriceKrw) / e.signalPriceKrw) * 100).toFixed(2),
      );
      e.lastUpdatedAt = now.toISOString();
      updated++;
    } catch {
      skipped++;
    }
  }

  saveEntries(entries);
  return { updated, closed, skipped };
}

// ─── 통계 ────────────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quartile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

/**
 * 종결된 entry 의 수익률 분포 통계.
 * falseNegativeRate = 종결 entry 중 currentReturnPct ≥ +5% 비율.
 */
export function summarizeRejectionShadow(): RejectionShadowSummary {
  const entries = loadEntries();
  const closedEntries = entries.filter(e => e.closed === true);
  const closedReturns = closedEntries
    .map(e => e.currentReturnPct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const closedCount = closedReturns.length;
  const activeCount = entries.filter(e => !e.closed).length;
  const totalCount = entries.length;

  const avgClosedReturnPct = closedCount > 0
    ? Number((closedReturns.reduce((s, v) => s + v, 0) / closedCount).toFixed(2))
    : 0;
  const medianClosedReturnPct = closedCount > 0
    ? Number(median(closedReturns).toFixed(2))
    : 0;
  const falseNegativeWins = closedReturns.filter(v => v >= 5).length;
  const falseNegativeRate = closedCount > 0
    ? Number((falseNegativeWins / closedCount).toFixed(4))
    : 0;
  const quartiles = closedCount > 0 ? {
    q1: Number(quartile(closedReturns, 0.25).toFixed(2)),
    q2: Number(quartile(closedReturns, 0.50).toFixed(2)),
    q3: Number(quartile(closedReturns, 0.75).toFixed(2)),
  } : { q1: 0, q2: 0, q3: 0 };

  return {
    totalCount,
    closedCount,
    activeCount,
    avgClosedReturnPct,
    medianClosedReturnPct,
    falseNegativeRate,
    quartiles,
    reliable: closedCount >= 5,
  };
}

/** 모든 entry 반환 (UI / 디버그용). */
export function getAllRejectionShadow(): RejectionShadowEntry[] {
  return loadEntries();
}

/** 테스트용 reset. */
export function __resetRejectionShadowForTests(): void {
  try {
    if (fs.existsSync(REJECTION_SHADOW_FILE)) {
      fs.unlinkSync(REJECTION_SHADOW_FILE);
    }
  } catch {
    /* ignore */
  }
}
