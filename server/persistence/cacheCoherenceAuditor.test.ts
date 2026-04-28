// @responsibility cacheCoherenceAuditor 5종 invariant 회귀 테스트
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  auditOcoShadowReferences,
  auditPendingShadowReferences,
  auditAttributionSchema,
  auditTradeSignalIntegrity,
  auditConditionWeightsRange,
  summarizeViolations,
  runCoherenceAudit,
  isCoherenceAuditDisabled,
} from './cacheCoherenceAuditor';
import { CURRENT_ATTRIBUTION_SCHEMA_VERSION } from './attributionRepo';

describe('isCoherenceAuditDisabled', () => {
  beforeEach(() => {
    delete process.env.CACHE_COHERENCE_AUDIT_DISABLED;
  });

  it('미설정 시 false', () => {
    expect(isCoherenceAuditDisabled()).toBe(false);
  });

  it('true 명시 시 true', () => {
    process.env.CACHE_COHERENCE_AUDIT_DISABLED = 'true';
    expect(isCoherenceAuditDisabled()).toBe(true);
  });

  it('false 명시 시 false', () => {
    process.env.CACHE_COHERENCE_AUDIT_DISABLED = 'false';
    expect(isCoherenceAuditDisabled()).toBe(false);
  });

  it('잘못된 값(1, "yes" 등)은 false (엄격 매치)', () => {
    process.env.CACHE_COHERENCE_AUDIT_DISABLED = 'yes';
    expect(isCoherenceAuditDisabled()).toBe(false);
  });
});

describe('I1 — auditOcoShadowReferences', () => {
  it('빈 배열 시 violation 0건', () => {
    expect(auditOcoShadowReferences([], [])).toHaveLength(0);
  });

  it('모든 OCO id 가 SHADOW 안에 있으면 violation 0건', () => {
    const ocos = [{ id: 'shadow_001', status: 'ACTIVE' }];
    const shadows = [{ id: 'shadow_001' }];
    expect(auditOcoShadowReferences(ocos, shadows)).toHaveLength(0);
  });

  it('orphan ACTIVE OCO id 시 CRITICAL violation', () => {
    const ocos = [{ id: 'orphan_999', status: 'ACTIVE' }];
    const shadows = [{ id: 'shadow_001' }];
    const v = auditOcoShadowReferences(ocos, shadows);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('CRITICAL');
    expect(v[0].invariantId).toBe('I1_OCO_SHADOW_REF');
    expect(v[0].recordId).toBe('orphan_999');
    expect(v[0].message).toContain('ghost');
  });

  it('STOP_FILLED/PROFIT_FILLED/BOTH_CANCELLED 등 closed OCO 는 검사 제외', () => {
    const ocos = [
      { id: 'orphan_done', status: 'STOP_FILLED' },
      { id: 'orphan_cancelled', status: 'BOTH_CANCELLED' },
    ];
    expect(auditOcoShadowReferences(ocos, [])).toHaveLength(0);
  });

  it('id 부재 시 WARN', () => {
    const ocos = [{ status: 'ACTIVE' }];
    const v = auditOcoShadowReferences(ocos, []);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('WARN');
  });
});

describe('I2 — auditPendingShadowReferences', () => {
  it('relatedTradeId 부재 시 검사 제외 (수동 주문 등)', () => {
    const pending = [{ ordNo: 'A123', status: 'PENDING', stockCode: '005930' }];
    expect(auditPendingShadowReferences(pending, [])).toHaveLength(0);
  });

  it('relatedTradeId 가 SHADOW 안에 있으면 violation 0건', () => {
    const pending = [{ ordNo: 'A123', relatedTradeId: 'shadow_001', status: 'PENDING' }];
    expect(auditPendingShadowReferences(pending, [{ id: 'shadow_001' }])).toHaveLength(0);
  });

  it('orphan ACTIVE PENDING relatedTradeId 시 CRITICAL', () => {
    const pending = [{ ordNo: 'A123', relatedTradeId: 'orphan_999', status: 'PENDING' }];
    const v = auditPendingShadowReferences(pending, []);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('CRITICAL');
    expect(v[0].invariantId).toBe('I2_PENDING_SHADOW_REF');
    expect(v[0].message).toContain('A123');
    expect(v[0].message).toContain('fillMonitor');
  });

  it('PARTIAL status 도 ACTIVE 로 검사', () => {
    const pending = [{ ordNo: 'B', relatedTradeId: 'orphan', status: 'PARTIAL' }];
    expect(auditPendingShadowReferences(pending, [])).toHaveLength(1);
  });

  it('FILLED/CANCELLED/EXPIRED 등 closed PENDING 은 검사 제외', () => {
    const pending = [
      { ordNo: 'A', relatedTradeId: 'orphan', status: 'FILLED' },
      { ordNo: 'B', relatedTradeId: 'orphan', status: 'CANCELLED' },
      { ordNo: 'C', relatedTradeId: 'orphan', status: 'EXPIRED' },
    ];
    expect(auditPendingShadowReferences(pending, [])).toHaveLength(0);
  });
});

