/**
 * shadowRealDriftDetector.ts — 아이디어 10 (Phase 5): Shadow vs Real 괴리 감지.
 *
 * Shadow 모드에서 최적화된 targetPrice / stopLoss 는 실거래 실행 환경(호가
 * 스프레드, 부분 체결, 슬리피지) 과 괴리가 발생한다. 이 모듈은 동일 기간의
 * SHADOW 평균 수익률과 LIVE 평균 수익률을 비교하여 괴리가 |drift| ≥ 2%p 일 때
 * targetPrice / stopLoss 스케일 보정 계수를 업데이트한다.
 *
 *   boostTarget = 1 - drift / 2    (Real 가 낮으면 target 하향 조정)
 *   boostStop   = 1 - drift / 4    (Real 가 낮으면 stop 완화)
 *
 * 보정은 과민 반응 방지를 위해 0.90 ~ 1.10 범위로 clip.
 *
 * signalScanner 가 진입 구조를 계산할 때 이 계수를 읽어 반영한다.
 */

import fs from 'fs';
import { SHADOW_REAL_DRIFT_FILE, ensureDataDir } from '../persistence/paths.js';
import {
  loadShadowTrades,
  getWeightedPnlPct,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { computeNetPnL, applyRoundTripCostToPct } from '../trading/executionCosts.js';

const DRIFT_THRESHOLD_PCT = 2.0; // %p
const TARGET_BOOST_MIN = 0.90;
const TARGET_BOOST_MAX = 1.10;

export interface ShadowRealDriftState {
  /** 최근 계산 시각 ISO */
  updatedAt: string;
  shadowAvgReturn: number; // %
  liveAvgReturn:   number; // %
  /** liveAvg - shadowAvg (%p) — 음수 = Real 이 Shadow 보다 부진 */
  driftPct: number;
  /** signalScanner 가 targetPrice 에 곱할 계수 (0.90~1.10) */
  targetBoost: number;
  /** signalScanner 가 stopLoss 폭에 곱할 계수 (0.90~1.10) */
  stopBoost:   number;
  /** 표본 수 */
  shadowCount: number;
  liveCount:   number;
}

const DEFAULT_STATE: ShadowRealDriftState = {
  updatedAt: '',
  shadowAvgReturn: 0,
  liveAvgReturn: 0,
  driftPct: 0,
  targetBoost: 1.0,
  stopBoost: 1.0,
  shadowCount: 0,
  liveCount: 0,
};

export function loadShadowRealDrift(): ShadowRealDriftState {
  ensureDataDir();
  if (!fs.existsSync(SHADOW_REAL_DRIFT_FILE)) return { ...DEFAULT_STATE };
  try {
    return JSON.parse(fs.readFileSync(SHADOW_REAL_DRIFT_FILE, 'utf-8')) as ShadowRealDriftState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveShadowRealDrift(state: ShadowRealDriftState): void {
  ensureDataDir();
  fs.writeFileSync(SHADOW_REAL_DRIFT_FILE, JSON.stringify(state, null, 2));
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function closedReturn(trade: ServerShadowTrade): number | null {
  if (trade.status !== 'HIT_TARGET' && trade.status !== 'HIT_STOP') return null;
  // Phase 2-⑥: executionCosts 통합 — fills 가 있으면 수량 가중 net P&L 로,
  // 없으면 getWeightedPnlPct(gross) 에서 왕복 비용을 차감해 근사.
  const sells = (trade.fills ?? []).filter(f => f.type === 'SELL');
  if (sells.length > 0 && trade.shadowEntryPrice > 0) {
    let totalQty = 0;
    let totalNetPnl = 0;
    let totalEntryVal = 0;
    for (const f of sells) {
      const br = computeNetPnL({
        entryPrice: trade.shadowEntryPrice,
        exitPrice:  f.price,
        quantity:   f.qty,
        // 시장 정보 없음 → 기본 'KOSPI' (보수적으로 고비용 선택)
      });
      totalQty += f.qty;
      totalNetPnl += br.net;
      totalEntryVal += trade.shadowEntryPrice * f.qty;
    }
    if (totalEntryVal <= 0) return null;
    const netPct = (totalNetPnl / totalEntryVal) * 100;
    return Number.isFinite(netPct) ? netPct : null;
  }
  // 레거시 trade.returnPct 경로 — 왕복 비용을 일괄 차감
  const gross = getWeightedPnlPct(trade);
  if (!Number.isFinite(gross)) return null;
  return applyRoundTripCostToPct(gross, 'KOSPI', true);
}

/**
 * 최근 N일(기본 30일)의 SHADOW vs LIVE 평균 수익률을 비교하여 드리프트 상태 갱신.
 *
 * @returns 갱신된 상태
 */
export async function updateShadowRealDrift(lookbackDays = 30): Promise<ShadowRealDriftState> {
  const cutoff = Date.now() - lookbackDays * 86_400_000;
  const trades = loadShadowTrades().filter((t) => {
    if (!t.exitTime) return false;
    return new Date(t.exitTime).getTime() >= cutoff;
  });

  const shadowReturns: number[] = [];
  const liveReturns:   number[] = [];
  for (const t of trades) {
    const r = closedReturn(t);
    if (r == null) continue;
    if (t.mode === 'LIVE') liveReturns.push(r);
    else                   shadowReturns.push(r);
  }

  // 표본 최소 요건 — 양쪽 각 5건 이상
  if (shadowReturns.length < 5 || liveReturns.length < 5) {
    console.log(
      `[ShadowRealDrift] 표본 부족 (SHADOW ${shadowReturns.length} / LIVE ${liveReturns.length}) — 기존 상태 유지`,
    );
    return loadShadowRealDrift();
  }

  const shadowAvg = avg(shadowReturns);
  const liveAvg   = avg(liveReturns);
  const drift     = liveAvg - shadowAvg;

  // 괴리가 작으면 계수 1.0 유지
  // 스케일: drift -4%p 이면 targetBoost=0.9(목표 10% 하향), stopBoost=0.95(손절 5% 타이트).
  const isDrifted = Math.abs(drift) >= DRIFT_THRESHOLD_PCT;
  const targetBoost = isDrifted
    ? clamp(1 + drift / 40, TARGET_BOOST_MIN, TARGET_BOOST_MAX)
    : 1.0;
  const stopBoost = isDrifted
    ? clamp(1 + drift / 80, TARGET_BOOST_MIN, TARGET_BOOST_MAX)
    : 1.0;

  const prev = loadShadowRealDrift();
  const state: ShadowRealDriftState = {
    updatedAt: new Date().toISOString(),
    shadowAvgReturn: parseFloat(shadowAvg.toFixed(2)),
    liveAvgReturn:   parseFloat(liveAvg.toFixed(2)),
    driftPct:        parseFloat(drift.toFixed(2)),
    targetBoost:     parseFloat(targetBoost.toFixed(3)),
    stopBoost:       parseFloat(stopBoost.toFixed(3)),
    shadowCount:     shadowReturns.length,
    liveCount:       liveReturns.length,
  };
  saveShadowRealDrift(state);

  console.log(
    `[ShadowRealDrift] SHADOW ${state.shadowAvgReturn}% vs LIVE ${state.liveAvgReturn}% ` +
    `→ drift ${state.driftPct}%p, target×${state.targetBoost}, stop×${state.stopBoost}`,
  );

  // 처음 drift 발동 또는 계수가 크게 변했을 때만 텔레그램 알림
  const coeffChanged = Math.abs(state.targetBoost - prev.targetBoost) > 0.01
                    || Math.abs(state.stopBoost - prev.stopBoost) > 0.01;
  if (isDrifted && coeffChanged) {
    await sendTelegramAlert(
      `📐 <b>[Shadow↔Real 드리프트 보정]</b>\n` +
      `SHADOW 평균: ${state.shadowAvgReturn}% (${state.shadowCount}건)\n` +
      `LIVE 평균: ${state.liveAvgReturn}% (${state.liveCount}건)\n` +
      `괴리: <b>${state.driftPct >= 0 ? '+' : ''}${state.driftPct}%p</b>\n\n` +
      `신규 진입 구조 계수:\n` +
      `• targetPrice × ${state.targetBoost}\n` +
      `• stopLoss 폭 × ${state.stopBoost}\n\n` +
      `<i>SHADOW 학습 결과를 실거래 환경(슬리피지, 부분체결)에 맞춰 자동 보정.</i>`,
    ).catch(console.error);
  }

  return state;
}
