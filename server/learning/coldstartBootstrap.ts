/**
 * coldstartBootstrap.ts — Phase 3-⑨ 자기학습 콜드스타트 해결.
 *
 * recommendationTracker 가 정식 라벨(WIN/LOSS/EXPIRED) 5건 이상 축적될 때까지
 * 학습 파이프라인이 정지되던 문제를 두 트랙으로 해소한다:
 *
 *   ① Mini-Bar Proxy Labeling
 *      진입 후 30·60·120분 시점에 (currentPrice, returnPct, MAE, MFE) 스냅샷을
 *      "약한 라벨" 로 저장. 정식 라벨의 0.3배 가중치로 캘리브레이션에 투입.
 *      종결 전에도 방향성·변동성 정보를 회수한다.
 *
 *   ② Cross-Sectional Transfer
 *      신규 진입 후보와 동일 섹터·동일 gate 프로파일의 과거 종료 trade 를
 *      kNN 검색하여 Bayesian prior (mean return, variance, confidence) 를 주입.
 *      표본 부족 구간의 가중치 조정을 "유사 과거" 에 의지해 이어간다.
 *
 * 참고: 이 모듈은 순수 데이터 헬퍼이다. 호출 시점(언제 snapshot 찍을지)은
 * exitEngine 의 루프 혹은 별도 스케줄러가 `maybeCaptureSnapshots()` 를 호출해야
 * 한다. 파일 I/O 는 append-only(JSON) 로 단순 유지.
 */

import fs from 'fs';
import { COLDSTART_SNAPSHOTS_FILE, ensureDataDir } from '../persistence/paths.js';
import {
  loadShadowTrades,
  getWeightedPnlPct,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { getRealtimePrice } from '../clients/kisStreamClient.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { getSectorByCode } from '../screener/sectorMap.js';
import { safePctChange } from '../utils/safePctChange.js';

// ── Mini-Bar Proxy Labeling ─────────────────────────────────────────────────────

const SNAPSHOT_OFFSETS_MIN = [30, 60, 120] as const;
export type SnapshotOffset = typeof SNAPSHOT_OFFSETS_MIN[number];

export interface MiniBarSnapshot {
  tradeId: string;
  stockCode: string;
  capturedAt: string;            // ISO
  offsetMin: SnapshotOffset;
  entryPrice: number;
  price: number;
  returnPct: number;             // (price-entry)/entry * 100
  /** 이 snapshot 시점까지의 최대 역주행 낙폭 (Max Adverse Excursion, %) */
  mae: number;
  /** 이 snapshot 시점까지의 최대 우호 상승 (Max Favorable Excursion, %) */
  mfe: number;
  /** 약한 라벨 가중치 (정식 라벨 대비 0.3배 기본) */
  weight: number;
}

export const WEAK_LABEL_WEIGHT = 0.3;

function loadSnapshots(): MiniBarSnapshot[] {
  ensureDataDir();
  if (!fs.existsSync(COLDSTART_SNAPSHOTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(COLDSTART_SNAPSHOTS_FILE, 'utf-8')) as MiniBarSnapshot[];
  } catch {
    return [];
  }
}

function saveSnapshots(snaps: MiniBarSnapshot[]): void {
  ensureDataDir();
  // 최근 2000건만 유지 (약 6개월 × 10건/일 가정)
  fs.writeFileSync(COLDSTART_SNAPSHOTS_FILE, JSON.stringify(snaps.slice(-2000), null, 2));
}

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 60_000);
}

/**
 * 주어진 trade 에 대해 아직 기록되지 않은 offset 시점이 도래했다면 snapshot 생성.
 * 이미 해당 offset 으로 저장됐거나, 아직 도래 전이면 no-op.
 *
 * 반환: 새로 저장된 snapshot 배열 (0개 또는 여러 개).
 */
