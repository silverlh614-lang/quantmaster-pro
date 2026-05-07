// @responsibility ADR-0387 ConditionEvalStatus + recordGateAuditByStatus + perEvaluator + postmortem 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// PERSIST_DATA_DIR isolation
const TMP_DATA = mkdtempSync(join(tmpdir(), 'gate-audit-adr0387-'));
const ORIGINAL_DATA_DIR = process.env.PERSIST_DATA_DIR;
process.env.PERSIST_DATA_DIR = TMP_DATA;

const ORIGINAL_PER_LEGACY = process.env.PER_EVALUATOR_LEGACY;

beforeEach(() => {
  delete process.env.PER_EVALUATOR_LEGACY;
});

afterEach(() => {
  if (ORIGINAL_PER_LEGACY === undefined) delete process.env.PER_EVALUATOR_LEGACY;
  else process.env.PER_EVALUATOR_LEGACY = ORIGINAL_PER_LEGACY;
});

afterAll(() => {
  rmSync(TMP_DATA, { recursive: true, force: true });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = ORIGINAL_DATA_DIR;
});

import { afterAll } from 'vitest';
import {
  recordGateAuditByStatus,
  recordGateAudit,
  loadGateAudit,
  saveGateAudit,
} from '../../persistence/gateAuditRepo.js';
import { perEvaluator } from './evaluators.js';
import type { ConditionEvalContext, ConditionEvalStatus } from './types.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

// ── ADR-0387 P0-1: ConditionEvalStatus 타입 ──────────────────────────────────
describe('ConditionEvalStatus 4 분류 SSOT (ADR-0387)', () => {
  it('4 status union — FIRED/DATA_UNAVAILABLE/THRESHOLD_NOT_MET/SANITY_REJECTED', () => {
    const validStatuses: ConditionEvalStatus[] = [
      'FIRED',
      'DATA_UNAVAILABLE',
      'THRESHOLD_NOT_MET',
      'SANITY_REJECTED',
    ];
    expect(validStatuses).toHaveLength(4);
    // 컴파일 시점 검증 — 위 배열이 ConditionEvalStatus 와 일치해야 ts compile 통과
  });
});

