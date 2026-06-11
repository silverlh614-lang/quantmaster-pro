// @responsibility ADR-0602 Phase 1 — 동일 섹터 약자→강자 교체의 shadow 집행 (약자 shadow 청산 + 신규 shadow 생성, default OFF·LIVE 무접촉).
/**
 * sameSectorShadowReplacement.ts — ADR-0602 Phase 1 집행기.
 *
 * sectorConcentrationGate 의 차단 결정(pass=false)은 **무변경** — live 주문 경로는 flag ON
 * 상태에서도 byte-equivalent 다. 교체는 오직 shadow 장부 안에서만 일어난다:
 *   ① 약자 shadow(mode==='SHADOW' 만) 청산 fill + 종결 status
 *   ② 같은 평가액으로 신규 후보 shadow 생성 (PENDING — exitEngine 의 기존
 *      backfillShadowBuyFills/ACTIVE 승급 경로가 그대로 인수)
 *   ③ 청산된 보유의 "유지했다면" counterfactual 기록 → 교체 forward(신규 shadow) 와 대조
 *
 * 가드: flag(=== 'true', default OFF) · 일일 상한 · 20분 쿨다운(markReplacement) ·
 * LIVE trade 절대 무접촉(불변식 #8) · 결손 필드는 집행 보류(불변식 #6).
 */

import {
  loadShadowTrades,
  saveShadowTrades,
  appendFill,
  getRemainingQty,
  syncPositionCache,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';
import { recordCounterfactualCase } from '../learning/counterfactualShadow.js';
import { markReplacement, type ReplacementDecision } from './tradeReplacement.js';

/** ADR-0602 Phase 1 스위치 — 정확 비교(=== 'true'), default OFF. */
export function isReplacementShadowExecuteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED === 'true';
}

/** 일일 교체 집행 상한 (0~10 정수, 무효/미설정 → 2). 0 은 사실상 OFF. */
export function resolveReplacementDailyMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRADE_REPLACEMENT_DAILY_MAX;
  if (raw === undefined || raw.trim() === '') return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 2;
}

let _dailyCount = { dateKey: '', count: 0 };

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 테스트 격리용 — 운영 경로 미사용. */
export function __resetSameSectorShadowReplacementStateForTest(): void {
  _dailyCount = { dateKey: '', count: 0 };
}

export interface ReplacementCandidateInput {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  gateScore?: number;
  sector?: string;
  targetPrice?: number;
  stopLoss?: number;
  conditionKeys?: string[];
  regime?: string;
}

export interface ShadowReplacementResult {
  executed: boolean;
  /** 미집행 사유 (집행 시 undefined). */
  skipReason?: string;
  /** 집행 요약 1줄 (텔레그램/로그 표시용). */
  summary?: string;
}

/**
 * Phase 0 제안(proposeSameSectorReplacement)이 채택한 약자를 shadow 장부에서 청산하고
 * 차단된 신규 후보를 같은 평가액의 shadow 로 생성한다. 모든 실패는 미집행(보수)으로 수렴.
 */
