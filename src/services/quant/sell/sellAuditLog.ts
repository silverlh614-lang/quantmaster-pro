/**
 * sell/sellAuditLog.ts — 매도 결정 감사 로그 (자기 학습의 입력)
 *
 * "왜 매도했는가?"를 영구 기록하고, 7일·30일 뒤 후속 가격으로 verdict 판정.
 * 3개월 누적 시 레이어별 신뢰도(accuracy = CORRECT / (CORRECT + REGRET))를
 * 산출하여 가중치 자동 하향의 입력으로 쓴다.
 *
 * 이 파일은 스키마·빌더·집계만 담당. 저장소는 AuditLogAdapter로 주입.
 * PositionEventBus 연결 헬퍼는 sellAuditLogAttach.ts에 분리.
 */

import type { SellSignal } from '../../../types/sell';
import type { RegimeLevel, ROEType } from '../../../types/core';
import type { ActivePosition } from '../../../types/sell';

// ─── 스키마 ───────────────────────────────────────────────────────────────────

export interface SellAuditEntry {
  id: string;
  positionId: string;
  stockCode: string;
  timestamp: number;
  triggeredLayers: readonly string[];
  winningLayer: string;
  action: SellSignal['action'];
  sellRatio: number;
  priceAt: number;
  returnAt: number;
  regime: RegimeLevel;
  roeType: ROEType | undefined;
  ichimokuState: 'ABOVE_CLOUD' | 'INSIDE_CLOUD' | 'BELOW_CLOUD' | undefined;

  /** 7일 후 종가 기준 수익률 (매도 안 했을 때의 가상 수익). 스케줄러가 채움 */
  subsequentReturn7d?: number;
  /** 30일 후 종가 기준 수익률 */
  subsequentReturn30d?: number;

  /**
   *   CORRECT   — 매도 안 했으면 더 손실 (매도 잘함)
   *   REGRET    — 매도 안 했으면 더 이익 (매도 실수)
   *   NEUTRAL   — ±3% 이내 차이
   *   PENDING   — 아직 7/30일 안 됨
   */
  verdict: 'CORRECT' | 'REGRET' | 'NEUTRAL' | 'PENDING';
}

// ─── 저장소 어댑터 ────────────────────────────────────────────────────────────

export interface AuditLogAdapter {
  append(entry: SellAuditEntry): Promise<void>;
  update(id: string, patch: Partial<SellAuditEntry>): Promise<void>;
  query(filter?: AuditLogFilter): Promise<SellAuditEntry[]>;
}

export interface AuditLogFilter {
  layerId?: string;
  regime?: RegimeLevel;
  since?: number;
  until?: number;
}

// ─── 기록 생성 ────────────────────────────────────────────────────────────────

export interface RecordSellDecisionInput {
  position: ActivePosition;
  triggeredSignals: readonly SellSignal[];
  triggeredLayerIds: readonly string[];
  winningLayerId: string;
  regime: RegimeLevel;
  roeType?: ROEType;
  ichimokuState?: 'ABOVE_CLOUD' | 'INSIDE_CLOUD' | 'BELOW_CLOUD';
  executedPrice: number;
  executedRatio: number;
  winningSignal: SellSignal;
  now?: number;
}

export function buildAuditEntry(input: RecordSellDecisionInput): SellAuditEntry {
  const timestamp = input.now ?? Date.now();
  const returnAt = (input.executedPrice - input.position.entryPrice) / input.position.entryPrice;

  return {
    id: `${input.position.id}_${timestamp}`,
    positionId: input.position.id,
    stockCode: input.position.stockCode,
    timestamp,
    triggeredLayers: input.triggeredLayerIds,
    winningLayer: input.winningLayerId,
    action: input.winningSignal.action,
    sellRatio: input.executedRatio,
    priceAt: input.executedPrice,
    returnAt,
    regime: input.regime,
    roeType: input.roeType,
    ichimokuState: input.ichimokuState,
    verdict: 'PENDING',
  };
}

// ─── 사후 판정 ───────────────────────────────────────────────────────────────

const NEUTRAL_BAND = 0.03;

export function computeVerdict(entry: SellAuditEntry): SellAuditEntry['verdict'] {
  if (entry.subsequentReturn30d === undefined) return 'PENDING';
  const diff = entry.subsequentReturn30d - entry.returnAt;
  if (diff <= -NEUTRAL_BAND) return 'CORRECT';
  if (diff >=  NEUTRAL_BAND) return 'REGRET';
  return 'NEUTRAL';
}

// ─── 통계 집계 ────────────────────────────────────────────────────────────────

export interface LayerReliabilityStats {
  layerId: string;
  totalCount: number;
  correctCount: number;
  regretCount: number;
  neutralCount: number;
  pendingCount: number;
  /** CORRECT / (CORRECT + REGRET). NEUTRAL/PENDING은 제외. 분모 0 시 null. */
  accuracy: number | null;
}

export function aggregateLayerReliability(entries: readonly SellAuditEntry[]): LayerReliabilityStats[] {
  const byLayer = new Map<string, SellAuditEntry[]>();
  for (const e of entries) {
    const bucket = byLayer.get(e.winningLayer) ?? [];
    bucket.push(e);
    byLayer.set(e.winningLayer, bucket);
  }

  const stats: LayerReliabilityStats[] = [];
  for (const [layerId, bucket] of byLayer) {
    let correct = 0, regret = 0, neutral = 0, pending = 0;
    for (const e of bucket) {
      switch (e.verdict) {
        case 'CORRECT': correct++;  break;
        case 'REGRET':  regret++;   break;
        case 'NEUTRAL': neutral++;  break;
        case 'PENDING': pending++;  break;
      }
    }
    const judged = correct + regret;
    stats.push({
      layerId,
      totalCount: bucket.length,
      correctCount: correct,
      regretCount: regret,
      neutralCount: neutral,
      pendingCount: pending,
      accuracy: judged > 0 ? correct / judged : null,
    });
  }

  return stats.sort((a, b) => {
    if (a.accuracy === null) return 1;
    if (b.accuracy === null) return -1;
    return a.accuracy - b.accuracy;
  });
}
