// @responsibility ADR-0173 §2 ShadowLearningOnlyScan — 매매 금지일 가상 매수 판단 학습 SSOT
/**
 * shadowLearningOnlyScan.ts (ADR-0173 §2) — blocked-day shadow learning SSOT.
 *
 * 매매 금지일 (FOMC/VIX/R0/R1/Liquidity/Manual/KRX_HOLIDAY_REPLAY/RISK_OFF_REGIME) 에도
 * **실제 주문 없이** Shadow 판단 샘플 생성 — 학습 채널 단절 차단.
 *
 * Active MVP wiring:
 *   - signalScanner blocked-day helper is the only production caller.
 *   - entryEngine / exitEngine remain isolated.
 *   - LIVE activation remains impossible here because allowRealOrder must be false.
 *
 * 안전 invariant 5종 (ADR-0173 §3, ARCHITECTURE.md):
 *   1. LIVE 매매 본체 0줄 변경
 *   2. KIS 주문 함수 import 0건 — `placeKisMarketOrder` / `placeKisSellOrder` 등 모두 정적 grep 가드
 *   3. `allowRealOrder=true` runtime throw + literal type 2중 강제
 *   4. ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED` default OFF (`=== 'true'` 정확 비교)
 *   5. blocked-day caller wiring only; no LIVE order dispatch.
 *
 * Candidate scoring is conservative MVP logic; richer scoring can replace it later.
 * This module persists conservative shadow-only signals for blocked days.
 */

import {
  appendShadowLearningOnlySignal,
  loadShadowLearningOnlySignals,
} from '../persistence/shadowLearningOnlySignalRepo.js';
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { getScreenerCache, type ScreenedStock } from '../screener/stockScreener.js';
import type {
  DataQualityBucket,
  SupplyHealthSnapshot,
  TradingSignal,
} from '../learning/supplyHealthLearning.js';
import { applySupplyHealthToSignal } from '../learning/supplyHealthLearning.js';

// ─── 타입 SSOT ────────────────────────────────────────────────────────────────

/**
 * 매매 차단 사유 — 사용자 §2 명세 직접 정합 (8 union).
 *
 * Phase 2 wiring 시 5 early-return → 본 enum 매핑:
 *   - `R6_DEFENSE` (signalScanner.ts:313) → `R0_CRISIS`
 *   - `vixGating.noNewEntry` (signalScanner.ts:326) → `VIX_SPIKE`
 *   - `fomcProximity.noNewEntry` (signalScanner.ts:359) → `FOMC_BLOCK`
 *   - `regimeSetbackBlock` → `RISK_OFF_REGIME`
 *   - 운영자 emergency → `MANUAL_BLOCK`
 *   - 거래대금 / 시총 임계 미달 → `LIQUIDITY_BLOCK`
 *   - KRX 휴장일 다음 영업일 missed-learning replay → `KRX_HOLIDAY_REPLAY`
 *   - regime R1_DEFENSIVE → `R1_DEFENSIVE`
 *   - R3 sanity latch → `R3_SANITY_BLOCK`
 */
export type ShadowLearningOnlyScanReason =
  | 'FOMC_BLOCK'
  | 'VIX_SPIKE'
  | 'RISK_OFF_REGIME'
  | 'R0_CRISIS'
  | 'R1_DEFENSIVE'
  | 'KRX_HOLIDAY_REPLAY'
  | 'LIQUIDITY_BLOCK'
  | 'MANUAL_BLOCK'
  | 'R3_SANITY_BLOCK';

export interface ShadowLearningOnlyScanInput {
  /**
   * 의무 — `false` literal type. `true` 또는 미전달 시 즉시 throw (LIVE 주문 격리 invariant).
   *
   * 컴파일 시점 + runtime 2중 강제:
   *   - TypeScript literal type — `true` 컴파일 fail
   *   - runtime — `as any` 캐스팅 우회 차단
   */
  allowRealOrder: false;
  /** 의무 — 호출자가 *매크로 게이트 우회 의도* 명시 (boolean). */
  bypassMacroEntryBlock: boolean;
  reason: ShadowLearningOnlyScanReason;
  /** YYYY-MM-DD KST. */
  scanDate: string;
  /** Optional supply_health snapshot captured at decision time for self-validation learning. */
  supplyHealthSnapshot?: SupplyHealthSnapshot;
}

/**
 * 영속 schema — 사용자 §2 명세 15+ 필드.
 *
 * 1/3/5/20일 후 future return 은 Phase 2 resolve cron 이 갱신.
 * outcome 은 future return 산출 후 분류 (WIN/LOSS/BE/PENDING).
 */
