// @responsibility ADR-0388 ConditionRegistry try/catch + ERROR status + 6-status SSOT 회귀
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TMP_DATA = mkdtempSync(join(tmpdir(), 'registry-adr0388-'));
const ORIGINAL_DATA_DIR = process.env.PERSIST_DATA_DIR;
process.env.PERSIST_DATA_DIR = TMP_DATA;

afterAll(() => {
  rmSync(TMP_DATA, { recursive: true, force: true });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = ORIGINAL_DATA_DIR;
});

import { ConditionRegistry } from './registry.js';
import {
  inferStatusFromLegacyResult,
  loadGateAudit,
  recordGateAuditByStatus,
  saveGateAudit,
} from '../../persistence/gateAuditRepo.js';
import type {
  ConditionEvalContext,
  ConditionEvalStatus,
  ConditionEvaluator,
} from './types.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

const ORIGINAL_THROW_ENV = process.env.CONDITION_REGISTRY_THROW_DISABLED;

beforeEach(() => {
  delete process.env.CONDITION_REGISTRY_THROW_DISABLED;
  saveGateAudit({});
});

afterEach(() => {
  if (ORIGINAL_THROW_ENV === undefined) delete process.env.CONDITION_REGISTRY_THROW_DISABLED;
  else process.env.CONDITION_REGISTRY_THROW_DISABLED = ORIGINAL_THROW_ENV;
});

const ctx: ConditionEvalContext = {
  quote: { per: 10 } as ConditionEvalContext['quote'],
  weights: DEFAULT_CONDITION_WEIGHTS,
};

describe('ConditionEvalStatus 6 분류 SSOT (ADR-0388)', () => {
  it('6 status union — FIRED + THRESHOLD_NOT_MET + DATA_UNAVAILABLE + PROVIDER_DEGRADED + SKIPPED_BY_POLICY + SANITY_REJECTED + ERROR', () => {
    const all: ConditionEvalStatus[] = [
      'FIRED',
      'THRESHOLD_NOT_MET',
      'DATA_UNAVAILABLE',
      'PROVIDER_DEGRADED',
      'SKIPPED_BY_POLICY',
      'SANITY_REJECTED',
      'ERROR',
    ];
    expect(all).toHaveLength(7); // 6 분류 + ERROR (총 7값)
  });
});

describe('ConditionRegistry.run try/catch (ADR-0388)', () => {
  function makeThrowEvaluator(key: string): ConditionEvaluator {
    return {
      key: key as ConditionEvaluator['key'],
      description: 'test throwing evaluator',
      inputs: [],
      evaluate() {
        throw new Error(`evaluator ${key} 깨짐`);
      },
    };
  }

  function makeNormalEvaluator(key: string, score: number): ConditionEvaluator {
    return {
      key: key as ConditionEvaluator['key'],
      description: 'test normal evaluator',
      inputs: [],
      evaluate() {
        return {
          score,
          conditionKey: key as ConditionEvaluator['key'],
          detail: `${key} 정상`,
          status: 'FIRED',
        };
      },
    };
  }

  it('default — evaluator 예외 → ERROR status output + run 차단 안 함', () => {
    const reg = new ConditionRegistry()
      .register(makeNormalEvaluator('per', 5))
      .register(makeThrowEvaluator('momentum'))
      .register(makeNormalEvaluator('vcp', 3));

    const result = reg.run(ctx);

    // momentum 의 throw 가 vcp 평가 차단 안 함
    expect(result.outputs).toHaveLength(3);
    const momentumOut = result.outputs.find(o => o.key === 'momentum');
    expect(momentumOut?.output?.status).toBe('ERROR');
    expect(momentumOut?.output?.detail).toMatch(/evaluator 예외/);
    expect(momentumOut?.output?.score).toBe(0);

    // ERROR status 는 totalScore / details / conditionKeys 미합산
    expect(result.totalScore).toBe(8); // 5 + 3 (momentum 제외)
    expect(result.conditionKeys).toEqual(['per', 'vcp']);
    expect(result.details).toHaveLength(2);
  });

  it('legacy ENV (CONDITION_REGISTRY_THROW_DISABLED=true) → 예외 그대로 throw', () => {
    process.env.CONDITION_REGISTRY_THROW_DISABLED = 'true';
    const reg = new ConditionRegistry().register(makeThrowEvaluator('per'));
    expect(() => reg.run(ctx)).toThrow(/evaluator per 깨짐/);
  });

  it('ENV 정확 비교 — "1"/"TRUE" → false (정확 비교, ADR-0157)', () => {
    process.env.CONDITION_REGISTRY_THROW_DISABLED = '1';
    const reg = new ConditionRegistry().register(makeThrowEvaluator('per'));
    // "1" 은 우회 안 됨 → ERROR status 로 catch
    expect(() => reg.run(ctx)).not.toThrow();
  });

  it('throw evaluator 만 있어도 정상 result 반환 (totalScore=0, outputs 1건 ERROR)', () => {
    const reg = new ConditionRegistry().register(makeThrowEvaluator('per'));
    const result = reg.run(ctx);
    expect(result.totalScore).toBe(0);
    expect(result.conditionKeys).toEqual([]);
    expect(result.outputs[0].output?.status).toBe('ERROR');
  });

  it('non-Error throw (string/object) 도 안전 catch', () => {
    const reg = new ConditionRegistry().register({
      key: 'per' as ConditionEvaluator['key'],
      description: 'string throw',
      inputs: [],
      evaluate() {
        throw 'string error';
      },
    });
    const result = reg.run(ctx);
    expect(result.outputs[0].output?.status).toBe('ERROR');
    expect(result.outputs[0].output?.detail).toMatch(/string error/);
  });
});