export function executeSameSectorShadowReplacement(params: {
  decision: ReplacementDecision;
  candidate: ReplacementCandidateInput;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): ShadowReplacementResult {
  const env = params.env ?? process.env;
  const now = params.now ?? new Date();
  if (!isReplacementShadowExecuteEnabled(env)) return { executed: false, skipReason: 'FLAG_OFF' };
  const { decision, candidate } = params;
  if (!decision.proposed || !decision.targetToExit) return { executed: false, skipReason: 'NO_PROPOSAL' };

  // 일일 상한 — KST 일자 in-memory 카운터 (재기동 리셋은 보수 방향 아님이지만 상한 2 라 영향 미미).
  const dateKey = kstDateKey(now);
  if (_dailyCount.dateKey !== dateKey) _dailyCount = { dateKey, count: 0 };
  const dailyMax = resolveReplacementDailyMax(env);
  if (_dailyCount.count >= dailyMax) return { executed: false, skipReason: `DAILY_MAX_${dailyMax}` };

  // 신규 후보의 집행 필수 필드 — 결손 시 집행 보류 (관측은 Phase 0 라인이 계속 수행).
  const candPrice = candidate.currentPrice;
  const target = candidate.targetPrice;
  const stop = candidate.stopLoss;
  if (!Number.isFinite(candPrice) || candPrice <= 0) return { executed: false, skipReason: 'CANDIDATE_PRICE_MISSING' };
  if (!Number.isFinite(target) || !Number.isFinite(stop) || !(stop! < candPrice && candPrice < target!)) {
    return { executed: false, skipReason: 'CANDIDATE_PLAN_MISSING' };
  }

  const weak = decision.targetToExit;
  const trades = loadShadowTrades();

  // LIVE 무접촉 — mode==='SHADOW' 인 open trade 만 교체 대상 (불변식 #8: 실거래 ≠ shadow).
  const held = trades.find(
    (t) => t.stockCode === weak.stockCode && t.mode === 'SHADOW' && isOpenShadowStatus(t.status),
  );
  if (!held) return { executed: false, skipReason: 'HELD_SHADOW_NOT_FOUND_OR_LIVE' };
  if (trades.some((t) => t.stockCode === candidate.stockCode && isOpenShadowStatus(t.status))) {
    return { executed: false, skipReason: 'CANDIDATE_ALREADY_OPEN' };
  }

  const qty = getRemainingQty(held);
  const exitPrice = Number.isFinite(weak.currentPrice) && weak.currentPrice > 0 ? weak.currentPrice : held.shadowEntryPrice;
  if (qty <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    return { executed: false, skipReason: 'HELD_QTY_OR_PRICE_INVALID' };
  }

  // ① 약자 shadow 전량 청산 — 기존 종결 status 어휘(HIT_TARGET/HIT_STOP) 재사용,
  //    학습 구분은 exitRuleTag='SECTOR_REPLACEMENT_EXIT' (자동 평가 루프 비선택, 외부 주입 전용).
  const entryPrice = held.shadowEntryPrice;
  const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  const nowIso = now.toISOString();
  // subType 의도적 생략 — 'FULL_CLOSE' 는 outcome resolver 들이 목표달성으로 휴리스틱 분류해
  // 학습 라벨을 오염시킨다. 교체 청산은 시장 외 사유 → exitRuleTag 로만 식별.
  appendFill(held, {
    type: 'SELL',
    qty,
    price: exitPrice,
    pnl: Math.round((exitPrice - entryPrice) * qty),
    pnlPct: Math.round(pnlPct * 100) / 100,
    reason: `동일섹터 강자 교체(ADR-0602 Phase1) → ${candidate.stockName}`,
    exitRuleTag: 'SECTOR_REPLACEMENT_EXIT',
    timestamp: nowIso,
    status: 'CONFIRMED',
    confirmedAt: nowIso,
  });
  held.status = pnlPct >= 0 ? 'HIT_TARGET' : 'HIT_STOP';
  held.exitRuleTag = 'SECTOR_REPLACEMENT_EXIT';
  held.exitPrice = exitPrice;
  held.exitTime = nowIso;
  held.returnPct = Math.round(pnlPct * 100) / 100;
  held.finalExitReason = `SECTOR_REPLACEMENT_EXIT → ${candidate.stockCode}`;
  syncPositionCache(held);

  // ② 신규 후보 shadow 생성 — 청산 평가액 재배치. PENDING 으로 두면 exitEngine 의 기존
  //    SHADOW 승급(ACTIVE)·backfillShadowBuyFills 경로가 정상 인수한다.
  const newQty = Math.max(1, Math.floor((qty * exitPrice) / candPrice));
  const replacement: ServerShadowTrade = {
    id: `replace_${now.getTime()}_${candidate.stockCode}`,
    stockCode: candidate.stockCode,
    stockName: candidate.stockName,
    signalTime: nowIso,
    signalPrice: candPrice,
    shadowEntryPrice: candPrice,
    entryPriceRaw: candPrice,
    cumulativeAdjustmentFactor: 1.0,
    quantity: newQty,
    originalQuantity: newQty,
    stopLoss: stop!,
    hardStopLoss: stop!,
    targetPrice: target!,
    status: 'PENDING',
    mode: 'SHADOW',
    ...(candidate.sector ? { sector: candidate.sector } : {}),
    ...(candidate.gateScore !== undefined ? { entryGateScore: candidate.gateScore } : {}),
    ...(candidate.regime ? { entryRegime: candidate.regime } : {}),
    watchlistSource: 'INTRADAY',
    trailingHighWaterMark: candPrice,
    trailingEnabled: false,
  };
  trades.push(replacement);
  saveShadowTrades(trades);

  // ③ "유지했다면" counterfactual — 교체 forward(신규 shadow 자체 추적) 와의 대조 기준.
  try {
    recordCounterfactualCase({
      stockCode: weak.stockCode,
      stockName: weak.stockName,
      priceAtSignal: exitPrice,
      gateScore: weak.gateScore ?? 0,
      regime: candidate.regime ?? 'UNKNOWN',
      conditionKeys: [],
      skipReason: 'SECTOR_REPLACEMENT_EXITED',
      blockedReason: 'SECTOR_REPLACEMENT_EXITED',
    });
  } catch (error) {
    console.warn(`[ADR-0602 P1] 유지-counterfactual 기록 실패(집행 무영향): ${String(error)}`);
  }

  markReplacement(weak.stockCode, now.getTime());
  markReplacement(candidate.stockCode, now.getTime());
  _dailyCount.count += 1;

  const summary =
    `${weak.stockName}(${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%) 청산 → ` +
    `${candidate.stockName} ${newQty}주 shadow 진입 (일일 ${_dailyCount.count}/${dailyMax})`;
  console.info(`[ADR-0602 P1] shadow 교체 집행 — ${summary} executionImpact=SHADOW_ONLY`);
  return { executed: true, summary };
}