describe('I3 — auditAttributionSchema', () => {
  it('빈 배열 시 violation 0건', () => {
    expect(auditAttributionSchema([])).toHaveLength(0);
  });

  it('모든 record 가 CURRENT 버전이면 violation 0건', () => {
    const records = [{ tradeId: 't1', schemaVersion: CURRENT_ATTRIBUTION_SCHEMA_VERSION }];
    expect(auditAttributionSchema(records)).toHaveLength(0);
  });

  it('구버전 record (v1) → WARN', () => {
    const records = [{ tradeId: 't1', schemaVersion: 1 }];
    const v = auditAttributionSchema(records);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('WARN');
    expect(v[0].invariantId).toBe('I3_ATTRIBUTION_SCHEMA');
  });

  it('schemaVersion 부재 (v=0 fallback) → WARN', () => {
    const records = [{ tradeId: 't1' }];
    expect(auditAttributionSchema(records)).toHaveLength(1);
  });

  it('일부 OK + 일부 구버전 시 구버전만 카운트', () => {
    const records = [
      { tradeId: 'ok', schemaVersion: CURRENT_ATTRIBUTION_SCHEMA_VERSION },
      { tradeId: 'old', schemaVersion: 1 },
    ];
    const v = auditAttributionSchema(records);
    expect(v).toHaveLength(1);
    expect(v[0].recordId).toBe('old');
  });
});

describe('I4 — auditTradeSignalIntegrity', () => {
  it('AI_CANDIDATE + finalizedAt 부재 → 정상', () => {
    const records = [{ id: 'sig1', status: 'AI_CANDIDATE' }];
    expect(auditTradeSignalIntegrity(records)).toHaveLength(0);
  });

  it('BLOCKED + finalizedAt 존재 + blockGate 존재 → 정상', () => {
    const records = [{ id: 'sig1', status: 'BLOCKED', finalizedAt: '2026-04-28T00:00:00Z', blockGate: 'GATE_2' }];
    expect(auditTradeSignalIntegrity(records)).toHaveLength(0);
  });

  it('AUTO_TRADE_READY + finalizedAt 존재 → 정상', () => {
    const records = [{ id: 'sig1', status: 'AUTO_TRADE_READY', finalizedAt: '2026-04-28T00:00:00Z' }];
    expect(auditTradeSignalIntegrity(records)).toHaveLength(0);
  });

  it('BLOCKED + finalizedAt 부재 → WARN', () => {
    const records = [{ id: 'sig1', status: 'BLOCKED', blockGate: 'GATE_2' }];
    const v = auditTradeSignalIntegrity(records);
    expect(v.some((x) => x.message.includes('finalizedAt 부재'))).toBe(true);
  });

  it('AUTO_TRADE_READY + finalizedAt 부재 → WARN', () => {
    const records = [{ id: 'sig1', status: 'AUTO_TRADE_READY' }];
    expect(auditTradeSignalIntegrity(records)).toHaveLength(1);
  });

  it('AI_CANDIDATE + finalizedAt 존재 → WARN (non-terminal 인데 finalized)', () => {
    const records = [{ id: 'sig1', status: 'AI_CANDIDATE', finalizedAt: '2026-04-28T00:00:00Z' }];
    const v = auditTradeSignalIntegrity(records);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('non-terminal');
  });

  it('BLOCKED + blockGate 부재 → WARN', () => {
    const records = [{ id: 'sig1', status: 'BLOCKED', finalizedAt: '2026-04-28T00:00:00Z' }];
    const v = auditTradeSignalIntegrity(records);
    expect(v.some((x) => x.message.includes('blockGate 부재'))).toBe(true);
  });

  it('빈 finalizedAt 문자열 도 부재로 취급', () => {
    const records = [{ id: 'sig1', status: 'BLOCKED', finalizedAt: '', blockGate: 'GATE_2' }];
    expect(auditTradeSignalIntegrity(records)).toHaveLength(1);
  });
});