export async function maybeCaptureSnapshots(
  trade: ServerShadowTrade,
  existing?: MiniBarSnapshot[],
): Promise<MiniBarSnapshot[]> {
  if (trade.status === 'HIT_TARGET' || trade.status === 'HIT_STOP' || trade.status === 'REJECTED') {
    return [];
  }
  const elapsedMin = minutesSince(trade.signalTime);
  if (elapsedMin < SNAPSHOT_OFFSETS_MIN[0]) return [];

  const all = existing ?? loadSnapshots();
  const mine = all.filter((s) => s.tradeId === trade.id);
  const haveOffsets = new Set(mine.map((s) => s.offsetMin));

  const due = SNAPSHOT_OFFSETS_MIN.filter(
    (off) => elapsedMin >= off && !haveOffsets.has(off),
  );
  if (due.length === 0) return [];

  const currentPrice = getRealtimePrice(trade.stockCode)
    ?? await fetchCurrentPrice(trade.stockCode).catch(() => null);
  if (currentPrice == null || currentPrice <= 0) return [];

  const entry = trade.shadowEntryPrice;
  if (entry <= 0) return [];
  // ADR-0028: stale currentPrice 시 0 fallback — coldstart snapshot 학습 영속 보호.
  const returnPct = safePctChange(currentPrice, entry, {
    label: `coldstart:${trade.stockCode}`,
  }) ?? 0;

  // MAE/MFE 근사 — 이전 snapshot 들의 historical return 과 현재 return 범위에서 극값.
  const priorReturns = mine.map((s) => s.returnPct);
  const extended = [...priorReturns, returnPct];
  const mae = Math.min(0, ...extended); // 음수만 의미 있음
  const mfe = Math.max(0, ...extended);

  const newSnaps: MiniBarSnapshot[] = due.map((offsetMin) => ({
    tradeId: trade.id,
    stockCode: trade.stockCode,
    capturedAt: new Date().toISOString(),
    offsetMin,
    entryPrice: entry,
    price: currentPrice,
    returnPct: parseFloat(returnPct.toFixed(2)),
    mae: parseFloat(mae.toFixed(2)),
    mfe: parseFloat(mfe.toFixed(2)),
    weight: WEAK_LABEL_WEIGHT,
  }));

  saveSnapshots([...all, ...newSnaps]);
  return newSnaps;
}

/**
 * 열려 있는 모든 트레이드에 대해 snapshot 주기를 검사.
 * exitEngine 주기 혹은 별도 스케줄러에서 호출.
 */
