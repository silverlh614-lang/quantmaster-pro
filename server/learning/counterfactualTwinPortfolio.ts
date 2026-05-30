/**
 * @responsibility 3 Twin (AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT) 평행 포트폴리오 — 진입 임계 반사실
 *
 * ADR-0029 (PR-M): 페어 A 의 두 번째 절반. PR-L Rejection Tracker 가 "거절된
 * 종목 사후 추적" 으로 거짓 부정을 측정한다면, 본 모듈은 "다른 진입 정책의
 * 평행 포트폴리오" 로 시스템이 자기 자신을 메타 평가한다. ledgerSimulator 와는
 * 다른 차원 — ledger 는 같은 신호의 다른 매도 시뮬레이션, Twin 은 다른 진입 임계.
 *
 * signalScanner wiring 은 본 PR scope 밖 (절대 규칙 #4 보호).
 */
import fs from 'fs';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { TWIN_PORTFOLIO_FILE, ensureDataDir } from '../persistence/paths.js';

// ─── Twin 정책 SSOT ────────────────────────────────────────────────────────

export type TwinKey = 'AGGRESSIVE' | 'DISCIPLINED' | 'EQUAL_WEIGHT';

export interface TwinPolicy {
  key: TwinKey;
  label: string;
  /** 본 Twin 의 진입 최소 Gate Score */
  minGateScore: number;
  /** 사이즈 결정 — KELLY 는 호출자가 주입한 weight 사용, EQUAL 은 1/N 균등 */
  sizingMode: 'KELLY' | 'EQUAL';
}

export const TWIN_POLICIES: Record<TwinKey, TwinPolicy> = {
  AGGRESSIVE:   { key: 'AGGRESSIVE',   label: 'Gate ≥14 모두 진입 (Kelly)',     minGateScore: 14, sizingMode: 'KELLY' },
  DISCIPLINED:  { key: 'DISCIPLINED',  label: 'Gate ≥22 만 진입 (Kelly)',       minGateScore: 22, sizingMode: 'KELLY' },
  EQUAL_WEIGHT: { key: 'EQUAL_WEIGHT', label: 'Gate ≥18 + 균등 비중',            minGateScore: 18, sizingMode: 'EQUAL' },
};

export const ALL_TWIN_KEYS: TwinKey[] = ['AGGRESSIVE', 'DISCIPLINED', 'EQUAL_WEIGHT'];

/** 30일 horizon (캘린더 일) */
export const TWIN_HORIZON_DAYS = 30;
/** EQUAL_WEIGHT 의 균등 사이즈 (10%) */
export const TWIN_EQUAL_WEIGHT = 0.10;
/** FIFO trim hard cap */
export const TWIN_PORTFOLIO_MAX = 1500;
/** 4주 연속 우월 시 promotion 트리거 */
export const PROMOTION_CONSECUTIVE_WEEKS = 4;

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface TwinEntry {
  id: string;
  twin: TwinKey;
  stockCode: string;
  stockName: string;
  /** YYYY-MM-DD KST */
  signalDate: string;
  signalGateScore: number;
  entryPrice: number;
  /** 0~1 (1.0 = full Kelly, 0.10 = 균등 weight 등) */
  positionWeight: number;
  /** 캘린더 30일 후 자동 종결 (YYYY-MM-DD) */
  trackUntil: string;
  currentReturnPct?: number;
  lastUpdatedAt?: string;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitDate?: string;
}

export interface TwinCandidateInput {
  stockCode: string;
  stockName: string;
  signalDate: string;        // YYYY-MM-DD KST
  gateScore: number;
  entryPrice: number;
  /** Kelly 기반 사이즈 — 호출자가 주입 (KELLY 모드 Twin 이 사용). 0~1 */
  kellyWeight: number;
}

export interface TwinStats {
  twin: TwinKey;
  activeCount: number;
  closedCount: number;
  /** 종결 entry 의 평균 수익률 (%) — 사이즈 가중 */
  avgReturnPct: number;
  /** 종결 entry 의 누적 수익률 (%) — 사이즈 가중 ∏(1 + r×w/100) - 1 */
  cumReturnPct: number;
  /** 단순 Sharpe proxy: avg / stddev (표본 부족 시 0) */
  weeklySharpeProxy: number;
}