export interface ShadowLearningOnlySignal {
  symbol: string;
  signalDate: string;
  blockedReason: ShadowLearningOnlyScanReason;
  wouldHaveBought: boolean;
  hypotheticalEntryPrice: number;
  hypotheticalStopLoss: number;
  hypotheticalTargetPrice: number;
  signalGrade: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'NONE';
  gateScore: number;
  regime: string;
  macroBlockReason: string;
  dataQualityStatus: 'OK' | 'STALE' | 'INVALID';
  futureReturn1d?: number;
  futureReturn3d?: number;
  futureReturn5d?: number;
  futureReturn20d?: number;
  outcome?: 'WIN' | 'LOSS' | 'BE' | 'PENDING';
  /** supply_health 기반 자기학습 확장 메타. 기존 샘플 호환을 위해 optional. */
  rawSignal?: TradingSignal;
  finalSignal?: TradingSignal;
  dataConfidence?: number;
  dataQualityBucket?: DataQualityBucket;
  supplyHealthSnapshot?: SupplyHealthSnapshot;
  wasDowngradedBySupplyHealth?: boolean;
  downgradeReasons?: string[];
}

export type ShadowLearningOnlyScanResult =
  | { skipped: true; reason: 'ENV_DISABLED' }
  | {
      skipped: false;
      reason: ShadowLearningOnlyScanReason;
      candidates: number;
      wouldBuyCount: number;
      signalsRecorded: number;
    };

interface ShadowScanCandidate {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  gateScore: number;
  signalGrade: ShadowLearningOnlySignal['signalGrade'];
  dataQualityStatus: ShadowLearningOnlySignal['dataQualityStatus'];
  regime: string;
  source: 'WATCHLIST' | 'SCREENER';
  wouldHaveBought: boolean;
}

// ─── ENV 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED` default ON (운영자 명시 활성화 결정 — PR-P0-Activation, 2026-05-06).
 *   - `'false'` 정확 비교 시만 비활성 (ADR-0157 정확 비교 의무)
 *   - 미설정 / `'true'` / 빈 문자열 / 임의 truthy 모두 default ON
 *   - 회귀 발견 시 ENV `=false` 1줄 즉시 롤백 → ADR-0173 default OFF 동작 복원
 */
export function isShadowLearningOnBlockedDaysEnabled(): boolean {
  return process.env.SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED !== 'false';
}

function finitePositive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeGateScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function gradeFromGateScore(gateScore: number): ShadowLearningOnlySignal['signalGrade'] {
  if (gateScore >= 9) return 'STRONG_BUY';
  if (gateScore >= 5) return 'BUY';
  if (gateScore > 0) return 'WATCH';
  return 'NONE';
}

function tradingSignalFromGrade(signalGrade: ShadowLearningOnlySignal['signalGrade']): TradingSignal {
  if (signalGrade === 'NONE') return 'NO_DECISION';
  return signalGrade;
}

function buildFromWatchlist(entry: WatchlistEntry): ShadowScanCandidate | null {
  const entryPrice = finitePositive(entry.entryPrice);
  if (entryPrice === null) return null;

  const rawStop = finitePositive(entry.stopLoss);
  const rawTarget = finitePositive(entry.targetPrice);
  const stopLoss = rawStop !== null && rawStop < entryPrice
    ? rawStop
    : Math.round(entryPrice * 0.92);
  const targetPrice = rawTarget !== null && rawTarget > entryPrice
    ? rawTarget
    : Math.round(entryPrice * 1.2);
  const gateScore = normalizeGateScore(entry.gateScore);
  const section = entry.section ?? (entry.track === 'B' ? 'SWING' : 'MOMENTUM');
  const signalGrade = gradeFromGateScore(gateScore);

  return {
    symbol: entry.code,
    entryPrice,
    stopLoss,
    targetPrice,
    gateScore,
    signalGrade,
    dataQualityStatus: entry.isDataQuarantined ? 'STALE' : 'OK',
    regime: entry.entryRegime ?? 'UNKNOWN',
    source: 'WATCHLIST',
    wouldHaveBought: section === 'SWING' || section === 'CATALYST' || gateScore >= 8,
  };
}

function estimateScreenerGateScore(stock: ScreenedStock): number {
  let score = 0;
  if (stock.changeRate >= 0 && stock.changeRate < 8) score += 2;
  if (stock.volume >= 50_000) score += 2;
  if (stock.foreignNetBuy > 0) score += 2;
  if (stock.per > 0 && stock.per <= 30) score += 1;
  if (stock.turnoverRate > 0) score += 1;
  return score;
}

function buildFromScreener(stock: ScreenedStock): ShadowScanCandidate | null {
  const entryPrice = finitePositive(stock.currentPrice);
  if (entryPrice === null) return null;

  const gateScore = estimateScreenerGateScore(stock);
  return {
    symbol: stock.code,
    entryPrice,
    stopLoss: Math.round(entryPrice * 0.92),
    targetPrice: Math.round(entryPrice * 1.2),
    gateScore,
    signalGrade: gradeFromGateScore(gateScore),
    dataQualityStatus: 'OK',
    regime: 'UNKNOWN',
    source: 'SCREENER',
    wouldHaveBought: gateScore >= 5,
  };
}