export async function captureSnapshotsForOpenTrades(
  trades: ServerShadowTrade[],
): Promise<number> {
  // 조기 종료: 어떤 trade 도 30분 offset 에 도달하지 않았으면 파일 I/O 생략.
  const earliestCutoff = Date.now() - SNAPSHOT_OFFSETS_MIN[0] * 60_000;
  const anyEligible = trades.some((t) => {
    if (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP' || t.status === 'REJECTED') return false;
    const sigTime = new Date(t.signalTime).getTime();
    return Number.isFinite(sigTime) && sigTime <= earliestCutoff;
  });
  if (!anyEligible) return 0;

  const snaps = loadSnapshots();
  let count = 0;
  for (const t of trades) {
    const added = await maybeCaptureSnapshots(t, snaps);
    if (added.length > 0) {
      snaps.push(...added);
      count += added.length;
    }
  }
  return count;
}

/**
 * 콜드스타트 약한 라벨 조회 — recommendationTracker 가 정식 라벨이 5건 미만일 때
 * 보조 입력으로 사용.
 */
export function getWeakLabels(): MiniBarSnapshot[] {
  return loadSnapshots();
}

// ── Cross-Sectional Transfer (kNN prior) ────────────────────────────────────────

export interface BootstrapPrior {
  /** 표본 수 — 0 이면 prior 없음 */
  sampleSize: number;
  /** 수익률 평균 (%, net) */
  meanReturn: number;
  /** 수익률 표준편차 */
  stdDev: number;
  /** 0~1 — 표본 수와 유사도를 반영한 신뢰도 (4건 이상에서 1.0 근접) */
  confidence: number;
  /** 근사 매치 종목 상위 리스트 */
  topMatches: Array<{
    stockName: string;
    stockCode: string;
    returnPct: number;
    sector: string;
    regime: string;
    similarity: number;
  }>;
}

export interface CandidateFeatures {
  sector?: string;
  gateScore?: number;
  regime?: string;
  mtas?: number;
  profileType?: 'A' | 'B' | 'C' | 'D';
}

function similarity(cand: CandidateFeatures, past: ServerShadowTrade, pastSector: string): number {
  let score = 0;
  let max = 0;
  // 섹터 동일 → +3
  if (cand.sector && pastSector) {
    max += 3;
    if (cand.sector === pastSector) score += 3;
  }
  // 레짐 동일 → +2
  if (cand.regime && past.entryRegime) {
    max += 2;
    if (cand.regime === past.entryRegime) score += 2;
  }
  // 프로파일 동일 → +1
  if (cand.profileType && past.profileType) {
    max += 1;
    if (cand.profileType === past.profileType) score += 1;
  }
  if (max === 0) return 0;
  return score / max;
}

const SIMILARITY_MIN = 0.4;
const K = 10;

/**
 * 과거 종료 trade 중 candidate 와 유사도 ≥ SIMILARITY_MIN 인 상위 K 건을 반환.
 */
export function findSimilarClosedTrades(
  cand: CandidateFeatures,
  kLimit = K,
): Array<{ trade: ServerShadowTrade; sector: string; similarity: number; returnPct: number }> {
  const closed = loadShadowTrades().filter(
    (t) => (t.status === 'HIT_TARGET' || t.status === 'HIT_STOP') && t.exitTime,
  );
  const scored = closed
    .map((t) => {
      const sec = getSectorByCode(t.stockCode) || '미분류';
      const sim = similarity(cand, t, sec);
      const ret = getWeightedPnlPct(t) || (t.returnPct ?? 0);
      return { trade: t, sector: sec, similarity: sim, returnPct: ret };
    })
    .filter((x) => x.similarity >= SIMILARITY_MIN)
    .sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, kLimit);
}

/**
 * Cross-sectional Bayesian prior 생성. sampleSize=0 이면 사용 지양.
 */
export function buildBootstrapPrior(cand: CandidateFeatures): BootstrapPrior {
  const matches = findSimilarClosedTrades(cand);
  if (matches.length === 0) {
    return { sampleSize: 0, meanReturn: 0, stdDev: 0, confidence: 0, topMatches: [] };
  }
  const returns = matches.map((m) => m.returnPct);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.length > 1
    ? returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  // 신뢰도: 표본 수 4 건에서 0.5, 10 건 이상에서 1.0 근접 (sigmoid 근사)
  const confidence = Math.min(1, matches.length / 10);
  const topMatches = matches.slice(0, 5).map((m) => ({
    stockName: m.trade.stockName,
    stockCode: m.trade.stockCode,
    returnPct: parseFloat(m.returnPct.toFixed(2)),
    sector: m.sector,
    regime: m.trade.entryRegime ?? 'unknown',
    similarity: parseFloat(m.similarity.toFixed(2)),
  }));
  return {
    sampleSize: matches.length,
    meanReturn: parseFloat(mean.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    confidence: parseFloat(confidence.toFixed(2)),
    topMatches,
  };
}

// ── 테스트 유틸 ────────────────────────────────────────────────────────────────

/** 테스트용 — snapshot 파일 초기화. */
export function _resetColdstartSnapshots(): void {
  if (fs.existsSync(COLDSTART_SNAPSHOTS_FILE)) {
    fs.unlinkSync(COLDSTART_SNAPSHOTS_FILE);
  }
}