// ── ADR-0387 P0-2: recordGateAuditByStatus 분기 ──────────────────────────────
describe('recordGateAuditByStatus — status 기반 3분기 (ADR-0387)', () => {
  beforeEach(() => {
    saveGateAudit({}); // 초기화
  });

  it('FIRED → passed++', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 5, status: 'FIRED' } },
    ]);
    const audit = loadGateAudit();
    // ADR-0388 schema 격상 — `error` 필드 추가 (legacy `??= 0` 자동 채움).
    expect(audit.per).toEqual({ passed: 1, failed: 0, unavailable: 0, error: 0 });
  });

  it('DATA_UNAVAILABLE → unavailable++ (failed 가 아님)', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.unavailable).toBe(1);
    expect(audit.per.failed).toBe(0);
  });

  it('SANITY_REJECTED → unavailable++ (THRESHOLD_NOT_MET 아님 — layer 8 정합)', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 0, status: 'SANITY_REJECTED' } },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.unavailable).toBe(1);
    expect(audit.per.failed).toBe(0);
  });

  it('THRESHOLD_NOT_MET → failed++ (진짜 종목 결함)', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.failed).toBe(1);
    expect(audit.per.unavailable).toBe(0);
  });

  it('legacy null output → failed (status 미명시)', () => {
    recordGateAuditByStatus([
      { key: 'per', output: null },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.failed).toBe(1);
  });

  it('legacy score>0 + status 미명시 → passed (후방호환)', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 5 } },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.passed).toBe(1);
  });

  it('legacy score=0 + status 미명시 → failed (후방호환)', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 0 } },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.failed).toBe(1);
  });

  it('기존 영속 파일 unavailable 부재 → ?? 0 자동 채움 (ADR-0387 backward compat)', () => {
    // legacy schema {passed, failed} 만 영속
    saveGateAudit({ per: { passed: 5, failed: 3 } as { passed: number; failed: number; unavailable?: number } });
    recordGateAuditByStatus([
      { key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
    ]);
    const audit = loadGateAudit();
    expect(audit.per.unavailable).toBe(1); // 0 → 1
    expect(audit.per.passed).toBe(5);
    expect(audit.per.failed).toBe(3);
  });

  it('다중 outputs 일괄 누적', () => {
    recordGateAuditByStatus([
      { key: 'per', output: { score: 5, status: 'FIRED' } },
      { key: 'per', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
      { key: 'per', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
      { key: 'momentum', output: { score: 3, status: 'FIRED' } },
    ]);
    const audit = loadGateAudit();
    // ADR-0388 schema 격상 — `error` 필드 추가 (legacy `??= 0` 자동 채움).
    expect(audit.per).toEqual({ passed: 1, failed: 1, unavailable: 1, error: 0 });
    expect(audit.momentum).toEqual({ passed: 1, failed: 0, unavailable: 0, error: 0 });
  });
});

describe('recordGateAudit (legacy) — backward compat (ADR-0387)', () => {
  beforeEach(() => saveGateAudit({}));
  it('legacy passedKeys API 동작 보존 — 모든 신규 키에 unavailable=0 초기화', () => {
    recordGateAudit(['per']);
    const audit = loadGateAudit();
    expect(audit.per.passed).toBe(1);
    expect(audit.per.unavailable).toBe(0);
  });
});

// ── ADR-0387 P0-3: perEvaluator status 분리 ──────────────────────────────────
describe('perEvaluator — ADR-0387 status + 다단 점수', () => {
  function makeCtx(per: number): ConditionEvalContext {
    return {
      quote: { per } as ConditionEvalContext['quote'],
      weights: DEFAULT_CONDITION_WEIGHTS,
    };
  }

  it('PER 0 → DATA_UNAVAILABLE + score=0 (null 아님 — registry 가 outputs 에 등재)', () => {
    const r = perEvaluator.evaluate(makeCtx(0));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.score).toBe(0);
    expect(r!.detail).toMatch(/데이터 부재/);
  });

  it('PER 음수 → DATA_UNAVAILABLE', () => {
    const r = perEvaluator.evaluate(makeCtx(-5));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('PER 999 (placeholder) → DATA_UNAVAILABLE', () => {
    const r = perEvaluator.evaluate(makeCtx(999));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('PER NaN/Infinity → DATA_UNAVAILABLE', () => {
    expect(perEvaluator.evaluate(makeCtx(NaN))!.status).toBe('DATA_UNAVAILABLE');
    expect(perEvaluator.evaluate(makeCtx(Infinity))!.status).toBe('DATA_UNAVAILABLE');
  });

  it('PER 10 (저평가) → FIRED + 1.2× weight', () => {
    const r = perEvaluator.evaluate(makeCtx(10));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/저평가/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.per * 1.2, 5);
  });

  it('PER 20 (적정) → FIRED + 1.0× weight', () => {
    const r = perEvaluator.evaluate(makeCtx(20));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/적정/);
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.per);
  });

  it('PER 30 (성장주 허용권) → FIRED + 0.5× weight', () => {
    const r = perEvaluator.evaluate(makeCtx(30));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/성장주/);
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.per * 0.5, 5);
  });

  it('PER 80 (고평가) → THRESHOLD_NOT_MET + score=0', () => {
    const r = perEvaluator.evaluate(makeCtx(80));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
    expect(r!.score).toBe(0);
    expect(r!.detail).toMatch(/고평가/);
  });

  it('boundary PER 15 정확 → FIRED 적정 (저평가 < 15 strict)', () => {
    const r = perEvaluator.evaluate(makeCtx(15));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/적정/);
  });

  it('boundary PER 25 정확 → FIRED 성장주 허용권', () => {
    const r = perEvaluator.evaluate(makeCtx(25));
    expect(r!.status).toBe('FIRED');
    expect(r!.detail).toMatch(/성장주/);
  });

  it('boundary PER 35 정확 → THRESHOLD_NOT_MET 고평가', () => {
    const r = perEvaluator.evaluate(makeCtx(35));
    expect(r!.status).toBe('THRESHOLD_NOT_MET');
  });

  it('legacy ENV PER<20 → FIRED flat / PER>=20 → THRESHOLD_NOT_MET', () => {
    process.env.PER_EVALUATOR_LEGACY = 'true';
    const lo = perEvaluator.evaluate(makeCtx(15));
    expect(lo!.status).toBe('FIRED');
    expect(lo!.score).toBe(DEFAULT_CONDITION_WEIGHTS.per); // flat 1.0×
    expect(lo!.detail).not.toMatch(/저평가|성장주/);

    const hi = perEvaluator.evaluate(makeCtx(25));
    expect(hi!.status).toBe('THRESHOLD_NOT_MET');
    expect(hi!.score).toBe(0);
    expect(hi!.detail).toMatch(/legacy/);
  });

  it('legacy ENV — DATA_UNAVAILABLE 분기 동일 작동', () => {
    process.env.PER_EVALUATOR_LEGACY = 'true';
    const r = perEvaluator.evaluate(makeCtx(0));
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('legacy ENV "1" / "TRUE" → 정확 비교로 FALSE (ADR-0157)', () => {
    process.env.PER_EVALUATOR_LEGACY = '1';
    const r = perEvaluator.evaluate(makeCtx(10));
    expect(r!.detail).toMatch(/저평가/); // ADR-0387 신규 모드 그대로
  });
});