describe('inferStatusFromLegacyResult 방어 헬퍼 (ADR-0388)', () => {
  it('context.skippedByPolicy=true → SKIPPED_BY_POLICY 우선', () => {
    expect(inferStatusFromLegacyResult(null, { skippedByPolicy: true })).toBe('SKIPPED_BY_POLICY');
    // result 있어도 skipByPolicy 우선
    expect(
      inferStatusFromLegacyResult({ score: 5, status: 'FIRED' }, { skippedByPolicy: true }),
    ).toBe('SKIPPED_BY_POLICY');
  });

  it('null + hadRequiredData=false → DATA_UNAVAILABLE', () => {
    expect(inferStatusFromLegacyResult(null, { hadRequiredData: false })).toBe('DATA_UNAVAILABLE');
  });

  it('null + context 부재 → THRESHOLD_NOT_MET (legacy 기본 가정)', () => {
    expect(inferStatusFromLegacyResult(null)).toBe('THRESHOLD_NOT_MET');
  });

  it('null + hadRequiredData=true → THRESHOLD_NOT_MET', () => {
    expect(inferStatusFromLegacyResult(null, { hadRequiredData: true })).toBe('THRESHOLD_NOT_MET');
  });

  it('result.status 명시 → 그대로 반환 (우선순위 4)', () => {
    expect(inferStatusFromLegacyResult({ score: 0, status: 'PROVIDER_DEGRADED' })).toBe('PROVIDER_DEGRADED');
    expect(inferStatusFromLegacyResult({ score: 5, status: 'FIRED' })).toBe('FIRED');
    expect(inferStatusFromLegacyResult({ score: 0, status: 'ERROR' })).toBe('ERROR');
  });

  it('result.status 미명시 + score>0 → FIRED (legacy 후방호환)', () => {
    expect(inferStatusFromLegacyResult({ score: 5 })).toBe('FIRED');
  });

  it('result.status 미명시 + score=0 → THRESHOLD_NOT_MET', () => {
    expect(inferStatusFromLegacyResult({ score: 0 })).toBe('THRESHOLD_NOT_MET');
  });

  it('우선순위 정합 — context.skippedByPolicy > status 명시', () => {
    expect(
      inferStatusFromLegacyResult({ score: 5, status: 'FIRED' }, { skippedByPolicy: true }),
    ).toBe('SKIPPED_BY_POLICY');
  });
});

