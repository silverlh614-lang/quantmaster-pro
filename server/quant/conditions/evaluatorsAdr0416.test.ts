// @responsibility ADR-0416 Phase 1 — supply_confluence/earnings_quality DATA_UNAVAILABLE 의미론 + audit 분류 회귀
/**
 * ADR-0416 (2026-05-07, Phase 1):
 *   외부 데이터 의존 evaluator (supplyConfluence + earningsQuality) 가 입력 부재 시
 *   `null` 만 반환하던 흐름을 `score: 0 + status: 'DATA_UNAVAILABLE'` 으로 격상.
 *
 * 핵심 불변식:
 *   status === 'DATA_UNAVAILABLE' 인 결과는 score 가 0 이어도 절대 failed++ 로
 *   분류되면 안 된다. 반드시 unavailable++ 로 분류되어야 한다.
 *
 * 본 테스트는 5 핵심 + 1 회귀 보호 케이스를 강제한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  supplyConfluenceEvaluator,
  earningsQualityEvaluator,
} from './evaluators.js';
import type { ConditionEvalContext } from './types.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

// ── 격리된 영속 디렉토리 (gateAuditRepo 호출 시 작업 디렉토리 오염 방지) ───
// gateAuditRepo 의 module-level `_auditCache` 가 테스트 간 누적을 유발하므로
// vi.resetModules() 와 dynamic import 로 매 테스트마다 fresh 모듈 인스턴스 사용.
let _tmpDataDir: string | null = null;

beforeEach(() => {
  _tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0416-'));
  process.env.PERSIST_DATA_DIR = _tmpDataDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  if (_tmpDataDir && fs.existsSync(_tmpDataDir)) {
    fs.rmSync(_tmpDataDir, { recursive: true, force: true });
  }
  _tmpDataDir = null;
});

function makeQuote(overrides: Record<string, number | undefined> = {}): ConditionEvalContext['quote'] {
  return overrides as unknown as ConditionEvalContext['quote'];
}

const ctx = (extras: Partial<ConditionEvalContext> = {}): ConditionEvalContext => ({
  quote: makeQuote(),
  weights: DEFAULT_CONDITION_WEIGHTS,
  ...extras,
});

// ─── Test 1: supply_confluence + kisFlow null → DATA_UNAVAILABLE ─────────────
describe('supplyConfluenceEvaluator (ADR-0416 Phase 1)', () => {
  it('kisFlow=null → DATA_UNAVAILABLE + score 0 + conditionKey 정확', () => {
    const r = supplyConfluenceEvaluator.evaluate(ctx({ kisFlow: null }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.score).toBe(0);
    expect(r!.conditionKey).toBe('supply_confluence');
    expect(r!.detail).toMatch(/KIS Investor Flow unavailable/);
  });

  it('kisFlow=undefined → DATA_UNAVAILABLE (동일 분기)', () => {
    const r = supplyConfluenceEvaluator.evaluate(ctx({ kisFlow: undefined }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.score).toBe(0);
  });

  it('kisFlow 정상 + 양쪽 매수 → FIRED (정상 평가 보존)', () => {
    const r = supplyConfluenceEvaluator.evaluate(ctx({
      kisFlow: { institutionalNetBuy: 5000, foreignNetBuy: 3000 } as ConditionEvalContext['kisFlow'],
    }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.supply_confluence);
    expect(r!.detail).toMatch(/수급합치/);
  });

  it('kisFlow 정상 + 한쪽만 매수 → FIRED 단독 (0.6 가중)', () => {
    const r = supplyConfluenceEvaluator.evaluate(ctx({
      kisFlow: { institutionalNetBuy: 5000, foreignNetBuy: -1000 } as ConditionEvalContext['kisFlow'],
    }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.supply_confluence * 0.6, 5);
    expect(r!.detail).toMatch(/수급단독/);
  });

  it('kisFlow 정상 + 양쪽 모두 매도 → null (THRESHOLD_NOT_MET 의도, 진짜 임계 미달)', () => {
    // 데이터는 가용했지만 매수 신호 없음 — DATA_UNAVAILABLE 가 아니라 임계 미달.
    const r = supplyConfluenceEvaluator.evaluate(ctx({
      kisFlow: { institutionalNetBuy: -1000, foreignNetBuy: -2000 } as ConditionEvalContext['kisFlow'],
    }));
    expect(r).toBeNull();
  });
});

// ─── Test 2: earnings_quality + dartFin null → DATA_UNAVAILABLE ──────────────
describe('earningsQualityEvaluator (ADR-0416 Phase 1)', () => {
  it('dartFin=null → DATA_UNAVAILABLE + score 0 + conditionKey 정확', () => {
    const r = earningsQualityEvaluator.evaluate(ctx({ dartFin: null }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('DATA_UNAVAILABLE');
    expect(r!.score).toBe(0);
    expect(r!.conditionKey).toBe('earnings_quality');
    expect(r!.detail).toMatch(/DART financial data unavailable/);
  });

  it('dartFin=undefined → DATA_UNAVAILABLE', () => {
    const r = earningsQualityEvaluator.evaluate(ctx({ dartFin: undefined }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('dartFin.ocfRatio=null → DATA_UNAVAILABLE (개별 필드 부재도 동일 처리)', () => {
    const r = earningsQualityEvaluator.evaluate(ctx({
      dartFin: { ocfRatio: null } as unknown as ConditionEvalContext['dartFin'],
    }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('DATA_UNAVAILABLE');
  });

  it('dartFin.ocfRatio = 6.0 → FIRED 양호', () => {
    const r = earningsQualityEvaluator.evaluate(ctx({
      dartFin: { ocfRatio: 6.0 } as unknown as ConditionEvalContext['dartFin'],
    }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBe(DEFAULT_CONDITION_WEIGHTS.earnings_quality);
  });

  it('dartFin.ocfRatio = 2.0 → FIRED 기본 (0.5 가중)', () => {
    const r = earningsQualityEvaluator.evaluate(ctx({
      dartFin: { ocfRatio: 2.0 } as unknown as ConditionEvalContext['dartFin'],
    }));
    expect(r).not.toBeNull();
    expect(r!.status).toBe('FIRED');
    expect(r!.score).toBeCloseTo(DEFAULT_CONDITION_WEIGHTS.earnings_quality * 0.5, 5);
  });

  it('dartFin.ocfRatio = 0.5 → null (THRESHOLD_NOT_MET 의도, 진짜 임계 미달)', () => {
    // 데이터는 가용했지만 OCF 비율 < 1% — DATA_UNAVAILABLE 가 아니라 임계 미달.
    const r = earningsQualityEvaluator.evaluate(ctx({
      dartFin: { ocfRatio: 0.5 } as unknown as ConditionEvalContext['dartFin'],
    }));
    expect(r).toBeNull();
  });
});

// ─── Test 3: audit 분류 — DATA_UNAVAILABLE 은 unavailable, failed 아님 ───────
describe('recordGateAuditByStatus + DATA_UNAVAILABLE 핵심 불변식 (ADR-0416)', () => {
  it('output.status=DATA_UNAVAILABLE + score=0 → unavailable++, failed 미증가', async () => {
    const { recordGateAuditByStatus, loadGateAudit } = await import('../../persistence/gateAuditRepo.js');

    recordGateAuditByStatus([
      {
        key: 'supply_confluence',
        output: { score: 0, status: 'DATA_UNAVAILABLE' },
      },
    ]);

    const store = loadGateAudit();
    expect(store.supply_confluence).toBeDefined();
    expect(store.supply_confluence.unavailable ?? 0).toBe(1);
    expect(store.supply_confluence.failed).toBe(0);
    expect(store.supply_confluence.passed).toBe(0);
    expect(store.supply_confluence.error ?? 0).toBe(0);
  });

  it('context.hadRequiredData=false + null result → DATA_UNAVAILABLE 으로 분류', async () => {
    const { recordGateAuditByStatus, loadGateAudit } = await import('../../persistence/gateAuditRepo.js');

    // legacy null 반환 + context 가 외부 데이터 부재를 명시 → DATA_UNAVAILABLE
    recordGateAuditByStatus([
      {
        key: 'supply_confluence',
        output: null,
        context: { evaluatorKey: 'supply_confluence', hadRequiredData: false },
      },
    ]);

    const store = loadGateAudit();
    expect(store.supply_confluence.unavailable ?? 0).toBe(1);
    expect(store.supply_confluence.failed).toBe(0);
  });

  it('context 미전달 + null result → THRESHOLD_NOT_MET (legacy 후방호환 보존)', async () => {
    const { recordGateAuditByStatus, loadGateAudit } = await import('../../persistence/gateAuditRepo.js');

    // 기존 호환 — context 부재 시 null 은 임계 미달로 추정.
    // 외부 데이터 의존 evaluator 는 stockScreener 에서 context 를 명시 주입하여 오염 차단.
    recordGateAuditByStatus([
      { key: 'momentum', output: null },
    ]);

    const store = loadGateAudit();
    expect(store.momentum.failed).toBe(1);
    expect(store.momentum.unavailable ?? 0).toBe(0);
  });

  it('DATA_UNAVAILABLE 이 다수 발생해도 failed 분모 오염 0 — 핵심 불변식', async () => {
    const { recordGateAuditByStatus, loadGateAudit } = await import('../../persistence/gateAuditRepo.js');

    // 사용자 보고 시나리오 — KIS/DART 일시 장애 시 supply_confluence 가 100% null.
    // 기존 결함: 모두 failed++ → "supply_confluence top blocker" 잘못된 진단.
    // ADR-0416 효과: 모두 unavailable++ → "데이터 소스 점검" 정확한 진단 가능.
    for (let i = 0; i < 10; i++) {
      recordGateAuditByStatus([
        { key: 'supply_confluence', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
      ]);
    }

    const store = loadGateAudit();
    expect(store.supply_confluence.unavailable ?? 0).toBe(10);
    expect(store.supply_confluence.failed).toBe(0); // 핵심 — failed 분모 오염 0
    expect(store.supply_confluence.passed).toBe(0);
  });
});

// ─── Test 4: stockScreener 임시 inclusion list — ADR-0418 영구 제거 회귀 가드 ─
describe('stockScreener inclusion list (ADR-0416 → ADR-0418 영구 제거 정합)', () => {
  it('ADR-0418 후 — DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL Set 제거', () => {
    const screenerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../screener/stockScreener.ts'),
      'utf-8',
    );

    // ADR-0418 Phase 3 — registry.run 자동 메타로 inclusion list 영구 제거.
    // 이 정적 grep 가드는 inclusion list 재도입 회귀를 영구 차단.
    expect(screenerSrc).not.toMatch(/new Set<string>\(\[[\s\S]*'supply_confluence'/);
    expect(screenerSrc).not.toMatch(/new Set<string>\(\[[\s\S]*'earnings_quality'/);

    // ADR-0418 추적성 주석 의무 (제거 사유 영속 — 향후 개발자가 inclusion list
    // 패턴을 다시 도입하지 않도록).
    expect(screenerSrc).toMatch(/ADR-0418 Phase 3/);
    expect(screenerSrc).toMatch(/registry\.run/);
    expect(screenerSrc).toMatch(/영구 제거/);
  });

  it('ADR-0418 후 — recordGateAuditByStatus 호출 시 o.context 그대로 전달', () => {
    const screenerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../screener/stockScreener.ts'),
      'utf-8',
    );

    // 호출자가 evaluator 별 knowledge 를 가지지 않음 — `o.context` 를 그대로 전달.
    expect(screenerSrc).toMatch(/o\.context/);
    expect(screenerSrc).toMatch(/hadRequiredData: o\.context\.hadRequiredData/);
  });
});
