// @responsibility ADR-0418 Phase 3 — registry.run 자동 EvaluatorRunContext 도출 + stockScreener inclusion list 영구 제거 회귀
/**
 * ADR-0418 (2026-05-07, Phase 3):
 *   evaluator.inputs 메타로부터 registry.run() 이 requiredData / availableData /
 *   hadRequiredData 자동 생성. 호출자(stockScreener)는 evaluator-specific knowledge
 *   를 가질 필요 없음.
 *
 * 핵심 불변식:
 *   1. evaluator.inputs 의 'quote.X' 는 requiredData 에서 제외 (quote 항상 가용).
 *   2. 'ctx.kisFlow.X' → requiredData 에 'kisFlow' 추가.
 *   3. 'ctx.dartFin.X' → requiredData 에 'dartFin' 추가.
 *   4. 'ctx.kospi20dReturn' → requiredData 에 'kospi20dReturn' 추가 (서브 path 없음).
 *   5. recordGateAuditByStatus(gate.outputs) 한 줄로 audit 정확 동작.
 *   6. DATA_UNAVAILABLE 은 failed 가 아니다.
 *   7. stockScreener 임시 inclusion list 영구 제거.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  ConditionRegistry,
  deriveEvaluatorContext,
  extractExternalDataKey,
  isExternalDataAvailable,
} from './registry.js';
import {
  supplyConfluenceEvaluator,
  earningsQualityEvaluator,
  momentumEvaluator,
  perEvaluator,
  relativeStrengthEvaluator,
} from './evaluators.js';
import type { ConditionEvalContext, ConditionEvaluator } from './types.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../quantFilter.js';

// ── 격리 ────────────────────────────────────────────────────────────────────
let _tmpDataDir: string | null = null;

beforeEach(() => {
  _tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0418-'));
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

function makeQuote(overrides: Record<string, unknown> = {}): ConditionEvalContext['quote'] {
  return overrides as unknown as ConditionEvalContext['quote'];
}

const ctxOf = (extras: Partial<ConditionEvalContext> = {}): ConditionEvalContext => ({
  quote: makeQuote(),
  weights: DEFAULT_CONDITION_WEIGHTS,
  ...extras,
});

// ─── Test 1: extractExternalDataKey SSOT 헬퍼 ───────────────────────────────
describe('extractExternalDataKey (ADR-0418 SSOT)', () => {
  it('quote.X → null (quote 는 외부 데이터 아님)', () => {
    expect(extractExternalDataKey('quote.per' as Parameters<typeof extractExternalDataKey>[0])).toBeNull();
    expect(extractExternalDataKey('quote.changePercent' as Parameters<typeof extractExternalDataKey>[0])).toBeNull();
  });

  it('ctx.<single> → 그대로 추출', () => {
    expect(extractExternalDataKey('ctx.kospi20dReturn' as Parameters<typeof extractExternalDataKey>[0])).toBe('kospi20dReturn');
  });

  it('ctx.<key>.<sub> → top-level key 만 추출', () => {
    expect(extractExternalDataKey('ctx.kisFlow.institutionalNetBuy' as Parameters<typeof extractExternalDataKey>[0])).toBe('kisFlow');
    expect(extractExternalDataKey('ctx.dartFin.ocfRatio' as Parameters<typeof extractExternalDataKey>[0])).toBe('dartFin');
  });

  it('알 수 없는 prefix → null (안전 fallback)', () => {
    expect(extractExternalDataKey('foo.bar' as Parameters<typeof extractExternalDataKey>[0])).toBeNull();
  });
});

// ─── Test 2: isExternalDataAvailable SSOT 헬퍼 ──────────────────────────────
describe('isExternalDataAvailable (ADR-0418 SSOT)', () => {
  it('null/undefined → false', () => {
    expect(isExternalDataAvailable(ctxOf({ kisFlow: null }), 'kisFlow')).toBe(false);
    expect(isExternalDataAvailable(ctxOf({ kisFlow: undefined }), 'kisFlow')).toBe(false);
    expect(isExternalDataAvailable(ctxOf(), 'kisFlow')).toBe(false);
  });

  it('정상 객체 → true', () => {
    expect(isExternalDataAvailable(
      ctxOf({ kisFlow: { institutionalNetBuy: 100, foreignNetBuy: 50 } as ConditionEvalContext['kisFlow'] }),
      'kisFlow',
    )).toBe(true);
  });

  it('number — finite → true / NaN → false / Infinity → false', () => {
    expect(isExternalDataAvailable(ctxOf({ kospi20dReturn: 5 }), 'kospi20dReturn')).toBe(true);
    expect(isExternalDataAvailable(ctxOf({ kospi20dReturn: 0 }), 'kospi20dReturn')).toBe(true); // 0 은 finite
    expect(isExternalDataAvailable(ctxOf({ kospi20dReturn: NaN }), 'kospi20dReturn')).toBe(false);
    expect(isExternalDataAvailable(ctxOf({ kospi20dReturn: Infinity }), 'kospi20dReturn')).toBe(false);
  });

  it('빈 배열 → false (사용자 명시 edge case — weeklyBars=[] truthy 지만 데이터 없음)', () => {
    const ctxWithEmptyArray = { quote: makeQuote(), weights: DEFAULT_CONDITION_WEIGHTS, weeklyBars: [] } as unknown as ConditionEvalContext;
    expect(isExternalDataAvailable(ctxWithEmptyArray, 'weeklyBars')).toBe(false);
  });

  it('비어있지 않은 배열 → true', () => {
    const ctxWithArray = { quote: makeQuote(), weights: DEFAULT_CONDITION_WEIGHTS, weeklyBars: [{ close: 100 }] } as unknown as ConditionEvalContext;
    expect(isExternalDataAvailable(ctxWithArray, 'weeklyBars')).toBe(true);
  });
});

// ─── Test 3: deriveEvaluatorContext — 핵심 SSOT ──────────────────────────────
describe('deriveEvaluatorContext (ADR-0418 SSOT)', () => {
  it('🚨 핵심 — supply_confluence + ctx.kisFlow=null → hadRequiredData=false', () => {
    const ctx = ctxOf({ kisFlow: null });
    const result = deriveEvaluatorContext(supplyConfluenceEvaluator, ctx);
    expect(result.requiredData).toContain('kisFlow');
    expect(result.availableData.kisFlow).toBe(false);
    expect(result.hadRequiredData).toBe(false);
  });

  it('🚨 핵심 — earnings_quality + ctx.dartFin=null → hadRequiredData=false', () => {
    const ctx = ctxOf({ dartFin: null });
    const result = deriveEvaluatorContext(earningsQualityEvaluator, ctx);
    expect(result.requiredData).toContain('dartFin');
    expect(result.availableData.dartFin).toBe(false);
    expect(result.hadRequiredData).toBe(false);
  });

  it('순수 기술 evaluator (per — quote.per만 의존) → requiredData 빈 배열 + hadRequiredData=true', () => {
    const result = deriveEvaluatorContext(perEvaluator, ctxOf());
    expect(result.requiredData).toEqual([]);
    expect(result.hadRequiredData).toBe(true);
  });

  it('momentum (quote.changePercent + quote.rsi14 등 quote 만 의존) → requiredData 빈 배열', () => {
    const result = deriveEvaluatorContext(momentumEvaluator, ctxOf());
    expect(result.requiredData).toEqual([]);
    expect(result.hadRequiredData).toBe(true);
  });

  it('relative_strength + ctx.kospi20dReturn=undefined → hadRequiredData=false', () => {
    const ctx = ctxOf({ kospi20dReturn: undefined });
    const result = deriveEvaluatorContext(relativeStrengthEvaluator, ctx);
    expect(result.requiredData).toContain('kospi20dReturn');
    expect(result.availableData.kospi20dReturn).toBe(false);
    expect(result.hadRequiredData).toBe(false);
  });

  it('relative_strength + ctx.kospi20dReturn=5 → hadRequiredData=true', () => {
    const ctx = ctxOf({ kospi20dReturn: 5 });
    const result = deriveEvaluatorContext(relativeStrengthEvaluator, ctx);
    expect(result.availableData.kospi20dReturn).toBe(true);
    expect(result.hadRequiredData).toBe(true);
  });

  it('supply_confluence + 정상 kisFlow → hadRequiredData=true', () => {
    const ctx = ctxOf({
      kisFlow: { institutionalNetBuy: 100, foreignNetBuy: 50 } as ConditionEvalContext['kisFlow'],
    });
    const result = deriveEvaluatorContext(supplyConfluenceEvaluator, ctx);
    expect(result.availableData.kisFlow).toBe(true);
    expect(result.hadRequiredData).toBe(true);
  });
});

// ─── Test 4: registry.run 통합 — outputs 에 context 자동 첨부 ───────────────
describe('registry.run — context 자동 첨부 (ADR-0418)', () => {
  it('supply_confluence + kisFlow null → output.context.hadRequiredData=false', () => {
    const reg = new ConditionRegistry().register(supplyConfluenceEvaluator);
    const result = reg.run(ctxOf({ kisFlow: null }));

    expect(result.outputs).toHaveLength(1);
    const o = result.outputs[0];
    expect(o.key).toBe('supply_confluence');
    expect(o.context).toBeDefined();
    expect(o.context!.requiredData).toContain('kisFlow');
    expect(o.context!.availableData.kisFlow).toBe(false);
    expect(o.context!.hadRequiredData).toBe(false);
  });

  it('earnings_quality + dartFin null → output.context.hadRequiredData=false', () => {
    const reg = new ConditionRegistry().register(earningsQualityEvaluator);
    const result = reg.run(ctxOf({ dartFin: null }));

    const o = result.outputs[0];
    expect(o.context!.requiredData).toContain('dartFin');
    expect(o.context!.hadRequiredData).toBe(false);
  });

  it('순수 기술 evaluator (per) → context.hadRequiredData=true', () => {
    const reg = new ConditionRegistry().register(perEvaluator);
    const result = reg.run(ctxOf({ quote: makeQuote({ per: 12 }) }));

    const o = result.outputs[0];
    expect(o.context!.requiredData).toEqual([]);
    expect(o.context!.hadRequiredData).toBe(true);
  });

  it('다중 evaluator — 각 output 에 자체 context 첨부', () => {
    const reg = new ConditionRegistry()
      .register(supplyConfluenceEvaluator)
      .register(earningsQualityEvaluator)
      .register(perEvaluator);
    const result = reg.run(ctxOf({ kisFlow: null, dartFin: null }));

    expect(result.outputs).toHaveLength(3);
    const supplyOutput = result.outputs.find(o => o.key === 'supply_confluence');
    const earningsOutput = result.outputs.find(o => o.key === 'earnings_quality');
    const perOutput = result.outputs.find(o => o.key === 'per');

    expect(supplyOutput!.context!.hadRequiredData).toBe(false);
    expect(earningsOutput!.context!.hadRequiredData).toBe(false);
    expect(perOutput!.context!.hadRequiredData).toBe(true);
  });
});

// ─── Test 5: 호출자 단순화 — recordGateAuditByStatus(gate.outputs) ───────────
describe('audit 자동 분류 (ADR-0418 핵심 효과)', () => {
  it('🚨 핵심 — registry context 만으로 DATA_UNAVAILABLE 분류 (호출자 inclusion list 0)', async () => {
    const { recordGateAuditByStatus, loadGateAudit } = await import('../../persistence/gateAuditRepo.js');

    // legacy null 반환 evaluator 시뮬레이션 (status 미명시) — 호출자 측 inclusion list
    // 없이 registry context 의 hadRequiredData=false 만으로 audit 가 unavailable++ 분류.
    const supplyConfluenceLegacy: ConditionEvaluator = {
      key: 'supply_confluence',
      description: 'legacy stub',
      inputs: ['ctx.kisFlow.institutionalNetBuy'],
      evaluate({ kisFlow }) {
        if (!kisFlow) return null; // legacy null — status 미명시
        return null;
      },
    };

    const reg = new ConditionRegistry().register(supplyConfluenceLegacy);
    const result = reg.run(ctxOf({ kisFlow: null }));

    // 호출자는 단순히 context 를 그대로 전달.
    type AuditInputItem = Parameters<typeof recordGateAuditByStatus>[0][number];
    recordGateAuditByStatus(result.outputs.map(o => ({
      key: o.key,
      output: o.output as AuditInputItem['output'],
      context: o.context
        ? { evaluatorKey: o.key, hadRequiredData: o.context.hadRequiredData }
        : { evaluatorKey: o.key },
    })));

    const store = loadGateAudit();
    expect(store.supply_confluence.unavailable ?? 0).toBe(1);
    expect(store.supply_confluence.failed).toBe(0); // 핵심 — legacy null 도 unavailable 로 분류
  });

  it('순수 기술 evaluator + null result + context.hadRequiredData=true → THRESHOLD_NOT_MET 보존', async () => {
    const { recordGateAuditByStatus, loadGateAudit } = await import('../../persistence/gateAuditRepo.js');

    // momentum 같은 순수 기술 evaluator — 데이터 가용 + 임계 미달 → THRESHOLD_NOT_MET.
    const techLegacy: ConditionEvaluator = {
      key: 'momentum',
      description: 'pure technical stub',
      inputs: ['quote.changePercent'],
      evaluate() { return null; }, // null = 임계 미달
    };

    const reg = new ConditionRegistry().register(techLegacy);
    const result = reg.run(ctxOf());

    type AuditInputItem = Parameters<typeof recordGateAuditByStatus>[0][number];
    recordGateAuditByStatus(result.outputs.map(o => ({
      key: o.key,
      output: o.output as AuditInputItem['output'],
      context: o.context
        ? { evaluatorKey: o.key, hadRequiredData: o.context.hadRequiredData }
        : { evaluatorKey: o.key },
    })));

    const store = loadGateAudit();
    expect(store.momentum.failed).toBe(1); // 데이터 가용 + null → 진짜 임계 미달
    expect(store.momentum.unavailable ?? 0).toBe(0);
  });
});

// ─── Test 6: stockScreener inclusion list 영구 제거 정적 가드 ───────────────
describe('stockScreener inclusion list 영구 제거 (ADR-0418)', () => {
  it('DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL Set 부재 (정적 grep 가드)', () => {
    const screenerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../screener/stockScreener.ts'),
      'utf-8',
    );
    // ADR-0418 영구 제거 — 본 inclusion list 패턴은 재도입 금지.
    expect(screenerSrc).not.toMatch(/new Set<string>\(\[[\s\S]*'supply_confluence'/);
    expect(screenerSrc).not.toMatch(/!DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL\.has/);

    // 호출자가 o.context 를 그대로 전달하는 패턴 의무.
    expect(screenerSrc).toMatch(/o\.context/);
    expect(screenerSrc).toMatch(/hadRequiredData: o\.context\.hadRequiredData/);

    // ADR-0418 추적성 주석 의무.
    expect(screenerSrc).toMatch(/ADR-0418 Phase 3/);
  });
});
