/**
 * @responsibility 영속 파일 cross-consistency invariants 검증 read-only SSOT
 *
 * 79개 영속 파일 중 *서로 참조하거나 정합 규칙이 있는* 5개 invariant 를 한 번에
 * 검사한다. 진단 전용 — 영속 파일을 *수정하지 않으며* 외부 호출 없음.
 *
 * I1 — OCO 주문(`OCO_ORDERS_FILE`)의 `id` 가 SHADOW(`SHADOW_FILE`) 안에 존재해야 한다.
 *      orphan OCO 주문은 ghost 매도 신호로 KIS quota 낭비.
 * I2 — PENDING 주문(`PENDING_ORDERS_FILE`)의 `relatedTradeId` 가 있다면 SHADOW 안에 존재.
 *      orphan PENDING 은 fillMonitor 가 무한 폴링하는 회로 부담.
 * I3 — ATTRIBUTION(`ATTRIBUTION_FILE`) 의 모든 record `schemaVersion` 이
 *      `CURRENT_ATTRIBUTION_SCHEMA_VERSION` 과 일치해야 한다 (마이그레이션 누락 감지).
 * I4 — TRADE_SIGNAL_STATUS(`TRADE_SIGNAL_STATUS_FILE`) record 의 status 와
 *      finalizedAt 정합: BLOCKED/AUTO_TRADE_READY → finalizedAt 필수,
 *      AI_CANDIDATE/DATA_VERIFIED/RISK_APPROVED/USER_APPROVED → finalizedAt 부재.
 * I5 — CONDITION_WEIGHTS(`CONDITION_WEIGHTS_FILE`) 모든 값이 [0.1, 2.0] 범위 내.
 *      범위 위반은 학습 폭주 또는 손상 데이터 신호.
 *
 * ENV `CACHE_COHERENCE_AUDIT_DISABLED=true` → runCoherenceAudit 는 disabled=true,
 * violations 빈 배열 반환 (긴급 우회).
 */

import fs from 'fs';
import {
  OCO_ORDERS_FILE,
  PENDING_ORDERS_FILE,
  ATTRIBUTION_FILE,
  TRADE_SIGNAL_STATUS_FILE,
  CONDITION_WEIGHTS_FILE,
  SHADOW_FILE,
} from './paths.js';
import { CURRENT_ATTRIBUTION_SCHEMA_VERSION } from './attributionRepo.js';

// ─── 타입 SSOT ───────────────────────────────────────────────────────────────

export type CoherenceSeverity = 'CRITICAL' | 'WARN' | 'INFO';

export type CoherenceInvariantId =
  | 'I1_OCO_SHADOW_REF'
  | 'I2_PENDING_SHADOW_REF'
  | 'I3_ATTRIBUTION_SCHEMA'
  | 'I4_TRADE_SIGNAL_FINALIZED_AT'
  | 'I5_CONDITION_WEIGHTS_RANGE';

export interface CoherenceViolation {
  invariantId: CoherenceInvariantId;
  severity: CoherenceSeverity;
  message: string;
  /** 위반된 record 의 식별자 (있는 경우) — 종목코드/orderId/recordId 등 */
  recordId?: string;
  /** 위반된 영속 파일 경로 (디버깅용) */
  file: string;
}

export interface CoherenceAuditSummary {
  totalViolations: number;
  byInvariant: Partial<Record<CoherenceInvariantId, number>>;
  bySeverity: Record<CoherenceSeverity, number>;
}

export interface CoherenceAuditReport {
  capturedAt: string;
  disabled: boolean;
  violations: CoherenceViolation[];
  summary: CoherenceAuditSummary;
}

// ─── ENV 회로 ────────────────────────────────────────────────────────────────

export function isCoherenceAuditDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.CACHE_COHERENCE_AUDIT_DISABLED === 'true';
}

// ─── 안전 read 헬퍼 ─────────────────────────────────────────────────────────

function safeReadJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

// ─── Invariant 검사 함수 (순수, 입력 주입형) ─────────────────────────────────

interface OcoLike { id?: unknown; status?: unknown }
interface PendingLike { relatedTradeId?: unknown; ordNo?: unknown; stockCode?: unknown; status?: unknown }
interface AttrLike { tradeId?: unknown; schemaVersion?: unknown }
interface ShadowLike { id?: unknown }
interface SignalLike {
  id?: unknown;
  status?: unknown;
  finalizedAt?: unknown;
  blockGate?: unknown;
}
type WeightsLike = Record<string, unknown>;

const ACTIVE_OCO_STATUSES = new Set(['ACTIVE']);
const ACTIVE_PENDING_STATUSES = new Set(['PENDING', 'PARTIAL']);

