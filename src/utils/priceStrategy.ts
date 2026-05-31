// @responsibility 가격 전략 — regime 가중 분할매수(눌림목) 진입 정본 헬퍼.
/**
 * 주도주 진입 = **regime 가중 분할매수**. 단일 진입가의 딜레마("현재가 추격이냐 / 눌림목
 * 기다리다 놓치냐")를 1·2·3차 분할로 푼다.
 *
 * - 가격 레벨: 1차=즉시·돌파(현재가) · 2차=얕은 눌림(현재가~20일선 중간) · 3차=20일선 눌림목
 *   (`disparity20` 이격도로 역산, 되돌림 0~15% clamp).
 * - 비중(weight): **시장 regime(marketPhase)으로 가중** — 강세는 즉시 비중↑(모멘텀), 약세는
 *   깊은 눌림 비중↑(방어). "가버리면 1차로 타고, 눌리면 더 담는다".
 * - 목표/손절: AI 의 R:R 비율을 가중평균 진입가 기준으로 재계산.
 *
 * 20일선이 현재가 근처(되돌림 여력<1%)면 단일 진입(현재가, multiTranche=false).
 * 저장된 L4 AI 레벨 stale 문제를 현재가+이격도+regime 으로 동적 산출해 해소. 표시 전용.
 */
import type { TranchePlan } from '../types/core';

export interface TrancheLevel {
  price: number;
  /** 비중 % (3개 합 100). */
  weight: number;
  role: string;
}

export interface TranchePlanResult {
  /** 1~3개 (1차→3차). */
  levels: TrancheLevel[];
  /** 진입 구간 (3차 눌림목). */
  zoneLow: number;
  /** 진입 구간 상단 (1차 현재가). */
  zoneHigh: number;
  /** 가중 평균 진입가. */
  avgEntry: number;
  target: number;
  stop: number;
  regimeLabel: '강세' | '중립' | '약세';
  /** true = 3분할, false = 단일(20일선 근처라 되돌림 여력 없음). */
  multiTranche: boolean;
}

const PHASE_WEIGHTS = {
  STRONG: [50, 30, 20] as const, // 강세 — 즉시 비중↑ (모멘텀이 끌어줌)
  NEUTRAL: [34, 33, 33] as const,
  WEAK: [20, 30, 50] as const,   // 약세 — 깊은 눌림 비중↑ (방어적)
};

function regimeBucket(marketPhase?: string): { key: keyof typeof PHASE_WEIGHTS; label: TranchePlanResult['regimeLabel'] } {
  const p = (marketPhase ?? '').toUpperCase();
  if (p === 'BULL' || p === 'RISK_ON') return { key: 'STRONG', label: '강세' };
  if (p === 'BEAR' || p === 'RISK_OFF') return { key: 'WEAK', label: '약세' };
  return { key: 'NEUTRAL', label: '중립' };
}

/** regime 가중 분할매수 계획 산출. current≤0 면 null. */
export function computeTranchePlan(
  current: number,
  disparity20: number | undefined,
  marketPhase: string | undefined,
  aiEntry: number,
  aiTarget: number,
  aiStop: number,
): TranchePlanResult | null {
  if (!(current > 0)) return null;
  const { key, label } = regimeBucket(marketPhase);
  const weights = PHASE_WEIGHTS[key];
  const targetRatio = aiTarget > 0 && aiEntry > 0 ? aiTarget / aiEntry : 1.20;
  const stopRatio = aiStop > 0 && aiEntry > 0 ? aiStop / aiEntry : 0.93;

  // 20일선(눌림목 최저) — 이격도 역산, 되돌림 0~15% clamp.
  const pullbackRatio = disparity20 && disparity20 > 100
    ? Math.max(0.85, Math.min(1, 100 / disparity20))
    : 1;
  const ma20 = Math.round(current * pullbackRatio);

  // 되돌림 여력 <1% → 단일 진입(이미 20일선 근처/돌파 직후).
  if (pullbackRatio >= 0.99) {
    return {
      levels: [{ price: current, weight: 100, role: '현재가' }],
      zoneLow: current, zoneHigh: current, avgEntry: current,
      target: Math.round(current * targetRatio),
      stop: Math.round(current * stopRatio),
      regimeLabel: label, multiTranche: false,
    };
  }

  const mid = Math.round((current + ma20) / 2);
  const levels: TrancheLevel[] = [
    { price: current, weight: weights[0], role: '즉시·돌파' },
    { price: mid, weight: weights[1], role: '얕은 눌림' },
    { price: ma20, weight: weights[2], role: '20일선 눌림목' },
  ];
  const avgEntry = Math.round(levels.reduce((s, l) => s + l.price * l.weight, 0) / 100);
  return {
    levels,
    zoneLow: ma20, zoneHigh: current, avgEntry,
    target: Math.round(avgEntry * targetRatio),
    stop: Math.round(avgEntry * stopRatio),
    regimeLabel: label, multiTranche: true,
  };
}

/** 기존 TranchePlanCard(분할매수 계획 카드) 표시용 변환. */
export function toTranchePlan(result: TranchePlanResult): TranchePlan {
  const pad = [...result.levels];
  while (pad.length < 3) pad.push({ price: 0, weight: 0, role: '—' });
  const fmt = (l: TrancheLevel) => (l.price > 0 ? `${l.role} ₩${l.price.toLocaleString()}` : '—');
  return {
    tranche1: { size: pad[0].weight, trigger: fmt(pad[0]), status: 'PENDING' },
    tranche2: { size: pad[1].weight, trigger: fmt(pad[1]), status: 'PENDING' },
    tranche3: { size: pad[2].weight, trigger: fmt(pad[2]), status: 'PENDING' },
  };
}
