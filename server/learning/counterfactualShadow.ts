/**
 * counterfactualShadow.ts — Idea 4: Counterfactual Shadow Ledger.
 *
 * 신호 스캔에서 Gate 기준에 미달하여 탈락한 후보 상위 N 개를 매일 "가상 진입" 으로
 * 기록하고, 30·60·90 일 후 수익률 분포를 추적한다. 목적:
 *   - Gate 기준의 통계적 유의성 검증 (생존 편향 제거)
 *   - "통과 vs 탈락" 수익률 분포 차이가 유의하지 않다면 Gate 가 과잉이라는 증거
 *
 * 데이터 구조 (JSON, 최근 1000건 ring):
 *   CounterfactualEntry {
 *     id, stockCode, stockName, signalDate (YYYY-MM-DD),
 *     priceAtSignal, gateScore, regime, conditionKeys,
 *     skipReason,         // 왜 탈락했는가 (SKIP / GATE_UNDER / SECTOR_FULL 등)
 *     return30d/60d/90d,  // Pipe(resolveCounterfactuals) 가 나중에 채움
 *     resolvedAt,
 *   }
 *
 * 본 모듈은 "기록 + 해상도" API만 제공. Gate 를 실제 바꾸지 않는다 (분석용 관측).
 */

import fs from 'fs';
import { COUNTERFACTUAL_FILE, ensureDataDir } from '../persistence/paths.js';

export interface CounterfactualEntry {
  id: string;
  stockCode: string;
  stockName: string;
  signalDate: string;          // YYYY-MM-DD (KST)
  signalTime: string;          // ISO
  priceAtSignal: number;
  gateScore: number;
  regime: string;
  conditionKeys: string[];
  skipReason: string;
  /** 30 거래일 후 수익률 (%) — resolveCounterfactuals 가 채움 */
  return30d?: number;
  /** 60 거래일 */
  return60d?: number;
  /** 90 거래일 */
  return90d?: number;
  resolvedAt?: string;
}

const MAX_RECORDS = 1000;
/** 일별 후보 최대 추적 수 (signalScanner 호출 측이 상위 N개로 제한). */
export const COUNTERFACTUAL_DAILY_CAP = Number(process.env.COUNTERFACTUAL_DAILY_CAP ?? '5');

function load(): CounterfactualEntry[] {
  ensureDataDir();
  if (!fs.existsSync(COUNTERFACTUAL_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8')) as CounterfactualEntry[];
  } catch {
    return [];
  }
}

function save(entries: CounterfactualEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(
    COUNTERFACTUAL_FILE,
    JSON.stringify(entries.slice(-MAX_RECORDS), null, 2),
  );
}

export function loadCounterfactuals(): CounterfactualEntry[] {
  return load();
}

/**
 * 신규 탈락 후보를 기록. 같은 날 같은 종목 중복은 스킵 (멱등).
 * signalDate 는 ISO 날짜 부분(YYYY-MM-DD) 으로 정규화.
 */
export function recordCounterfactual(params: {
  stockCode: string;
  stockName: string;
  priceAtSignal: number;
  gateScore: number;
  regime: string;
  conditionKeys: string[];
  skipReason: string;
  now?: Date;
}): CounterfactualEntry | null {
  if (!Number.isFinite(params.priceAtSignal) || params.priceAtSignal <= 0) return null;
  const now = params.now ?? new Date();
  const signalDate = now.toISOString().slice(0, 10);
  const entries = load();
  const duplicate = entries.some(
    e => e.stockCode === params.stockCode && e.signalDate === signalDate,
  );
  if (duplicate) return null;

  const entry: CounterfactualEntry = {
    id: `cf_${Date.now()}_${params.stockCode}`,
    stockCode: params.stockCode,
    stockName: params.stockName,
    signalDate,
    signalTime: now.toISOString(),
    priceAtSignal: params.priceAtSignal,
    gateScore: params.gateScore,
    regime: params.regime,
    conditionKeys: params.conditionKeys,
    skipReason: params.skipReason,
  };
  entries.push(entry);
  save(entries);
  return entry;
}

/**
 * 아직 resolved 가 아닌 엔트리 중, signalDate 로부터 N 영업일 경과한 것을 찾아
 * 현재가로 수익률을 계산해 기록한다. 호출자는 현재가 fetcher (주로 fetchCurrentPrice) 를 주입.
 *
 * @param fetchPrice (code: string) => Promise<number|null>
 * @returns 해상된 엔트리 수
 */
export async function resolveCounterfactuals(
  fetchPrice: (stockCode: string) => Promise<number | null>,
  now: Date = new Date(),
): Promise<{ resolved30d: number; resolved60d: number; resolved90d: number }> {
  const entries = load();
  let r30 = 0, r60 = 0, r90 = 0;

  for (const e of entries) {
    const signalMs = new Date(e.signalTime).getTime();
    const elapsedDays = Math.floor((now.getTime() - signalMs) / (24 * 3600 * 1000));
    // 영업일 근사 — 주말 포함 캘린더일로 처리 (후속 리소스: 영업일 캐시 사용 가능)
    if (elapsedDays < 30) continue;

    const currentPrice = await fetchPrice(e.stockCode).catch(() => null);
    if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) continue;

    const ret = ((currentPrice - e.priceAtSignal) / e.priceAtSignal) * 100;

    if (elapsedDays >= 30 && e.return30d === undefined) { e.return30d = ret; r30++; }
    if (elapsedDays >= 60 && e.return60d === undefined) { e.return60d = ret; r60++; }
    if (elapsedDays >= 90 && e.return90d === undefined) { e.return90d = ret; r90++; e.resolvedAt = now.toISOString(); }
  }

  save(entries);
  return { resolved30d: r30, resolved60d: r60, resolved90d: r90 };
}

export interface CounterfactualStats {
  samples: number;
  mean: number;
  median: number;
  stdDev: number;
  winRate: number;         // returns > 0 ratio
  p25: number; p75: number;
}

/** 특정 horizon 의 수익률 분포 통계. horizon: 30 | 60 | 90 */
export function getCounterfactualStats(horizon: 30 | 60 | 90): CounterfactualStats | null {
  const entries = load();
  const key = `return${horizon}d` as 'return30d' | 'return60d' | 'return90d';
  const returns = entries
    .map(e => e[key])
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  if (returns.length === 0) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const winRate = returns.filter(r => r > 0).length / returns.length;
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];

  return { samples: returns.length, mean, median, stdDev, winRate, p25, p75 };
}