const TERMINAL_SIGNAL_STATUSES = new Set(['BLOCKED', 'AUTO_TRADE_READY']);
const NON_TERMINAL_SIGNAL_STATUSES = new Set([
  'AI_CANDIDATE',
  'DATA_VERIFIED',
  'RISK_APPROVED',
  'USER_APPROVED',
]);

const CONDITION_WEIGHT_MIN = 0.1;
const CONDITION_WEIGHT_MAX = 2.0;

export function auditOcoShadowReferences(
  ocoOrders: OcoLike[],
  shadows: ShadowLike[]
): CoherenceViolation[] {
  const shadowIds = new Set(
    shadows.map((s) => (typeof s.id === 'string' ? s.id : '')).filter(Boolean)
  );
  const violations: CoherenceViolation[] = [];
  for (const oco of ocoOrders) {
    if (!ACTIVE_OCO_STATUSES.has(typeof oco.status === 'string' ? oco.status : '')) continue;
    const id = typeof oco.id === 'string' ? oco.id : '';
    if (!id) {
      violations.push({
        invariantId: 'I1_OCO_SHADOW_REF',
        severity: 'WARN',
        message: 'ACTIVE OCO 주문에 id 필드 부재',
        file: OCO_ORDERS_FILE,
      });
      continue;
    }
    if (!shadowIds.has(id)) {
      violations.push({
        invariantId: 'I1_OCO_SHADOW_REF',
        severity: 'CRITICAL',
        message: `ACTIVE OCO 주문(id=${id}) 이 SHADOW_FILE 안에 부재 — ghost 매도 위험`,
        recordId: id,
        file: OCO_ORDERS_FILE,
      });
    }
  }
  return violations;
}

export function auditPendingShadowReferences(
  pendingOrders: PendingLike[],
  shadows: ShadowLike[]
): CoherenceViolation[] {
  const shadowIds = new Set(
    shadows.map((s) => (typeof s.id === 'string' ? s.id : '')).filter(Boolean)
  );
  const violations: CoherenceViolation[] = [];
  for (const order of pendingOrders) {
    if (!ACTIVE_PENDING_STATUSES.has(typeof order.status === 'string' ? order.status : '')) continue;
    const relatedId = typeof order.relatedTradeId === 'string' ? order.relatedTradeId : '';
    if (!relatedId) continue; // relatedTradeId 부재는 이번 invariant scope 밖 (수동 주문 등)
    if (!shadowIds.has(relatedId)) {
      const ordNo = typeof order.ordNo === 'string' ? order.ordNo : '?';
      violations.push({
        invariantId: 'I2_PENDING_SHADOW_REF',
        severity: 'CRITICAL',
        message: `ACTIVE PENDING 주문(ordNo=${ordNo}) relatedTradeId=${relatedId} 가 SHADOW_FILE 부재 — fillMonitor 무한 폴링 위험`,
        recordId: relatedId,
        file: PENDING_ORDERS_FILE,
      });
    }
  }
  return violations;
}

export function auditAttributionSchema(records: AttrLike[]): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];
  for (const r of records) {
    const v = typeof r.schemaVersion === 'number' ? r.schemaVersion : 0;
    if (v !== CURRENT_ATTRIBUTION_SCHEMA_VERSION) {
      const tradeId = typeof r.tradeId === 'string' ? r.tradeId : '?';
      violations.push({
        invariantId: 'I3_ATTRIBUTION_SCHEMA',
        severity: 'WARN',
        message: `attribution record(tradeId=${tradeId}) schemaVersion=${v} ≠ CURRENT(${CURRENT_ATTRIBUTION_SCHEMA_VERSION})`,
        recordId: tradeId,
        file: ATTRIBUTION_FILE,
      });
    }
  }
  return violations;
}

export function auditTradeSignalIntegrity(records: SignalLike[]): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];
  for (const r of records) {
    const status = typeof r.status === 'string' ? r.status : '';
    const id = typeof r.id === 'string' ? r.id : '?';
    const hasFinalizedAt = typeof r.finalizedAt === 'string' && r.finalizedAt.length > 0;

    if (TERMINAL_SIGNAL_STATUSES.has(status) && !hasFinalizedAt) {
      violations.push({
        invariantId: 'I4_TRADE_SIGNAL_FINALIZED_AT',
        severity: 'WARN',
        message: `TradeSignal(id=${id}) status=${status} 이지만 finalizedAt 부재`,
        recordId: id,
        file: TRADE_SIGNAL_STATUS_FILE,
      });
    } else if (NON_TERMINAL_SIGNAL_STATUSES.has(status) && hasFinalizedAt) {
      violations.push({
        invariantId: 'I4_TRADE_SIGNAL_FINALIZED_AT',
        severity: 'WARN',
        message: `TradeSignal(id=${id}) status=${status} (non-terminal) 인데 finalizedAt 존재`,
        recordId: id,
        file: TRADE_SIGNAL_STATUS_FILE,
      });
    }

    if (status === 'BLOCKED') {
      const blockGate = typeof r.blockGate === 'string' ? r.blockGate : '';
      if (!blockGate) {
        violations.push({
          invariantId: 'I4_TRADE_SIGNAL_FINALIZED_AT',
          severity: 'WARN',
          message: `TradeSignal(id=${id}) status=BLOCKED 인데 blockGate 부재`,
          recordId: id,
          file: TRADE_SIGNAL_STATUS_FILE,
        });
      }
    }
  }
  return violations;
}

