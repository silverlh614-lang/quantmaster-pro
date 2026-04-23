/**
 * ledgerSimulator.ts — Idea 2: Parallel Universe Ledger.
 *
 * 실 진입 1 건 = 학습 샘플 3 건. 같은 매수 후보에 대해 동시에 3가지 Kelly/RR 세팅으로
 * 가상 체결하여, 3개월 후 각 universe 의 Sharpe/Profit Factor 를 비교한다. 이것은
 * 강화학습의 off-policy learning 과 동형: 현재 실행한 정책 (Universe-A) 이 최적인지
 * 다른 정책의 반사실적 성과 (B/C) 와 비교한다.
 *
 * Universe 정의:
 *   A: CONVICTION ×1.0 Kelly · TP +12% · SL -5%   (실 진입 경로와 동형)
 *   B: STANDARD   ×0.6 Kelly · TP  +8% · SL -4%   (보수적 대안)
 *   C: PROBING    ×0.25 Kelly · TP +15% · SL -6%  (탐색적 high-RR)
 *
 * 해상도: entryDate 로부터 캘린더 일 N (기본 90) 경과 시 현재가 기준으로 종결 판정.
 * 장중 종결 대비 단순 버퍼. 정확도 추구보다는 "세팅 간 상대 비교" 에 최적화.
 */

import fs from 'fs';
import { LEDGER_FILE, ensureDataDir } from '../persistence/paths.js';

export type UniverseKey = 'A' | 'B' | 'C';

export interface UniverseSetting {
  key: UniverseKey;
  label: string;
  kellyFactor: number;
  targetPct: number;    // 예: +0.12
  stopLossPct: number;  // 예: -0.05
}

export const UNIVERSE_SETTINGS: Record<UniverseKey, UniverseSetting> = {
  A: { key: 'A', label: 'CONVICTION ×1.0 TP+12% SL-5%',  kellyFactor: 1.00, targetPct:  0.12, stopLossPct: -0.05 },
  B: { key: 'B', label: 'STANDARD   ×0.6 TP+8%  SL-4%',  kellyFactor: 0.60, targetPct:  0.08, stopLossPct: -0.04 },
  C: { key: 'C', label: 'PROBING    ×0.25 TP+15% SL-6%', kellyFactor: 0.25, targetPct:  0.15, stopLossPct: -0.06 },
};

export type LedgerStatus = 'OPEN' | 'HIT_TP' | 'HIT_SL' | 'EXPIRED';

export interface LedgerEntry {
  id: string;
  /** 동일 신호의 3 universe 엔트리를 한 그룹으로 묶는 키. */
  groupId: string;
  universe: UniverseKey;
  stockCode: string;
  stockName: string;
  signalTime: string;    // ISO
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  kellyFactor: number;
  regime?: string;
  signalGrade?: string;
  /** 종결 상태 */
  status: LedgerStatus;
  /** 종결 시각 (ISO) */
  resolvedAt?: string;
  /** 종결 가격 */
  exitPrice?: number;
  /** 실현 수익률 (%) */
  returnPct?: number;
}

const MAX_RECORDS = 2000;
/** 해상도 horizon (기본 90 캘린더일). */
export const LEDGER_HORIZON_DAYS = Number(process.env.LEDGER_HORIZON_DAYS ?? '90');

function load(): LedgerEntry[] {
  ensureDataDir();
  if (!fs.existsSync(LEDGER_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as LedgerEntry[]; }
  catch { return []; }
}

function save(entries: LedgerEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(entries.slice(-MAX_RECORDS), null, 2));
}

export function loadLedgerEntries(): LedgerEntry[] {
  return load();
}

/**
 * 동일 신호에 대해 A/B/C 3 entry 를 한 번에 생성·기록. 멱등 — 같은 날 같은 종목
 * 중복 신호는 기존 groupId 가 있으면 스킵.
 */
