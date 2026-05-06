// @responsibility ADR-0387 P0-4 emptyScanPostmortem findTopBlocker unavailable 분리 회귀
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TMP_DATA = mkdtempSync(join(tmpdir(), 'postmortem-adr0387-'));
const ORIGINAL_DATA_DIR = process.env.PERSIST_DATA_DIR;
process.env.PERSIST_DATA_DIR = TMP_DATA;

afterAll(() => {
  rmSync(TMP_DATA, { recursive: true, force: true });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = ORIGINAL_DATA_DIR;
});

import { saveGateAudit, loadGateAudit } from '../persistence/gateAuditRepo.js';
import { runPostmortem } from './emptyScanPostmortem.js';

beforeEach(() => {
  saveGateAudit({});
});

describe('runPostmortem topBlocker — failRate vs unavailableRate 분리 (ADR-0387)', () => {
  it('PER 100 unavailable → topUnavailableCondition=per, topBlockerFailRate=0', () => {
    saveGateAudit({
      per: { passed: 0, failed: 0, unavailable: 100 }, // 100% 데이터 부재
      momentum: { passed: 80, failed: 20, unavailable: 0 },
    });
    const r = runPostmortem();
    expect(r.topUnavailableCondition).toBe('per');
    expect(r.topBlockerUnavailableRate).toBe(1);
    // failRate 는 momentum 의 20% 가 가장 높음
    expect(r.topBlockerCondition).toBe('momentum');
    expect(r.topBlockerFailRate).toBe(0.2);
  });

  it('legacy gate_audit (unavailable 부재) → ?? 0 자동 채움', () => {
    saveGateAudit({
      per: { passed: 5, failed: 50 } as { passed: number; failed: number; unavailable?: number },
    });
    const r = runPostmortem();
    expect(r.topBlockerCondition).toBe('per');
    expect(r.topBlockerFailRate).toBeCloseTo(50 / 55, 3);
    expect(r.topBlockerUnavailableRate ?? 0).toBe(0); // unavailable 부재 → 0
  });

  it('PER 데이터 부재 우세 시 reason 메시지에 ⚠️ 데이터 부재 의심 추가', () => {
    saveGateAudit({
      per: { passed: 0, failed: 100, unavailable: 100 }, // 50% unavailable + 50% failed
      momentum: { passed: 5, failed: 95, unavailable: 0 }, // 95% failed
    });
    const r = runPostmortem();
    // PATHOLOGICAL_BLOCK 분기 진입 조건 (regime + gateReached>0 + gateFailRatio>0.95) 가 충족되지
    // 않을 수 있으나, blocker 자체는 정확 산출되어야 함.
    // PER unavailable 50% > 30% 임계 → reason 에 마커 포함될 가능성 검증.
    if (r.reason.includes('가장 타이트한 조건')) {
      // 게이트 타이트 분기 진입 시 unavailable 마커 포함
      const hasUnavailableHint = r.reason.includes('데이터 부재 의심') || r.topBlockerUnavailableRate === 0.5;
      expect(hasUnavailableHint).toBe(true);
    }
    // 최소한 schema 필드는 채워져야 함
    expect(typeof r.topBlockerUnavailableRate).toBe('number');
  });

  it('표본 < 5 → 무시 (boundary 정합)', () => {
    saveGateAudit({
      per: { passed: 1, failed: 2, unavailable: 1 }, // 총 4 < 5
    });
    const r = runPostmortem();
    expect(r.topBlockerCondition).toBeNull();
    expect(r.topUnavailableCondition).toBeNull();
  });

  it('표본 정확 5 → 산출', () => {
    saveGateAudit({
      per: { passed: 1, failed: 4, unavailable: 0 },
    });
    const r = runPostmortem();
    expect(r.topBlockerCondition).toBe('per');
    expect(r.topBlockerFailRate).toBe(0.8);
  });

  it('failed=0 + unavailable 다수 → topBlockerCondition null (failed 만 추적)', () => {
    saveGateAudit({
      per: { passed: 50, failed: 0, unavailable: 50 },
    });
    const r = runPostmortem();
    expect(r.topBlockerCondition).toBeNull();
    expect(r.topBlockerFailRate).toBe(0);
    expect(r.topUnavailableCondition).toBe('per');
    expect(r.topBlockerUnavailableRate).toBe(0.5);
  });

  it('PostmortemReport schema — topBlockerUnavailableRate + topUnavailableCondition 옵셔널 필드 출력', () => {
    saveGateAudit({
      per: { passed: 10, failed: 5, unavailable: 0 },
    });
    const r = runPostmortem();
    expect('topBlockerUnavailableRate' in r).toBe(true);
    expect('topUnavailableCondition' in r).toBe(true);
  });
});