export function auditConditionWeightsRange(weights: WeightsLike): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];
  for (const [key, value] of Object.entries(weights)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      violations.push({
        invariantId: 'I5_CONDITION_WEIGHTS_RANGE',
        severity: 'CRITICAL',
        message: `condition weight key=${key} value=${String(value)} 가 숫자 아님`,
        recordId: key,
        file: CONDITION_WEIGHTS_FILE,
      });
      continue;
    }
    if (value < CONDITION_WEIGHT_MIN || value > CONDITION_WEIGHT_MAX) {
      violations.push({
        invariantId: 'I5_CONDITION_WEIGHTS_RANGE',
        severity: value <= 0 || value > 5 ? 'CRITICAL' : 'WARN',
        message: `condition weight key=${key} value=${value} 가 [${CONDITION_WEIGHT_MIN}, ${CONDITION_WEIGHT_MAX}] 범위 위반`,
        recordId: key,
        file: CONDITION_WEIGHTS_FILE,
      });
    }
  }
  return violations;
}

// ─── 요약 빌더 ─────────────────────────────────────────────────────────────

export function summarizeViolations(violations: CoherenceViolation[]): CoherenceAuditSummary {
  const byInvariant: Partial<Record<CoherenceInvariantId, number>> = {};
  const bySeverity: Record<CoherenceSeverity, number> = { CRITICAL: 0, WARN: 0, INFO: 0 };
  for (const v of violations) {
    byInvariant[v.invariantId] = (byInvariant[v.invariantId] ?? 0) + 1;
    bySeverity[v.severity] += 1;
  }
  return {
    totalViolations: violations.length,
    byInvariant,
    bySeverity,
  };
}

// ─── orchestrator ──────────────────────────────────────────────────────────

/**
 * 5종 invariant 를 read-only 로 검사. 어떤 영속 파일도 수정하지 않는다.
 * 외부 호출(KIS/KRX) 0건. 손상된 파일은 빈 배열로 fallback (조용한 통과).
 */
export function runCoherenceAudit(now: Date = new Date()): CoherenceAuditReport {
  const capturedAt = now.toISOString();

  if (isCoherenceAuditDisabled()) {
    return {
      capturedAt,
      disabled: true,
      violations: [],
      summary: summarizeViolations([]),
    };
  }

  const ocoOrders = safeReadJson<OcoLike[]>(OCO_ORDERS_FILE, []);
  const pendingOrders = safeReadJson<PendingLike[]>(PENDING_ORDERS_FILE, []);
  const attributionRecords = safeReadJson<AttrLike[]>(ATTRIBUTION_FILE, []);
  const signalRecords = safeReadJson<SignalLike[]>(TRADE_SIGNAL_STATUS_FILE, []);
  const conditionWeights = safeReadJson<WeightsLike>(CONDITION_WEIGHTS_FILE, {});
  const shadows = safeReadJson<ShadowLike[]>(SHADOW_FILE, []);

  const violations: CoherenceViolation[] = [
    ...auditOcoShadowReferences(Array.isArray(ocoOrders) ? ocoOrders : [], Array.isArray(shadows) ? shadows : []),
    ...auditPendingShadowReferences(Array.isArray(pendingOrders) ? pendingOrders : [], Array.isArray(shadows) ? shadows : []),
    ...auditAttributionSchema(Array.isArray(attributionRecords) ? attributionRecords : []),
    ...auditTradeSignalIntegrity(Array.isArray(signalRecords) ? signalRecords : []),
    ...auditConditionWeightsRange(
      conditionWeights && typeof conditionWeights === 'object' && !Array.isArray(conditionWeights)
        ? (conditionWeights as WeightsLike)
        : {}
    ),
  ];

  return {
    capturedAt,
    disabled: false,
    violations,
    summary: summarizeViolations(violations),
  };
}