export interface TwinComparisonResult {
  perTwin: Record<TwinKey, TwinStats>;
  realCumReturnPct: number;
  /**
   * 각 Twin 이 real 보다 cumReturnPct 우월하면 true — 호출자가 4주 누적.
   * 단, 종결 거래 0건(closedCount=0) twin 은 증거 부재이므로 항상 false
   * (real 이 음수일 때 0 > 음수 로 거짓 우월 판정되던 버그 차단).
   */
  weekWinning: Record<TwinKey, boolean>;
}

// ─── 영속 헬퍼 ──────────────────────────────────────────────────────────────

function loadEntries(): TwinEntry[] {
  ensureDataDir();
  if (!fs.existsSync(TWIN_PORTFOLIO_FILE)) return [];
  try {
    const raw = fs.readFileSync(TWIN_PORTFOLIO_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TwinEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: TwinEntry[]): void {
  ensureDataDir();
  const trimmed = entries.slice(-TWIN_PORTFOLIO_MAX);
  fs.writeFileSync(TWIN_PORTFOLIO_FILE, JSON.stringify(trimmed, null, 2));
}

function addCalendarDays(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

// ─── 핵심 API ────────────────────────────────────────────────────────────────

/**
 * 신호 1건이 들어오면 각 Twin 정책 평가 후 통과한 Twin 만 entry 영속.
 * 동일 (stockCode + signalDate + twin) 활성 entry 가 이미 있으면 중복 무시.
 *
 * @returns 신규 추가된 entry 수 (0~3)
 */
export function recordTwinEntries(candidate: TwinCandidateInput): number {
  if (!Number.isFinite(candidate.entryPrice) || candidate.entryPrice <= 0) return 0;
  if (!Number.isFinite(candidate.gateScore) || candidate.gateScore <= 0) return 0;

  const entries = loadEntries();
  let added = 0;

  for (const twinKey of ALL_TWIN_KEYS) {
    const policy = TWIN_POLICIES[twinKey];
    if (candidate.gateScore < policy.minGateScore) continue;

    const dupKey = `${candidate.stockCode}|${candidate.signalDate}|${twinKey}`;
    const exists = entries.some(
      e => !e.status || e.status === 'OPEN'
        ? `${e.stockCode}|${e.signalDate}|${e.twin}` === dupKey
        : false,
    );
    if (exists) continue;

    const positionWeight = policy.sizingMode === 'EQUAL'
      ? TWIN_EQUAL_WEIGHT
      : Math.max(0, Math.min(1, candidate.kellyWeight));

    entries.push({
      id: `twin-${Date.now()}-${twinKey}-${candidate.stockCode}`,
      twin: twinKey,
      stockCode: candidate.stockCode,
      stockName: candidate.stockName,
      signalDate: candidate.signalDate,
      signalGateScore: candidate.gateScore,
      entryPrice: candidate.entryPrice,
      positionWeight: Number(positionWeight.toFixed(4)),
      trackUntil: addCalendarDays(candidate.signalDate, TWIN_HORIZON_DAYS),
      status: 'OPEN',
    });
    added++;
  }

  if (added > 0) saveEntries(entries);
  return added;
}

export interface RefreshTwinOptions {
  now?: Date;
  priceFetcher?: (code: string) => Promise<number | null>;
}

/**
 * 활성 entry 의 currentReturnPct 갱신 + trackUntil 만료 종결.
 * 만료 시 마지막 갱신된 currentReturnPct 가 그대로 exitPrice/returnPct 로 영속.
 */
export async function refreshTwinPortfolio(
  opts: RefreshTwinOptions = {},
): Promise<{ updated: number; closed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const fetcher = opts.priceFetcher ?? fetchCurrentPrice;

  const entries = loadEntries();
  let updated = 0;
  let closed = 0;
  let skipped = 0;

  // 동일 stockCode 가 여러 Twin 에 있을 수 있으므로 가격 조회는 1회로 캐시
  const priceCache = new Map<string, number | null>();

  for (const e of entries) {
    if (e.status !== 'OPEN') continue;
    if (e.trackUntil && today > e.trackUntil) {
      e.status = 'CLOSED';
      e.exitDate = today;
      if (typeof e.currentReturnPct === 'number') {
        e.exitPrice = Number((e.entryPrice * (1 + e.currentReturnPct / 100)).toFixed(2));
      }
      closed++;
      continue;
    }
    try {
      let price = priceCache.get(e.stockCode);
      if (price === undefined) {
        price = await fetcher(e.stockCode);
        priceCache.set(e.stockCode, price);
      }
      if (price == null || price <= 0 || e.entryPrice <= 0) {
        skipped++;
        continue;
      }
      e.currentReturnPct = Number(
        (((price - e.entryPrice) / e.entryPrice) * 100).toFixed(2),
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

// ─── 통계 + 비교 ─────────────────────────────────────────────────────────────

function computeTwinStats(twin: TwinKey, entries: TwinEntry[]): TwinStats {
  const own = entries.filter(e => e.twin === twin);
  const closed = own.filter(e => e.status === 'CLOSED' &&
                                 typeof e.currentReturnPct === 'number');
  const active = own.filter(e => e.status === 'OPEN');

  // 사이즈 가중 평균
  const totalWeight = closed.reduce((s, e) => s + e.positionWeight, 0);
  const avgReturnPct = totalWeight > 0
    ? closed.reduce((s, e) => s + (e.currentReturnPct ?? 0) * e.positionWeight, 0) / totalWeight
    : 0;

  // 누적 수익률 — 사이즈 가중 복리
  // ∏(1 + r×w/100) - 1 — w 가 작으면 영향 작음. 단순화: r×w 합산을 percentage 로 적용
  let cumProduct = 1;
  for (const e of closed) {
    const r = (e.currentReturnPct ?? 0) / 100;
    cumProduct *= (1 + r * e.positionWeight);
  }
  const cumReturnPct = (cumProduct - 1) * 100;

  // Sharpe proxy
  let sharpe = 0;
  if (closed.length >= 2) {
    const returns = closed.map(e => e.currentReturnPct ?? 0);
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
    const stddev = Math.sqrt(variance);
    sharpe = stddev > 0 ? mean / stddev : 0;
  }

  return {
    twin,
    activeCount: active.length,
    closedCount: closed.length,
    avgReturnPct: Number(avgReturnPct.toFixed(2)),
    cumReturnPct: Number(cumReturnPct.toFixed(2)),
    weeklySharpeProxy: Number(sharpe.toFixed(3)),
  };
}

/**
 * Twin 별 통계 + Real 비교. weekWinning 은 Twin cumReturnPct > realCumReturnPct
 * 인 경우 true. 호출자가 4주 누적해서 promotionTriggered 판정.
 */
export function compareTwinsVsReal(realCumReturnPct: number): TwinComparisonResult {
  const entries = loadEntries();
  const perTwin = {} as Record<TwinKey, TwinStats>;
  const weekWinning = {} as Record<TwinKey, boolean>;

  for (const twin of ALL_TWIN_KEYS) {
    const stats = computeTwinStats(twin, entries);
    perTwin[twin] = stats;
    // 불변식 #2 정합 — 증거(종결 거래) 가 없는 twin 은 "우월" 로 판정하지 않는다.
    // 종결 0건이면 cumReturnPct=0 인데, real 이 음수(예: -53.35%)면 0 > -53.35 = true 로
    // 데이터 없는 twin 이 거짓 우월(✅)·promotion 후보로 표시되던 버그 차단.
    // 빈 데이터를 긍정 신호로 변환 금지(데이터 부재 ≠ 우월).
    weekWinning[twin] = stats.closedCount > 0 && stats.cumReturnPct > realCumReturnPct;
  }

  return {
    perTwin,
    realCumReturnPct: Number(realCumReturnPct.toFixed(2)),
    weekWinning,
  };
}

/**
 * 4주 연속 우월 판정 — 호출자가 weekWinning 결과를 4주 누적해 전달.
 * @param history 길이 ≥ 1 의 weekWinning 배열 (오래된 → 최신)
 */
export function detectPromotion(
  history: Record<TwinKey, boolean>[],
): TwinKey | null {
  if (history.length < PROMOTION_CONSECUTIVE_WEEKS) return null;
  const recent = history.slice(-PROMOTION_CONSECUTIVE_WEEKS);
  for (const twin of ALL_TWIN_KEYS) {
    if (recent.every(w => w[twin] === true)) return twin;
  }
  return null;
}

/** 모든 entry 반환 (UI/디버그). */
export function getAllTwinEntries(): TwinEntry[] {
  return loadEntries();
}

/** 테스트용 reset. */
export function __resetTwinPortfolioForTests(): void {
  try {
    if (fs.existsSync(TWIN_PORTFOLIO_FILE)) {
      fs.unlinkSync(TWIN_PORTFOLIO_FILE);
    }
  } catch { /* ignore */ }
}