function loadShadowScanCandidates(): ShadowScanCandidate[] {
  const bySymbol = new Map<string, ShadowScanCandidate>();

  for (const entry of loadWatchlist()) {
    const candidate = buildFromWatchlist(entry);
    if (candidate && !bySymbol.has(candidate.symbol)) bySymbol.set(candidate.symbol, candidate);
  }

  if (bySymbol.size === 0) {
    for (const stock of getScreenerCache().slice(0, 30)) {
      const candidate = buildFromScreener(stock);
      if (candidate && !bySymbol.has(candidate.symbol)) bySymbol.set(candidate.symbol, candidate);
    }
  }

  return Array.from(bySymbol.values()).slice(0, 30);
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * 매매 금지일 가상 매수 판단 — 학습 전용 SSOT.
 *
 * Active MVP: load watchlist or screener-cache candidates, compute a conservative
 * would-have-bought signal, and persist ShadowLearningOnlySignal rows for labels.
 *
 * 안전 invariant:
 *   - `allowRealOrder !== false` → throw (LIVE 주문 격리 invariant)
 *   - ENV OFF → skipped 즉시 반환
 *   - KIS 주문 함수 호출 0건 (정적 grep 가드 회귀 테스트로 강제)
 *
 * @returns candidate counts and persisted shadow-only signal count.
 */
export async function runShadowLearningOnlyScan(
  input: ShadowLearningOnlyScanInput,
): Promise<ShadowLearningOnlyScanResult> {
  // 안전 invariant — runtime throw (literal type 우회 차단)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (input.allowRealOrder !== false) {
    throw new Error(
      `[ShadowLearningOnlyScan] allowRealOrder=false invariant violated (received: ${String(
        (input as { allowRealOrder?: unknown }).allowRealOrder,
      )}). LIVE 주문 경로 격리 — ADR-0173 §3.`,
    );
  }

  // ENV gate — default OFF
  if (!isShadowLearningOnBlockedDaysEnabled()) {
    return { skipped: true, reason: 'ENV_DISABLED' };
  }

  // bypassMacroEntryBlock 명시 검증 (boolean 의무) — 호출자 의도 명시
  if (typeof input.bypassMacroEntryBlock !== 'boolean') {
    throw new Error(
      `[ShadowLearningOnlyScan] bypassMacroEntryBlock 은 boolean 의무 (received: ${typeof input.bypassMacroEntryBlock}). 호출자 의도 명시 — ADR-0173 §2.3.`,
    );
  }

  const candidates = loadShadowScanCandidates();
  const existingKeys = new Set(
    loadShadowLearningOnlySignals().map((s) =>
      `${s.symbol}:${s.signalDate.slice(0, 10)}:${s.blockedReason}`,
    ),
  );

  let wouldBuyCount = 0;
  let signalsRecorded = 0;

  for (const candidate of candidates) {
    if (candidate.wouldHaveBought) wouldBuyCount++;

    const key = `${candidate.symbol}:${input.scanDate}:${input.reason}`;
    if (existingKeys.has(key)) continue;

    const rawSignal = tradingSignalFromGrade(candidate.signalGrade);
    const healthDecision = input.supplyHealthSnapshot
      ? applySupplyHealthToSignal({
          rawSignal,
          rawScore: candidate.gateScore,
          positionSize: candidate.wouldHaveBought ? 1 : 0,
          supplyHealthSnapshot: input.supplyHealthSnapshot,
        })
      : null;

    appendShadowLearningOnlySignal({
      symbol: candidate.symbol,
      signalDate: input.scanDate,
      blockedReason: input.reason,
      wouldHaveBought: candidate.wouldHaveBought,
      hypotheticalEntryPrice: candidate.entryPrice,
      hypotheticalStopLoss: candidate.stopLoss,
      hypotheticalTargetPrice: candidate.targetPrice,
      signalGrade: candidate.signalGrade,
      gateScore: candidate.gateScore,
      regime: candidate.regime,
      macroBlockReason: `${input.reason}:${candidate.source}`,
      dataQualityStatus: candidate.dataQualityStatus,
      outcome: 'PENDING',
      ...(healthDecision ? {
        rawSignal,
        finalSignal: healthDecision.finalSignal,
        dataConfidence: healthDecision.dataConfidence,
        dataQualityBucket: healthDecision.dataQualityBucket,
        supplyHealthSnapshot: input.supplyHealthSnapshot,
        wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
        downgradeReasons: healthDecision.downgradeReasons,
      } : {}),
    });
    existingKeys.add(key);
    signalsRecorded++;
  }

  return {
    skipped: false,
    reason: input.reason,
    candidates: candidates.length,
    wouldBuyCount,
    signalsRecorded,
  };
}