describe('I5 — auditConditionWeightsRange', () => {
  it('정상 범위 (1.0) → violation 0', () => {
    expect(auditConditionWeightsRange({ momentum: 1.0, ma_alignment: 0.8 })).toHaveLength(0);
  });

  it('범위 경계 0.1 / 2.0 정확히 → 정상', () => {
    expect(auditConditionWeightsRange({ a: 0.1, b: 2.0 })).toHaveLength(0);
  });

  it('0.05 → WARN', () => {
    const v = auditConditionWeightsRange({ a: 0.05 });
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('WARN');
  });

  it('2.5 → WARN', () => {
    expect(auditConditionWeightsRange({ a: 2.5 })[0].severity).toBe('WARN');
  });

  it('0 → CRITICAL (자기학습 가중치 0 = 조건 자체 비활성, 데이터 손상 의심)', () => {
    expect(auditConditionWeightsRange({ a: 0 })[0].severity).toBe('CRITICAL');
  });

  it('음수 → CRITICAL', () => {
    expect(auditConditionWeightsRange({ a: -0.5 })[0].severity).toBe('CRITICAL');
  });

  it('10 (완전 폭주) → CRITICAL', () => {
    expect(auditConditionWeightsRange({ a: 10 })[0].severity).toBe('CRITICAL');
  });

  it('NaN/Infinity → CRITICAL', () => {
    expect(auditConditionWeightsRange({ a: NaN })[0].severity).toBe('CRITICAL');
    expect(auditConditionWeightsRange({ a: Infinity })[0].severity).toBe('CRITICAL');
  });

  it('숫자 아님 → CRITICAL', () => {
    expect(auditConditionWeightsRange({ a: 'oops' })[0].severity).toBe('CRITICAL');
  });

  it('다중 위반 누적', () => {
    const v = auditConditionWeightsRange({ a: 0, b: 0.05, c: 1.0, d: 5 });
    expect(v).toHaveLength(3);
  });
});

describe('summarizeViolations', () => {
  it('빈 배열 시 totalViolations=0', () => {
    const s = summarizeViolations([]);
    expect(s.totalViolations).toBe(0);
    expect(s.bySeverity).toEqual({ CRITICAL: 0, WARN: 0, INFO: 0 });
  });

  it('byInvariant 분류 정확', () => {
    const s = summarizeViolations([
      { invariantId: 'I1_OCO_SHADOW_REF', severity: 'CRITICAL', message: '', file: '' },
      { invariantId: 'I1_OCO_SHADOW_REF', severity: 'WARN', message: '', file: '' },
      { invariantId: 'I3_ATTRIBUTION_SCHEMA', severity: 'WARN', message: '', file: '' },
    ]);
    expect(s.totalViolations).toBe(3);
    expect(s.byInvariant.I1_OCO_SHADOW_REF).toBe(2);
    expect(s.byInvariant.I3_ATTRIBUTION_SCHEMA).toBe(1);
    expect(s.bySeverity.CRITICAL).toBe(1);
    expect(s.bySeverity.WARN).toBe(2);
  });
});

describe('runCoherenceAudit (통합)', () => {
  beforeEach(() => {
    delete process.env.CACHE_COHERENCE_AUDIT_DISABLED;
  });

  afterEach(() => {
    delete process.env.CACHE_COHERENCE_AUDIT_DISABLED;
  });

  it('DISABLED env 시 disabled=true + violations 빈', () => {
    process.env.CACHE_COHERENCE_AUDIT_DISABLED = 'true';
    const r = runCoherenceAudit();
    expect(r.disabled).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('정상 호출 시 capturedAt ISO + summary 포함', () => {
    const r = runCoherenceAudit(new Date('2026-04-28T12:00:00Z'));
    expect(r.capturedAt).toBe('2026-04-28T12:00:00.000Z');
    expect(r.disabled).toBe(false);
    expect(r.summary).toBeDefined();
    expect(r.summary.bySeverity).toEqual(
      expect.objectContaining({ CRITICAL: expect.any(Number), WARN: expect.any(Number), INFO: expect.any(Number) })
    );
  });
});