describe('recordGateAuditByStatus — 7 status 분기 + ERROR 별도 카운트 (ADR-0388)', () => {
  beforeEach(() => saveGateAudit({}));

  it('FIRED → passed++', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 5, status: 'FIRED' } }]);
    expect(loadGateAudit().per).toEqual({ passed: 1, failed: 0, unavailable: 0, error: 0 });
  });

  it('THRESHOLD_NOT_MET → failed++', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' } }]);
    expect(loadGateAudit().per.failed).toBe(1);
    expect(loadGateAudit().per.error).toBe(0);
  });

  it('DATA_UNAVAILABLE → unavailable++', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE' } }]);
    expect(loadGateAudit().per.unavailable).toBe(1);
  });

  it('PROVIDER_DEGRADED → unavailable++ (Yahoo stale, KRX indexCode 누락 정합)', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'PROVIDER_DEGRADED' } }]);
    expect(loadGateAudit().per.unavailable).toBe(1);
  });

  it('SKIPPED_BY_POLICY → unavailable++ (Volume Clock, R6 차단 정합)', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'SKIPPED_BY_POLICY' } }]);
    expect(loadGateAudit().per.unavailable).toBe(1);
  });

  it('SANITY_REJECTED → unavailable++ (drift 데드존)', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'SANITY_REJECTED' } }]);
    expect(loadGateAudit().per.unavailable).toBe(1);
  });

  it('ERROR → error++ (failed 와 분리 — 핵심 ADR-0388 검증)', () => {
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'ERROR' } }]);
    expect(loadGateAudit().per).toEqual({ passed: 0, failed: 0, unavailable: 0, error: 1 });
    // ERROR 가 failed 에 합산되지 않았음 — 사용자 명시 요구사항
  });

  it('THRESHOLD_NOT_MET vs ERROR 명시적 분리 — 시나리오 검증', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
      { key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
      { key: 'per', output: { score: 0, status: 'ERROR' } },
      { key: 'per', output: { score: 0, status: 'ERROR' } },
      { key: 'per', output: { score: 0, status: 'ERROR' } },
    ]);
    const stats = loadGateAudit().per;
    expect(stats.failed).toBe(2); // 진짜 임계 미달 — 정확
    expect(stats.error).toBe(3);  // evaluator 깨짐 — 별도 카운트
  });

  it('context.skippedByPolicy 전달 시 우선 적용', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 5, status: 'FIRED' }, context: { skippedByPolicy: true } },
    ]);
    expect(loadGateAudit().per.unavailable).toBe(1);
    expect(loadGateAudit().per.passed).toBe(0); // status=FIRED 무시
  });

  it('context.hadRequiredData=false + null result → DATA_UNAVAILABLE', () => {
    recordGateAuditByStatus([
      { key: 'per', output: null, context: { hadRequiredData: false } },
    ]);
    expect(loadGateAudit().per.unavailable).toBe(1);
    expect(loadGateAudit().per.failed).toBe(0);
  });

  it('legacy 영속 파일 (error 부재) → ?? 0 자동 채움', () => {
    saveGateAudit({
      per: { passed: 5, failed: 3, unavailable: 2 } as { passed: number; failed: number; unavailable?: number; error?: number },
    });
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'ERROR' } }]);
    const stats = loadGateAudit().per;
    expect(stats.error).toBe(1);
    expect(stats.passed).toBe(5);
    expect(stats.failed).toBe(3);
    expect(stats.unavailable).toBe(2);
  });

  it('legacy schema (passed/failed 만) → unavailable + error 둘 다 0 자동 채움', () => {
    saveGateAudit({
      per: { passed: 1, failed: 1 } as { passed: number; failed: number; unavailable?: number; error?: number },
    });
    recordGateAuditByStatus([{ key: 'per', output: { score: 0, status: 'PROVIDER_DEGRADED' } }]);
    const stats = loadGateAudit().per;
    expect(stats.unavailable).toBe(1);
    expect(stats.error).toBe(0);
  });

  it('사용자 명시 핵심 시나리오 — PER 진단 정확도', () => {
    // 100건 중 4 passed + 4 failed + 92 unavailable
    recordGateAuditByStatus([
      ...Array(4).fill(null).map(() => ({ key: 'per', output: { score: 5, status: 'FIRED' as ConditionEvalStatus } })),
      ...Array(4).fill(null).map(() => ({ key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' as ConditionEvalStatus } })),
      ...Array(92).fill(null).map(() => ({ key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE' as ConditionEvalStatus } })),
    ]);
    const stats = loadGateAudit().per;
    expect(stats.passed).toBe(4);
    expect(stats.failed).toBe(4);
    expect(stats.unavailable).toBe(92);
    expect(stats.error).toBe(0);
    // 진단: PER 조건이 엄격한 문제가 아니라 데이터 커버리지 문제 — 정확
  });

  it('사용자 명시 evaluator 결함 시나리오 — error 우세', () => {
    // 100건 중 4 passed + 4 failed + 12 unavailable + 80 error
    recordGateAuditByStatus([
      ...Array(4).fill(null).map(() => ({ key: 'per', output: { score: 5, status: 'FIRED' as ConditionEvalStatus } })),
      ...Array(4).fill(null).map(() => ({ key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' as ConditionEvalStatus } })),
      ...Array(12).fill(null).map(() => ({ key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE' as ConditionEvalStatus } })),
      ...Array(80).fill(null).map(() => ({ key: 'per', output: { score: 0, status: 'ERROR' as ConditionEvalStatus } })),
    ]);
    const stats = loadGateAudit().per;
    expect(stats.error).toBe(80);
    // 진단: 데이터 부재 < evaluator 런타임 결함 → patch / parsing 결함 의심
  });
});