export function recordUniverseEntries(params: {
  stockCode: string;
  stockName: string;
  entryPrice: number;
  regime?: string;
  signalGrade?: string;
  now?: Date;
}): LedgerEntry[] {
  if (!Number.isFinite(params.entryPrice) || params.entryPrice <= 0) return [];
  const now = params.now ?? new Date();
  const signalDate = now.toISOString().slice(0, 10);
  const entries = load();
  const groupId = `grp_${signalDate}_${params.stockCode}`;

  const already = entries.some(e => e.groupId === groupId);
  if (already) return [];

  const created: LedgerEntry[] = [];
  for (const key of ['A', 'B', 'C'] as const) {
    const s = UNIVERSE_SETTINGS[key];
    const entry: LedgerEntry = {
      id: `${groupId}_${key}`,
      groupId,
      universe: key,
      stockCode: params.stockCode,
      stockName: params.stockName,
      signalTime: now.toISOString(),
      entryPrice: params.entryPrice,
      targetPrice: params.entryPrice * (1 + s.targetPct),
      stopPrice:   params.entryPrice * (1 + s.stopLossPct),
      kellyFactor: s.kellyFactor,
      regime: params.regime,
      signalGrade: params.signalGrade,
      status: 'OPEN',
    };
    entries.push(entry);
    created.push(entry);
  }
  save(entries);
  return created;
}

/**
 * OPEN 엔트리를 현재가로 해상한다. TP/SL 중 먼저 도달한 것을 기록, 둘 다 미도달이면
 * horizon 경과 시 EXPIRED (현재가 기준 수익률). horizon 미경과면 유지.
 *
 * 단순화: 중간 고저는 추적하지 않고 단일 현재가로만 판정 — 세팅 간 상대 비교에만 사용.
 */
export async function resolveLedger(
  fetchPrice: (stockCode: string) => Promise<number | null>,
  now: Date = new Date(),
): Promise<{ hitTP: number; hitSL: number; expired: number }> {
  const entries = load();
  let hitTP = 0, hitSL = 0, expired = 0;

  const priceCache = new Map<string, number | null>();
  for (const e of entries) {
    if (e.status !== 'OPEN') continue;
    const elapsedDays = Math.floor((now.getTime() - new Date(e.signalTime).getTime()) / (24 * 3600 * 1000));
    const current = priceCache.has(e.stockCode)
      ? priceCache.get(e.stockCode)!
      : await fetchPrice(e.stockCode).catch(() => null);
    priceCache.set(e.stockCode, current);
    if (current == null || !Number.isFinite(current) || current <= 0) continue;

    if (current >= e.targetPrice) {
      e.status = 'HIT_TP';
      e.exitPrice = current;
      e.returnPct = ((current - e.entryPrice) / e.entryPrice) * 100;
      e.resolvedAt = now.toISOString();
      hitTP++;
    } else if (current <= e.stopPrice) {
      e.status = 'HIT_SL';
      e.exitPrice = current;
      e.returnPct = ((current - e.entryPrice) / e.entryPrice) * 100;
      e.resolvedAt = now.toISOString();
      hitSL++;
    } else if (elapsedDays >= LEDGER_HORIZON_DAYS) {
      e.status = 'EXPIRED';
      e.exitPrice = current;
      e.returnPct = ((current - e.entryPrice) / e.entryPrice) * 100;
      e.resolvedAt = now.toISOString();
      expired++;
    }
  }

  save(entries);
  return { hitTP, hitSL, expired };
}

export interface UniverseStats {
  universe: UniverseKey;
  label: string;
  closedSamples: number;
  winRate: number;
  meanReturn: number;
  stdReturn: number;
  sharpe: number;           // meanReturn / stdReturn  (일률 할인 없이 horizon-unit Sharpe)
  profitFactor: number | null;
}

/**
 * 각 universe 의 closed 샘플 통계. A vs B vs C Sharpe 비교의 기초 자료.
 */
export function getUniverseStats(): UniverseStats[] {
  const entries = load().filter(e => e.status !== 'OPEN' && typeof e.returnPct === 'number');
  const out: UniverseStats[] = [];
  for (const key of ['A', 'B', 'C'] as const) {
    const grp = entries.filter(e => e.universe === key);
    const n = grp.length;
    const returns = grp.map(e => e.returnPct!);
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r <= 0);
    const mean = n > 0 ? returns.reduce((s, x) => s + x, 0) / n : 0;
    const variance = n > 0 ? returns.reduce((s, x) => s + (x - mean) ** 2, 0) / n : 0;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? mean / std : 0;
    const sumWin = wins.reduce((s, x) => s + x, 0);
    const sumLoss = Math.abs(losses.reduce((s, x) => s + x, 0));
    const profitFactor = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? Infinity : null);
    out.push({
      universe: key,
      label: UNIVERSE_SETTINGS[key].label,
      closedSamples: n,
      winRate: n > 0 ? wins.length / n : 0,
      meanReturn: mean,
      stdReturn: std,
      sharpe,
      profitFactor,
    });
  }
  return out;
}
