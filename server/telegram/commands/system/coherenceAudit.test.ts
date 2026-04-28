// @responsibility coherenceAudit.cmd 회귀 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCoherenceAuditMessage } from './coherenceAudit.cmd';
import type {
  CoherenceAuditReport,
  CoherenceViolation,
} from '../../../persistence/cacheCoherenceAuditor';

function buildReport(over: Partial<CoherenceAuditReport> = {}): CoherenceAuditReport {
  return {
    capturedAt: '2026-04-28T12:00:00.000Z',
    disabled: false,
    violations: [],
    summary: {
      totalViolations: 0,
      byInvariant: {},
      bySeverity: { CRITICAL: 0, WARN: 0, INFO: 0 },
    },
    ...over,
  };
}

function buildViolations(...items: Partial<CoherenceViolation>[]): CoherenceViolation[] {
  return items.map((p) => ({
    invariantId: 'I1_OCO_SHADOW_REF',
    severity: 'CRITICAL',
    message: 'msg',
    file: '/data/oco-orders.json',
    ...p,
  })) as CoherenceViolation[];
}

describe('formatCoherenceAuditMessage', () => {
  it('disabled 시 ⛔ 메시지 반환', () => {
    const msg = formatCoherenceAuditMessage(buildReport({ disabled: true }), 10);
    expect(msg).toContain('⛔ 비활성');
    expect(msg).toContain('CACHE_COHERENCE_AUDIT_DISABLED');
  });

  it('violations 0건 시 ✅ 5종 정상 표시', () => {
    const msg = formatCoherenceAuditMessage(buildReport(), 10);
    expect(msg).toContain('5종 invariant 모두 정상');
    expect(msg).toContain('I1');
    expect(msg).toContain('I5');
  });

  it('violations 다수 시 CRITICAL > WARN 우선 정렬', () => {
    const violations = buildViolations(
      { invariantId: 'I3_ATTRIBUTION_SCHEMA', severity: 'WARN', recordId: 'old', message: 'v1 record', file: '/data/attribution-records.json' },
      { invariantId: 'I1_OCO_SHADOW_REF', severity: 'CRITICAL', recordId: 'orphan_1', message: 'ghost', file: '/data/oco-orders.json' },
    );
    const msg = formatCoherenceAuditMessage(
      buildReport({
        violations,
        summary: {
          totalViolations: 2,
          byInvariant: { I1_OCO_SHADOW_REF: 1, I3_ATTRIBUTION_SCHEMA: 1 },
          bySeverity: { CRITICAL: 1, WARN: 1, INFO: 0 },
        },
      }),
      10
    );
    // CRITICAL 항목 인덱스가 WARN 보다 먼저
    const criticalIdx = msg.indexOf('orphan_1');
    const warnIdx = msg.indexOf('old');
    expect(criticalIdx).toBeGreaterThan(0);
    expect(warnIdx).toBeGreaterThan(0);
    expect(criticalIdx).toBeLessThan(warnIdx);
  });

  it('severity 카운트 출력 정확', () => {
    const msg = formatCoherenceAuditMessage(
      buildReport({
        violations: buildViolations(
          { severity: 'CRITICAL' },
          { severity: 'CRITICAL' },
          { severity: 'WARN' },
        ),
        summary: {
          totalViolations: 3,
          byInvariant: { I1_OCO_SHADOW_REF: 3 },
          bySeverity: { CRITICAL: 2, WARN: 1, INFO: 0 },
        },
      }),
      10
    );
    expect(msg).toContain('🛑 CRITICAL: 2');
    expect(msg).toContain('⚠️ WARN: 1');
  });

  it('Invariant 라벨 한글 매핑 적용', () => {
    const msg = formatCoherenceAuditMessage(
      buildReport({
        violations: buildViolations({ invariantId: 'I5_CONDITION_WEIGHTS_RANGE', severity: 'WARN', message: '범위 위반', recordId: 'momentum' }),
        summary: {
          totalViolations: 1,
          byInvariant: { I5_CONDITION_WEIGHTS_RANGE: 1 },
          bySeverity: { CRITICAL: 0, WARN: 1, INFO: 0 },
        },
      }),
      10
    );
    expect(msg).toContain('Weights 범위');
  });

  it('Top N 절삭 + 외 N건 안내', () => {
    const violations = buildViolations(
      ...Array.from({ length: 5 }, (_, i) => ({ severity: 'WARN' as const, recordId: `w${i}`, message: `m${i}` }))
    );
    const msg = formatCoherenceAuditMessage(
      buildReport({
        violations,
        summary: {
          totalViolations: 5,
          byInvariant: { I1_OCO_SHADOW_REF: 5 },
          bySeverity: { CRITICAL: 0, WARN: 5, INFO: 0 },
        },
      }),
      2
    );
    expect(msg).toContain('w0');
    expect(msg).toContain('w1');
    expect(msg).not.toContain('w2');
    expect(msg).toContain('외 3건');
  });

  it('잘못된 N (NaN/0/음수) 시 default 10 fallback', () => {
    const violations = buildViolations(
      ...Array.from({ length: 12 }, (_, i) => ({ severity: 'WARN' as const, recordId: `w${i}`, message: `m${i}` }))
    );
    const msg = formatCoherenceAuditMessage(
      buildReport({
        violations,
        summary: {
          totalViolations: 12,
          byInvariant: { I1_OCO_SHADOW_REF: 12 },
          bySeverity: { CRITICAL: 0, WARN: 12, INFO: 0 },
        },
      }),
      Number.NaN
    );
    expect(msg).toContain('w9');
    expect(msg).not.toContain('w10');
    expect(msg).toContain('외 2건');
  });

  it('HTML escape 적용 (recordId 안에 < > & 포함)', () => {
    const msg = formatCoherenceAuditMessage(
      buildReport({
        violations: buildViolations({ severity: 'WARN', recordId: '<script>&', message: 'malicious' }),
        summary: {
          totalViolations: 1,
          byInvariant: { I1_OCO_SHADOW_REF: 1 },
          bySeverity: { CRITICAL: 0, WARN: 1, INFO: 0 },
        },
      }),
      10
    );
    expect(msg).toContain('&lt;script&gt;&amp;');
    expect(msg).not.toContain('<script>');
  });
});

describe('coherenceAudit cmd metadata', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('이름·alias·category·riskLevel·visibility 정상', async () => {
    const mod = await import('./coherenceAudit.cmd');
    const cmd = mod.default;
    expect(cmd.name).toBe('/coherence_audit');
    expect(cmd.aliases).toEqual(['/cohere']);
    expect(cmd.category).toBe('SYS');
    expect(cmd.riskLevel).toBe(0);
    expect(cmd.visibility).toBe('ADMIN');
  });

  it('execute 호출 시 reply 호출 (ENV DISABLED 시 ⛔ 메시지)', async () => {
    process.env.CACHE_COHERENCE_AUDIT_DISABLED = 'true';
    const mod = await import('./coherenceAudit.cmd');
    const cmd = mod.default;
    const reply = vi.fn().mockResolvedValue(undefined);
    await cmd.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    const msg = reply.mock.calls[0][0] as string;
    expect(msg).toContain('⛔ 비활성');
    delete process.env.CACHE_COHERENCE_AUDIT_DISABLED;
  });
});
