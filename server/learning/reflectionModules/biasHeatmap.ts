/**
 * @responsibility 10개 편향 발동 가능성 스코어 — fill SSOT 로 Loss Aversion·Overconfidence 반영
 *
 * 10개 편향의 "발동 가능성 스코어" 를 매일 추정. 심리적 온도계.
 * 특정 편향이 3일 연속 ≥ 0.70 이면 경보.
 *
 * 스코어 계산은 "상태 증거 기반" — Gemini 호출 없이 보유 포지션·오늘 매매 기록만으로.
 *
 * 편향 ↔ 신호 매핑 (휴리스틱):
 *   REGRET_AVERSION : HIT_STOP 발동했으나 exitPrice < stopLoss 인 거래 존재 → 기계적 집행 지연 가능성
 *   ENDOWMENT       : ACTIVE 포지션 중 -3 ~ -5% 구간 보유 종목 비율 (손절선 여유, "조금만 더 보면 회복" 유혹)
 *   CONFIRMATION    : 같은 섹터 ≥ 3종목 집중 + 해당 섹터 음수 수익률 → 이론에 부합하는 증거만 취사
 *   HERDING         : 오늘 Watchlist 추가된 종목 중 52주 신고가 비율 ≥ 50%
 *   LOSS_AVERSION   : 하루 음수 종료 건수 ≥ 2 + 손절선 접근 경보(stopApproachStage≥2) 건수 ≥ 1
 *   ANCHORING       : 동일 종목에 24h 내 3회 이상 매수 시도 실패
 *   RECENCY         : 오늘 매수한 종목의 entryRegime 과 현재 regime 괴리 ≥ 1단계
 *   OVERCONFIDENCE  : 오늘 HIT_TARGET 2건 이상 + 남은 워치리스트 100% 신규 진입 시도
 *   SUNK_COST       : ACTIVE 포지션 보유 ≥ 20일 + 수익률 < -10%
 *   FOMO            : 놓친 신호(missedSignals) 수 ≥ 10 + 워치리스트 잔여 포지션 슬롯 있음
 *
 * 입력은 "이미 수집된 reflection inputs" + 현재 포지션 스냅샷.
 * 반환은 BiasScore[] — 결정적 함수 (Gemini 호출 0).
 */

import type { ServerShadowTrade, PositionFill } from '../../persistence/shadowTradeRepo.js';
import type { ServerAttributionRecord } from '../../persistence/attributionRepo.js';
import type { BiasScore, BiasType } from '../reflectionTypes.js';

