/**
 * @responsibility 종목별 슬리피지 이력 영속 — Order Type Optimizer 학습 입력
 *
 * ADR-0031 (PR-O): 클라이언트 useSlippageStore 의 서버 측 미러. entryEngine /
 * fillMonitor 가 체결 발생 시 recordSlippageEntry() 호출 (wiring 후속 PR).
 * 본 모듈은 영속 CRUD + 통계만 — 의사결정은 orderTypeOptimizer 가 담당.
 */
import fs from 'fs';
import { SLIPPAGE_HISTORY_FILE, ensureDataDir } from './paths.js';

export type SlippageOrderType = 'IOC_MARKET' | 'LIMIT' | 'AGGRESSIVE_LIMIT';

export interface SlippageHistoryEntry {
  id: string;
  stockCode: string;
  /** 신호 발생 시각 (ISO) */
  signalTime: string;
  /** 신호 발생 시점 가격 (theoretical) */
  theoreticalPrice: number;
  /** 실제 체결 가격 */
  executedPrice: number;
  /** (executed - theoretical) / theoretical (음수=유리한 체결, 양수=불리한 체결) */
  slippagePct: number;
  orderType: SlippageOrderType;
  /** 신호 시점 거래량 z-score (의사결정 입력으로 백피드) */
  volumeZ?: number;
  /** 신호 시점 가격 모멘텀 (% 변화) */
  priceMomentumPct?: number;
}

export const SLIPPAGE_HISTORY_MAX = 1000;

function load(): SlippageHistoryEntry[] {
  ensureDataDir();
  if (!fs.existsSync(SLIPPAGE_HISTORY_FILE)) return [];
  try {
    const raw = fs.readFileSync(SLIPPAGE_HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SlippageHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: SlippageHistoryEntry[]): void {
  ensureDataDir();
  const trimmed = entries.slice(-SLIPPAGE_HISTORY_MAX);
  fs.writeFileSync(SLIPPAGE_HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

export interface RecordSlippageInput {
  stockCode: string;
  signalTime?: string;
  theoreticalPrice: number;
  executedPrice: number;
  orderType: SlippageOrderType;
  volumeZ?: number;
  priceMomentumPct?: number;
}

/**
 * 슬리피지 이력 1건 영속. 잘못된 입력 (가격 0/음수/NaN) 은 silent skip.
 *
 * @returns 신규 추가 1, skip 0
 */
export function recordSlippageEntry(input: RecordSlippageInput): number {
  if (!Number.isFinite(input.theoreticalPrice) || input.theoreticalPrice <= 0) return 0;
  if (!Number.isFinite(input.executedPrice) || input.executedPrice <= 0) return 0;

  const slippagePct = (input.executedPrice - input.theoreticalPrice) / input.theoreticalPrice;
  if (!Number.isFinite(slippagePct)) return 0;

  const entries = load();
  entries.push({
    id: `slip-${Date.now()}-${input.stockCode}`,
    stockCode: input.stockCode,
    signalTime: input.signalTime ?? new Date().toISOString(),
    theoreticalPrice: input.theoreticalPrice,
    executedPrice: input.executedPrice,
    slippagePct: Number(slippagePct.toFixed(6)),
    orderType: input.orderType,
    volumeZ: typeof input.volumeZ === 'number' && Number.isFinite(input.volumeZ) ? input.volumeZ : undefined,
    priceMomentumPct: typeof input.priceMomentumPct === 'number' && Number.isFinite(input.priceMomentumPct) ? input.priceMomentumPct : undefined,
  });
  save(entries);
  return 1;
}

/** 모든 슬리피지 이력 (디버그/UI). */
export function loadSlippageHistory(): SlippageHistoryEntry[] {
  return load();
}

export interface SlippageStats {
  sampleSize: number;
  /** 평균 슬리피지 (소수, 0.005 = 0.5%) */
  mean: number;
  /** 중앙값 */
  p50: number;
  /** 90 분위수 */
  p90: number;
  /** orderType 별 평균 */
  byOrderType: Partial<Record<SlippageOrderType, number>>;
}

function quantile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

/**
 * 종목별 슬리피지 통계. stockCode=null 이면 전체.
 *
 * @param stockCode 종목 (null = 전체 누적)
 * @param lookback  최근 N건만 (옵셔널, 기본 모두)
 */
export function getSlippageStats(
  stockCode: string | null,
  lookback?: number,
): SlippageStats {
  let entries = load();
  if (stockCode !== null) {
    entries = entries.filter(e => e.stockCode === stockCode);
  }
  if (typeof lookback === 'number' && lookback > 0) {
    entries = entries.slice(-lookback);
  }

  if (entries.length === 0) {
    return { sampleSize: 0, mean: 0, p50: 0, p90: 0, byOrderType: {} };
  }

  const slippages = entries.map(e => e.slippagePct);
  const mean = slippages.reduce((s, v) => s + v, 0) / slippages.length;
  const p50 = quantile(slippages, 0.5);
  const p90 = quantile(slippages, 0.9);

  const byOrderType: Partial<Record<SlippageOrderType, number>> = {};
  for (const orderType of ['IOC_MARKET', 'LIMIT', 'AGGRESSIVE_LIMIT'] as SlippageOrderType[]) {
    const filtered = entries.filter(e => e.orderType === orderType).map(e => e.slippagePct);
    if (filtered.length > 0) {
      byOrderType[orderType] = Number(
        (filtered.reduce((s, v) => s + v, 0) / filtered.length).toFixed(6),
      );
    }
  }

  return {
    sampleSize: entries.length,
    mean: Number(mean.toFixed(6)),
    p50: Number(p50.toFixed(6)),
    p90: Number(p90.toFixed(6)),
    byOrderType,
  };
}

/** 테스트용 reset. */
export function __resetSlippageHistoryForTests(): void {
  try {
    if (fs.existsSync(SLIPPAGE_HISTORY_FILE)) {
      fs.unlinkSync(SLIPPAGE_HISTORY_FILE);
    }
  } catch { /* ignore */ }
}
