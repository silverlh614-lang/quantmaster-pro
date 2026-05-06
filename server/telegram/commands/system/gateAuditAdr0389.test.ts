// @responsibility ADR-0389 /gate_audit conditionStatusRows 출력 회귀
import { describe, expect, it } from 'vitest';
import { buildConditionStatusRows, formatGateAuditMessage } from './gateAudit.cmd.js';

describe('buildConditionStatusRows (ADR-0387/0388 → ADR-0389 출력)', () => {
  it('빈 audit → 빈 배열', () => {
    expect(buildConditionStatusRows({})).toEqual([]);
  });

  it('표본 < 5 → 제외', () => {
    expect(
      buildConditionStatusRows({
        per: { passed: 1, failed: 1, unavailable: 1, error: 1 }, // 총 4
      }),
    ).toEqual([]);
  });

  it('error ≥ 10% → worstStatus=ERROR (최우선)', () => {
    const rows = buildConditionStatusRows({
      per: { passed: 70, failed: 10, unavailable: 5, error: 15 }, // error 15%
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].worstStatus).toBe('ERROR');
  });

  it('unavailable ≥ 50% + error < 10% → worstStatus=UNAVAILABLE', () => {
    const rows = buildConditionStatusRows({
      per: { passed: 30, failed: 10, unavailable: 60, error: 0 }, // unavailable 60%
    });
    expect(rows[0].worstStatus).toBe('UNAVAILABLE');
  });

  it('failed ≥ 70% + error < 10% + unavailable < 50% → worstStatus=FAILED', () => {
    const rows = buildConditionStatusRows({
      per: { passed: 10, failed: 80, unavailable: 5, error: 5 }, // failed 80%
    });
    expect(rows[0].worstStatus).toBe('FAILED');
  });

  it('정상 분포 → worstStatus=OK', () => {
    const rows = buildConditionStatusRows({
      per: { passed: 60, failed: 30, unavailable: 5, error: 5 },
    });
    expect(rows[0].worstStatus).toBe('OK');
  });

  it('정렬 — ERROR > UNAVAILABLE > FAILED > OK 그룹 + 그룹 내 표본 큰 순', () => {
    const rows = buildConditionStatusRows({
      per:          { passed: 80, failed: 20, unavailable: 0,   error: 0   }, // OK
      momentum:     { passed: 30, failed: 10, unavailable: 60,  error: 0   }, // UNAVAILABLE
      vcp:          { passed: 70, failed: 10, unavailable: 5,   error: 15  }, // ERROR
      volume_surge: { passed: 10, failed: 80, unavailable: 5,   error: 5   }, // FAILED
    });
    expect(rows.map(r => r.key)).toEqual(['vcp', 'momentum', 'volume_surge', 'per']);
  });

  it('topN limit', () => {
    const audit: Record<string, { passed: number; failed: number; unavailable: number; error: number }> = {};
    for (let i = 0; i < 20; i++) {
      audit[`cond${i}`] = { passed: 10, failed: 10, unavailable: 10, error: 10 };
    }
    expect(buildConditionStatusRows(audit, 5)).toHaveLength(5);
  });

  it('legacy 영속 (unavailable/error 부재) → ?? 0 안전', () => {
    const rows = buildConditionStatusRows({
      per: { passed: 5, failed: 5 } as { passed: number; failed: number; unavailable?: number; error?: number },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].unavailable).toBe(0);
    expect(rows[0].error).toBe(0);
    expect(rows[0].total).toBe(10);
  });
});

describe('formatGateAuditMessage — conditionStatusRows 섹션 (ADR-0389)', () => {
  const baseInput = {
    windowDays: 7,
    buckets: [],
    daily: [],
    totalGhostsInWindow: 0,
    macro: null,
    scan: null,
    diagnostic: 'NO_OBVIOUS_BLOCK' as const,
    diagnosticHint: '진단 힌트',
    emergencyStop: false,
    autoTradePaused: false,
    autoTradeEnabled: true,
    autoTradeMode: 'SHADOW',
  };

  it('conditionStatusRows 미전달 → 섹션 미노출 (후방호환)', () => {
    const msg = formatGateAuditMessage(baseInput);
    expect(msg).not.toMatch(/조건별 status/);
  });

  it('conditionStatusRows 빈 배열 → 섹션 미노출', () => {
    const msg = formatGateAuditMessage({ ...baseInput, conditionStatusRows: [] });
    expect(msg).not.toMatch(/조건별 status/);
  });

  it('FIRED 만 있는 row → 섹션 노출 + 마커 없음', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      conditionStatusRows: [
        { key: 'per', passed: 80, failed: 20, unavailable: 0, error: 0, total: 100, worstStatus: 'OK' },
      ],
    });
    expect(msg).toMatch(/📐 조건별 status/);
    expect(msg).toMatch(/per: passed=80 failed=20 unavailable=0\(0%\) error=0\(0%\)/);
    expect(msg).not.toMatch(/❌|⚠️|🚧/);
  });

  it('ERROR worstStatus → ❌ 마커', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      conditionStatusRows: [
        { key: 'vcp', passed: 70, failed: 10, unavailable: 5, error: 15, total: 100, worstStatus: 'ERROR' },
      ],
    });
    expect(msg).toMatch(/vcp:.*error=15\(15%\) ❌/);
  });

  it('UNAVAILABLE worstStatus → ⚠️ 마커', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      conditionStatusRows: [
        { key: 'per', passed: 30, failed: 10, unavailable: 60, error: 0, total: 100, worstStatus: 'UNAVAILABLE' },
      ],
    });
    expect(msg).toMatch(/per:.*unavailable=60\(60%\).*⚠️/);
  });

  it('FAILED worstStatus → 🚧 마커', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      conditionStatusRows: [
        { key: 'momentum', passed: 10, failed: 80, unavailable: 5, error: 5, total: 100, worstStatus: 'FAILED' },
      ],
    });
    expect(msg).toMatch(/momentum:.*failed=80.*🚧/);
  });

  it('범례 라인 출력', () => {
    const msg = formatGateAuditMessage({
      ...baseInput,
      conditionStatusRows: [
        { key: 'per', passed: 80, failed: 20, unavailable: 0, error: 0, total: 100, worstStatus: 'OK' },
      ],
    });
    expect(msg).toMatch(/❌=evaluator 결함.*⚠️=데이터 부재.*🚧=임계 미달/);
  });
});