export interface BiasHeatmapInputs {
  /** 장마감 시점 활성 포지션 */
  activePositions:    ServerShadowTrade[];
  /** 오늘 종료된 거래 */
  closedToday:        ServerShadowTrade[];
  /**
   * PR-17: ACTIVE 상태에서 오늘 CONFIRMED SELL fill 이 있는 포지션.
   * Loss Aversion / Overconfidence 점수가 부분매도 익절·손절을 함께 보도록 한다.
   * 없으면 기존 closedToday 기반 휴리스틱으로 폴백.
   */
  partialRealizationsToday?: Array<{
    trade: ServerShadowTrade;
    todaysSells: PositionFill[];
  }>;
  /** 오늘의 attribution */
  attributionToday:   ServerAttributionRecord[];
  /** 오늘 놓친 신호 수 */
  missedSignalCount:  number;
  /** 현재 레짐 (R2_BULL 등) */
  currentRegime?:     string;
  /** 워치리스트 규모 */
  watchlistCount:     number;
  /** 매수 가능 슬롯 수 (0 = 가득 참) */
  availableSlots:     number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function scoreRegretAversion(i: BiasHeatmapInputs): BiasScore {
  const hitStops = i.closedToday.filter((t) => t.status === 'HIT_STOP');
  const delayed = hitStops.filter((t) => t.exitPrice != null && t.stopLoss != null && t.exitPrice < t.stopLoss);
  const score = hitStops.length === 0 ? 0 : clamp01(delayed.length / hitStops.length);
  return {
    bias: 'REGRET_AVERSION',
    score: Number(score.toFixed(2)),
    evidence: `지연 손절 ${delayed.length}/${hitStops.length}건`,
  };
}

function scoreEndowment(i: BiasHeatmapInputs): BiasScore {
  // ACTIVE 중 진입가 대비 -3 ~ -5% 구간 포지션 비율
  const active = i.activePositions.filter((t) => t.status === 'ACTIVE');
  if (active.length === 0) return { bias: 'ENDOWMENT', score: 0, evidence: '활성 포지션 없음' };
  const danger = active.filter((t) => {
    const cur = t.exitPrice ?? t.shadowEntryPrice;
    const ret = (cur - t.shadowEntryPrice) / t.shadowEntryPrice;
    return ret <= -0.03 && ret > -0.05;
  });
  return {
    bias: 'ENDOWMENT',
    score: Number((danger.length / active.length).toFixed(2)),
    evidence: `보유 효과 위험 구간 ${danger.length}/${active.length}건 (-3~-5%)`,
  };
}

function scoreConfirmation(i: BiasHeatmapInputs): BiasScore {
  // 동일 sector 3건 이상 집중 (sector 필드 부재 → 종목코드 앞 2자리로 간이 대체)
  const sectorCounts = new Map<string, number>();
  for (const t of i.activePositions) {
    const sector = (t.stockCode ?? '').slice(0, 2);
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  }
  let concentrated = 0;
  for (const c of sectorCounts.values()) if (c >= 3) concentrated++;
  const score = concentrated > 0 ? Math.min(1, concentrated * 0.5) : 0;
  return {
    bias: 'CONFIRMATION',
    score: Number(score.toFixed(2)),
    evidence: `3종목+ 섹터 집중 ${concentrated}개`,
  };
}

function scoreHerding(i: BiasHeatmapInputs): BiasScore {
  // Phase 4: watchlist 상세 접근 없음 → missedSignals 규모로 간이 추정
  // 놓친 신호 ≥ 5 이면 herding 의심 (남들이 보는 종목을 다 따라가려는 시도)
  const score = i.missedSignalCount >= 5 ? clamp01(0.4 + i.missedSignalCount * 0.05) : 0;
  return {
    bias: 'HERDING',
    score: Number(score.toFixed(2)),
    evidence: `놓친 신호 ${i.missedSignalCount}건`,
  };
}

function scoreLossAversion(i: BiasHeatmapInputs): BiasScore {
  // PR-17: fill SSOT 기반으로 "오늘 손실 fill" 과 "오늘 이익 fill" 을 동시에 센다.
  // 부분 익절이 함께 있는 날엔 단순 "손실만 N건" 이 아니라 순 손실 비율로 판정해
  // 과적 편향 경보를 차단한다.
  let winFills = 0;
  let lossFills = 0;
  // 전량 청산 trade 오늘 fill
  for (const t of i.closedToday) {
    for (const f of t.fills ?? []) {
      if (f.type !== 'SELL' || f.status === 'REVERTED') continue;
      if ((f.pnl ?? 0) > 0) winFills++;
      else if ((f.pnl ?? 0) < 0) lossFills++;
    }
  }
  // 부분매도 fill (ACTIVE)
  for (const p of i.partialRealizationsToday ?? []) {
    for (const f of p.todaysSells) {
      if ((f.pnl ?? 0) > 0) winFills++;
      else if ((f.pnl ?? 0) < 0) lossFills++;
    }
  }
  // 레거시 폴백 — fills 없는 오래된 trade 대비.
  if (winFills === 0 && lossFills === 0) {
    lossFills = i.closedToday.filter((t) => (t.returnPct ?? 0) < 0).length;
    winFills  = i.closedToday.filter((t) => (t.returnPct ?? 0) > 0).length;
  }

  const approachAlerts = i.activePositions.filter((t) => (t.stopApproachStage ?? 0) >= 2).length;
  const netLosses = Math.max(0, lossFills - winFills); // 부분 익절이 손실을 상쇄
  const score = clamp01(
    netLosses >= 2 && approachAlerts >= 1
      ? 0.7 + approachAlerts * 0.1
      : netLosses * 0.2,
  );
  return {
    bias: 'LOSS_AVERSION',
    score: Number(score.toFixed(2)),
    evidence: `손실 ${lossFills}건 / 이익 ${winFills}건, 손절선 접근 ${approachAlerts}건`,
  };
}

function scoreAnchoring(i: BiasHeatmapInputs): BiasScore {
  // 동일 종목 재시도 휴리스틱 — attribution 기록에 같은 stockCode 가 여러 번 있으면 앵커링 의심
  const codeCounts = new Map<string, number>();
  for (const r of i.attributionToday) {
    codeCounts.set(r.stockCode, (codeCounts.get(r.stockCode) ?? 0) + 1);
  }
  let repeats = 0;
  for (const c of codeCounts.values()) if (c >= 3) repeats++;
  return {
    bias: 'ANCHORING',
    score: repeats > 0 ? Math.min(1, repeats * 0.6) : 0,
    evidence: `동일 종목 3회+ 재시도 ${repeats}건`,
  };
}

function scoreRecency(i: BiasHeatmapInputs): BiasScore {
  // entryRegime 과 현재 레짐 다른 포지션 비율
  if (!i.currentRegime) return { bias: 'RECENCY', score: 0, evidence: '레짐 정보 없음' };
  const mismatched = i.activePositions.filter(
    (t) => t.entryRegime && t.entryRegime !== i.currentRegime,
  );
  const total = i.activePositions.length;
  const score = total > 0 ? clamp01(mismatched.length / total) : 0;
  return {
    bias: 'RECENCY',
    score: Number(score.toFixed(2)),
    evidence: `레짐 mismatch ${mismatched.length}/${total}건`,
  };
}

function scoreOverconfidence(i: BiasHeatmapInputs): BiasScore {
  // PR-17: 부분 익절도 "오늘 이익 확정" 이므로 overconfidence 관찰 신호에 포함.
  const fullWins = i.closedToday.filter((t) => t.status === 'HIT_TARGET').length;
  const partialWinFills = (i.partialRealizationsToday ?? [])
    .flatMap((p) => p.todaysSells)
    .filter((f) => (f.pnl ?? 0) > 0).length;
  const wins = fullWins + partialWinFills;
  const overSlots = i.availableSlots === 0 && i.watchlistCount > 0; // 꽉 찬 상태에서 더 담으려는 signal
  const score = wins >= 2 && overSlots ? 0.75 : wins >= 2 ? 0.4 : 0;
  return {
    bias: 'OVERCONFIDENCE',
    score: Number(score.toFixed(2)),
    evidence: `익절 ${wins}건 (전량 ${fullWins} · 부분 ${partialWinFills}), 슬롯 ${i.availableSlots}개`,
  };
}

function scoreSunkCost(i: BiasHeatmapInputs): BiasScore {
  const now = Date.now();
  const sunk = i.activePositions.filter((t) => {
    const signalT = t.signalTime ? new Date(t.signalTime).getTime() : now;
    const daysHeld = (now - signalT) / (24 * 60 * 60 * 1000);
    const cur = t.exitPrice ?? t.shadowEntryPrice;
    const ret = (cur - t.shadowEntryPrice) / t.shadowEntryPrice;
    return daysHeld >= 20 && ret <= -0.10;
  });
  return {
    bias: 'SUNK_COST',
    score: sunk.length > 0 ? Math.min(1, sunk.length * 0.5) : 0,
    evidence: `20일+보유 & -10%↓ ${sunk.length}건`,
  };
}

function scoreFomo(i: BiasHeatmapInputs): BiasScore {
  const score = i.missedSignalCount >= 10 && i.availableSlots > 0
    ? clamp01(0.5 + i.missedSignalCount * 0.03)
    : 0;
  return {
    bias: 'FOMO',
    score: Number(score.toFixed(2)),
    evidence: `놓침 ${i.missedSignalCount}건 + 여유 슬롯 ${i.availableSlots}개`,
  };
}

export function computeBiasHeatmap(inputs: BiasHeatmapInputs): BiasScore[] {
  return [
    scoreRegretAversion(inputs),
    scoreEndowment(inputs),
    scoreConfirmation(inputs),
    scoreHerding(inputs),
    scoreLossAversion(inputs),
    scoreAnchoring(inputs),
    scoreRecency(inputs),
    scoreOverconfidence(inputs),
    scoreSunkCost(inputs),
    scoreFomo(inputs),
  ];
}

/** 최근 3일 heatmap 에서 3일 연속 score ≥ 0.70 인 편향 반환. */
export function findChronicBiases(
  recent3: Array<{ scores: BiasScore[] }>,
): BiasType[] {
  if (recent3.length < 3) return [];
  const hot: BiasType[] = [];
  const first = recent3[0].scores.filter((s) => s.score >= 0.70).map((s) => s.bias);
  for (const bias of first) {
    if (recent3.every((d) => d.scores.some((s) => s.bias === bias && s.score >= 0.70))) {
      hot.push(bias);
    }
  }
  return hot;
}
