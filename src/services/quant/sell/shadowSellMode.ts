/**
 * sell/shadowSellMode.ts — Shadow Sell Mode
 *
 * 실제 매도는 실행하지 않고, sellEngine이 어떤 신호를 몇 번 내보냈는지만 기록.
 * 3~6개월 누적 시 "L3 익절이 너무 일찍 발동해서 평균 +8% 기회 손실" 같은
 * 정량적 개선점이 드러난다.
 *
 * sellAuditLog가 **실제 매도의 사후 평가**라면, Shadow Sell은 **매도 안 한
 * 시나리오의 가상 평가**. 두 개가 합쳐지면 튜닝이 완전 데이터 기반이 된다.
 *
 * 이 모듈은 순수 로직:
 *   - recordShadowSignal: 신호 기록 (side effect 없음, 배열 append)
 *   - evaluateShadowOutcome: 가상 매도 후 N일 뒤 기회 손익 계산
 *   - aggregateShadowStats: 레이어별 평균 기회 손익 / 빈도 집계
 */

import type { SellSignal } from '../../../types/sell';

// ─── 레코드 타입 ─────────────────────────────────────────────────────────────

/**
 * 단일 Shadow 시그널 기록.
 * 실제 체결은 일어나지 않지만 "그 순간 팔았다면" 가정하여 기록.
 */
export interface ShadowSellRecord {
  id: string;
  positionId: string;
  stockCode: string;
  timestamp: number;
  layerId: string;
  action: SellSignal['action'];
  sellRatio: number;
  /** 가상 매도가 (보통 발동 시점 currentPrice) */
  shadowPrice: number;
  /**
   * 이후 실제 가격 스냅샷.
   * 스케줄러가 1/7/30일 뒤 currentPrice를 기록.
   */
  priceAfter1d?: number;
  priceAfter7d?: number;
  priceAfter30d?: number;
}

// ─── 기록 함수 ───────────────────────────────────────────────────────────────

export interface RecordShadowInput {
  positionId: string;
  stockCode: string;
  layerId: string;
  signal: SellSignal;
  shadowPrice: number;
  now?: number;
}

export function buildShadowRecord(input: RecordShadowInput): ShadowSellRecord {
  const ts = input.now ?? Date.now();
  return {
    id: `shadow_${input.positionId}_${ts}`,
    positionId: input.positionId,
    stockCode: input.stockCode,
    timestamp: ts,
    layerId: input.layerId,
    action: input.signal.action,
    sellRatio: input.signal.ratio,
    shadowPrice: input.shadowPrice,
  };
}

// ─── 기회 손익 계산 ──────────────────────────────────────────────────────────

/**
 * Shadow 매도의 "기회 손익" = 이후 가격 대비 shadowPrice 차이.
 *
 *   opportunityGain > 0 — 팔지 않았다면 더 올랐음 (매도가 성급했음)
 *   opportunityGain < 0 — 팔았다면 더 손실 회피 (매도가 옳았음)
 *
 * @param horizon 평가 기간 ('1d' | '7d' | '30d')
 */
export function evaluateShadowOutcome(
  record: ShadowSellRecord,
  horizon: '1d' | '7d' | '30d',
): { judged: boolean; opportunityGain: number | null } {
  const after = horizon === '1d' ? record.priceAfter1d
              : horizon === '7d' ? record.priceAfter7d
              : record.priceAfter30d;
  if (after === undefined) return { judged: false, opportunityGain: null };
  if (record.shadowPrice <= 0) return { judged: false, opportunityGain: null };
  const gain = (after - record.shadowPrice) / record.shadowPrice;
  return { judged: true, opportunityGain: gain };
}

// ─── 레이어별 통계 집계 ──────────────────────────────────────────────────────

export interface ShadowLayerStats {
  layerId: string;
  triggerCount: number;
  /**
   * horizon별 평균 기회 손익 (기록이 채워진 항목만 대상).
   * 양수 = 평균적으로 매도 안 하는 게 유리 (레이어 민감도 하향 후보).
   * 음수 = 매도가 평균적으로 이득.
   */
  avgOpportunityGain1d: number | null;
  avgOpportunityGain7d: number | null;
  avgOpportunityGain30d: number | null;
  /** 기회 손실 발생률 (opportunityGain > +3% 인 비율) */
  regretRate30d: number | null;
}

const REGRET_BAND = 0.03;

export function aggregateShadowStats(records: readonly ShadowSellRecord[]): ShadowLayerStats[] {
  const byLayer = new Map<string, ShadowSellRecord[]>();
  for (const r of records) {
    const bucket = byLayer.get(r.layerId) ?? [];
    bucket.push(r);
    byLayer.set(r.layerId, bucket);
  }

  const avgOf = (rs: ShadowSellRecord[], horizon: '1d' | '7d' | '30d'): number | null => {
    const gains: number[] = [];
    for (const r of rs) {
      const o = evaluateShadowOutcome(r, horizon);
      if (o.judged && o.opportunityGain !== null) gains.push(o.opportunityGain);
    }
    if (gains.length === 0) return null;
    return gains.reduce((s, v) => s + v, 0) / gains.length;
  };

  const regretRateOf = (rs: ShadowSellRecord[]): number | null => {
    const judged: number[] = [];
    let regrets = 0;
    for (const r of rs) {
      const o = evaluateShadowOutcome(r, '30d');
      if (!o.judged || o.opportunityGain === null) continue;
      judged.push(o.opportunityGain);
      if (o.opportunityGain > REGRET_BAND) regrets++;
    }
    if (judged.length === 0) return null;
    return regrets / judged.length;
  };

  const result: ShadowLayerStats[] = [];
  for (const [layerId, bucket] of byLayer) {
    result.push({
      layerId,
      triggerCount: bucket.length,
      avgOpportunityGain1d: avgOf(bucket, '1d'),
      avgOpportunityGain7d: avgOf(bucket, '7d'),
      avgOpportunityGain30d: avgOf(bucket, '30d'),
      regretRate30d: regretRateOf(bucket),
    });
  }

  // regretRate 높은 레이어 먼저 (튜닝 우선 대상)
  return result.sort((a, b) => {
    if (a.regretRate30d === null) return 1;
    if (b.regretRate30d === null) return -1;
    return b.regretRate30d - a.regretRate30d;
  });
}

// ─── 실행 차단 플래그 ────────────────────────────────────────────────────────

/**
 * autoTradeEngine이 참조할 토글.
 * true일 때 실제 KIS 매도 주문을 발송하지 않고 shadow record만 쌓는다.
 *
 * 환경 변수 SHADOW_SELL_MODE=true로 제어하거나, 관리자 UI에서 토글.
 */
export interface ShadowSellModeFlag {
  enabled: boolean;
  reason?: string;
  enabledSince?: number;
}

export function isShadowMode(flag: ShadowSellModeFlag | undefined): boolean {
  return !!flag?.enabled;
}
