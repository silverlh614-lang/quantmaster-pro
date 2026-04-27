/**
 * @responsibility 보유 포지션의 페르소나 4 카테고리 무효화 조건 휴리스틱 평가 SSOT (ADR-0051)
 */
import type { PositionItem } from '../services/autoTrading/autoTradingTypes';

export type InvalidationKey =
  | 'STOP_LOSS_APPROACH'
  | 'LOSS_THRESHOLD'
  | 'STAGE_ESCALATION'
  | 'TARGET_REACHED';

export type InvalidationTier = 'OK' | 'WARN' | 'CRITICAL' | 'NA';

export interface InvalidationCondition {
  key: InvalidationKey;
  label: string;
  /** null = 평가 불가 (NA) — 입력 필드 부재. */
  met: boolean | null;
  /** tooltip 상세 한 줄 — 사용자에게 평가 근거 노출. */
  detail: string;
}

export interface InvalidationMeterResult {
  conditions: InvalidationCondition[];
  metCount: number;
  evaluableCount: number;
  tier: InvalidationTier;
}

// ─── 임계값 SSOT (ADR-0051 §2.1) ────────────────────────────────────────

/** 손절가 임박 — 현재가가 손절가의 ×1.05 이내. */
export const STOP_LOSS_APPROACH_RATIO = 1.05;
/** 손실 임계 — 누적 -3% 이하. */
export const LOSS_THRESHOLD_PCT = -3;
/** 시스템 단계 무효화 — ALERT 이상. */
const ESCALATED_STAGES = new Set(['ALERT', 'EXIT_PREP', 'FULL_EXIT']);

// ─── 평가 헬퍼 (각 카테고리) ──────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fmtPrice(n: number): string {
  return n.toLocaleString('ko-KR');
}

function evalStopLossApproach(p: PositionItem): InvalidationCondition {
  const stop = p.stopLossPrice;
  const cur = p.currentPrice;
  if (!isFiniteNumber(stop) || stop <= 0 || !isFiniteNumber(cur) || cur <= 0) {
    return { key: 'STOP_LOSS_APPROACH', label: '손절가 임박', met: null, detail: '손절가 미설정' };
  }
  const ratio = cur / stop;
  const bufferPct = ((cur - stop) / stop) * 100;
  const met = ratio <= STOP_LOSS_APPROACH_RATIO;
  const detail = `현재가 ${fmtPrice(cur)} / 손절가 ${fmtPrice(stop)} (${bufferPct >= 0 ? '+' : ''}${bufferPct.toFixed(1)}% 여유)`;
  return { key: 'STOP_LOSS_APPROACH', label: '손절가 임박', met, detail };
}

function evalLossThreshold(p: PositionItem): InvalidationCondition {
  const pnl = p.pnlPct;
  if (!isFiniteNumber(pnl)) {
    return { key: 'LOSS_THRESHOLD', label: '손실 -3% 도달', met: null, detail: '수익률 미산정' };
  }
  const met = pnl <= LOSS_THRESHOLD_PCT;
  const detail = `수익률 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% (임계 -3%)`;
  return { key: 'LOSS_THRESHOLD', label: '손실 -3% 도달', met, detail };
}

function evalStageEscalation(p: PositionItem): InvalidationCondition {
  if (!p.stage) {
    return { key: 'STAGE_ESCALATION', label: '시스템 단계 격상', met: null, detail: 'stage 미평가' };
  }
  const met = ESCALATED_STAGES.has(p.stage);
  const detail = `현재 단계 ${p.stage}${met ? ' — ALERT 이상' : ' — 정상'}`;
  return { key: 'STAGE_ESCALATION', label: '시스템 단계 격상', met, detail };
}

function evalTargetReached(p: PositionItem): InvalidationCondition {
  const tgt = p.targetPrice1;
  const cur = p.currentPrice;
  if (!isFiniteNumber(tgt) || tgt <= 0 || !isFiniteNumber(cur) || cur <= 0) {
    return { key: 'TARGET_REACHED', label: '1차 목표 도달', met: null, detail: '1차 목표가 미설정' };
  }
  const met = cur >= tgt;
  const gapPct = ((cur - tgt) / tgt) * 100;
  const detail = `현재가 ${fmtPrice(cur)} / 1차 목표 ${fmtPrice(tgt)} (${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%)`;
  return { key: 'TARGET_REACHED', label: '1차 목표 도달', met, detail };
}

// ─── 메인 SSOT ──────────────────────────────────────────────────────────

/**
 * 4 카테고리 평가 → 정렬된 conditions 배열 + tier. 순수 함수, 외부 의존성 0.
 * 출력 conditions 순서: STOP_LOSS_APPROACH → LOSS_THRESHOLD → STAGE_ESCALATION → TARGET_REACHED.
 */
export function evaluateInvalidationConditions(position: PositionItem): InvalidationMeterResult {
  const conditions: InvalidationCondition[] = [
    evalStopLossApproach(position),
    evalLossThreshold(position),
    evalStageEscalation(position),
    evalTargetReached(position),
  ];
  const metCount = conditions.filter((c) => c.met === true).length;
  const evaluableCount = conditions.filter((c) => c.met !== null).length;
  return {
    conditions,
    metCount,
    evaluableCount,
    tier: composeInvalidationTier(metCount, evaluableCount),
  };
}

/**
 * 충족 카운트 → tier 분류 SSOT (ADR-0051 §2.3).
 *   evaluableCount === 0  → NA (평가 가능 조건 0건)
 *   metCount === 0        → OK
 *   metCount === 1        → WARN
 *   metCount ≥ 2          → CRITICAL
 */
export function composeInvalidationTier(metCount: number, evaluableCount: number): InvalidationTier {
  if (!Number.isFinite(metCount) || !Number.isFinite(evaluableCount)) return 'NA';
  if (evaluableCount <= 0) return 'NA';
  if (metCount <= 0) return 'OK';
  if (metCount === 1) return 'WARN';
  return 'CRITICAL';
}
