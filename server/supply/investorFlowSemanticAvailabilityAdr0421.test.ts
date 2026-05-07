/**
 * @responsibility ADR-0421 회귀 — Investor-Flow Semantic Availability Check SSOT
 *
 * 사용자 §I 명시 7 케이스 + 우선순위 결정 트리 + supplyConfluenceEvaluator wiring +
 * registry.isExternalDataAvailable kisFlow override + supply_health marker 분류.
 *
 * 핵심 불변식 (사용자 명시 — 본 테스트가 영구 보호):
 *   1. 객체 존재만으로 available 판정 절대 금지 (semantic field 검증 의무).
 *   2. success=0 + missing>0 은 NEUTRAL 이 아님 — DATA_UNAVAILABLE.
 *   3. PROVIDER_MISMATCH / NOT_WIRED / CACHE_EMPTY / KRX_ERROR 명시 노출.
 *   4. DATA_UNAVAILABLE 은 failed 가 아님 (ADR-0416 정합).
 *   5. 매매 정책 변경 0 — 진단 only.
 */

import { describe, it, expect } from 'vitest';
import {
  type InvestorFlowSemanticAvailability,
  type InvestorFlowMarker,
  classifyInvestorFlowMarker,
  describeInvestorFlowMarker,
  evaluateInvestorFlowSemanticAvailability,
  hasNumberLikeField,
  INVESTOR_FLOW_REQUIRED_FIELDS,
  INVESTOR_FLOW_FIELD_ALIASES,
} from './investorFlowSemanticAvailability.js';
import { supplyConfluenceEvaluator } from '../quant/conditions/evaluators.js';
import { isExternalDataAvailable } from '../quant/conditions/registry.js';
import type { ConditionEvalContext } from '../quant/conditions/types.js';
import type { KisInvestorFlow } from '../clients/kisClient/types.js';

// ── §I 사용자 명시 7 케이스 ──────────────────────────────────────────────

describe('ADR-0421 §I 사용자 명시 7 케이스', () => {
  it('1. kisFlow null 이면 unavailable + DATA_UNAVAILABLE', () => {
    const result = evaluateInvestorFlowSemanticAvailability(null);
    expect(result.available).toBe(false);
    expect(result.status).toBe('DATA_UNAVAILABLE');
    expect(result.missingFields).toEqual([...INVESTOR_FLOW_REQUIRED_FIELDS]);
  });

  it('2. kisFlow 객체는 있지만 semantic field 부재 → FIELD_MISSING (둘 다 부재)', () => {
    // 사용자 §I — { provider: "KIS_API" } 같은 빈 payload.
    const result = evaluateInvestorFlowSemanticAvailability({ source: 'KIS_API' });
    expect(result.available).toBe(false);
    expect(result.status).toBe('FIELD_MISSING');
    expect(result.missingFields).toContain('foreignNetBuy');
    expect(result.missingFields).toContain('institutionalNetBuy');
    expect(result.provider).toBe('KIS_API');
  });

  it('3. semantic field 모두 존재 → OK', () => {
    const flow: KisInvestorFlow = {
      foreignNetBuy: 1500,
      institutionalNetBuy: 800,
      individualNetBuy: -2000,
      source: 'KIS_API',
    };
    const result = evaluateInvestorFlowSemanticAvailability(flow);
    expect(result.available).toBe(true);
    expect(result.status).toBe('OK');
    expect(result.missingFields).toEqual([]);
    expect(result.provider).toBe('KIS_API');
  });

  it('4. supplyConfluenceEvaluator semantic unavailable → DATA_UNAVAILABLE 반환', () => {
    // 객체는 있지만 required semantic fields 부재 — ADR-0421 핵심 시나리오.
    const ctx = {
      quote: {} as any,
      kisFlow: { source: 'KIS_API' } as unknown as KisInvestorFlow,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;

    const result = supplyConfluenceEvaluator.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('DATA_UNAVAILABLE');
    expect(result!.conditionKey).toBe('supply_confluence');
    expect(result!.score).toBe(0);
    // 핵심 불변식 #4 — failed 분류로 합산되지 않음.
    expect(result!.status).not.toBe('THRESHOLD_NOT_MET');
  });

  it('5. registry.isExternalDataAvailable 가 kisFlow semantic 검증 위임', () => {
    // 객체는 있지만 semantic fields 부재 → false (ADR-0421 wiring 검증).
    const ctxFieldMissing = {
      quote: {} as any,
      kisFlow: { source: 'KIS_API' } as unknown as KisInvestorFlow,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    expect(isExternalDataAvailable(ctxFieldMissing, 'kisFlow')).toBe(false);

    // semantic fields 모두 가용 → true.
    const ctxOk = {
      quote: {} as any,
      kisFlow: {
        foreignNetBuy: 1000,
        institutionalNetBuy: 500,
        individualNetBuy: -1500,
        source: 'KIS_API',
      } as KisInvestorFlow,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    expect(isExternalDataAvailable(ctxOk, 'kisFlow')).toBe(true);

    // kisFlow null → false.
    const ctxNull = {
      quote: {} as any,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    expect(isExternalDataAvailable(ctxNull, 'kisFlow')).toBe(false);
  });

  it('6. supply_health success 0/10 은 NEUTRAL 이 아님 (DATA_UNAVAILABLE)', () => {
    // 사용자 §I 핵심 — KRX/NAVER/CACHE 모두 실패 시 NEUTRAL 절대 금지.
    const marker = classifyInvestorFlowMarker({
      total: 10,
      success: 0,
      missing: 10,
      zeroSuspicious: false,
      staleCacheCount: 0,
    });
    expect(marker).not.toBe('NEUTRAL' as InvestorFlowMarker);
    expect(marker).toBe('DATA_UNAVAILABLE');
  });

  it('7. NEUTRAL 은 본 SSOT 가 반환하지 않음 (사용자 §G 정합)', () => {
    // semantic data 가 있을 때 NEUTRAL 판단은 호출자 영역. 본 SSOT 의 모든 분기는
    // {OK, STALE, DEGRADED, MISSING, DATA_UNAVAILABLE} 만 반환.
    const inputs: Array<Parameters<typeof classifyInvestorFlowMarker>[0]> = [
      { total: 0, success: 0, missing: 0, zeroSuspicious: false, staleCacheCount: 0 },
      { total: 10, success: 10, missing: 0, zeroSuspicious: false, staleCacheCount: 0 },
      { total: 10, success: 5, missing: 5, zeroSuspicious: false, staleCacheCount: 0 },
      { total: 10, success: 10, missing: 0, zeroSuspicious: true, staleCacheCount: 0 },
      { total: 10, success: 10, missing: 0, zeroSuspicious: false, staleCacheCount: 3 },
    ];
    for (const input of inputs) {
      const marker = classifyInvestorFlowMarker(input);
      expect(marker).not.toBe('NEUTRAL' as InvestorFlowMarker);
    }
  });
});

// ── 우선순위 결정 트리 ──────────────────────────────────────────────────

describe('ADR-0421 evaluateInvestorFlowSemanticAvailability — 결정 트리', () => {
  it('null/undefined → DATA_UNAVAILABLE', () => {
    expect(evaluateInvestorFlowSemanticAvailability(null).status).toBe('DATA_UNAVAILABLE');
    expect(evaluateInvestorFlowSemanticAvailability(undefined).status).toBe('DATA_UNAVAILABLE');
  });

  it('non-object (string/number/boolean) → UNKNOWN', () => {
    expect(evaluateInvestorFlowSemanticAvailability('').status).toBe('UNKNOWN');
    expect(evaluateInvestorFlowSemanticAvailability('KIS_API').status).toBe('UNKNOWN');
    expect(evaluateInvestorFlowSemanticAvailability(42).status).toBe('UNKNOWN');
    expect(evaluateInvestorFlowSemanticAvailability(true).status).toBe('UNKNOWN');
  });

  it('빈 객체 → FIELD_MISSING (둘 다 부재)', () => {
    const result = evaluateInvestorFlowSemanticAvailability({});
    expect(result.status).toBe('FIELD_MISSING');
    expect(result.missingFields.length).toBe(INVESTOR_FLOW_REQUIRED_FIELDS.length);
  });

  it('foreignNetBuy 만 존재 → DEGRADED (일부만 부재)', () => {
    const result = evaluateInvestorFlowSemanticAvailability({
      foreignNetBuy: 1000,
    });
    expect(result.status).toBe('DEGRADED');
    expect(result.missingFields).toEqual(['institutionalNetBuy']);
    expect(result.available).toBe(false);
  });

  it('institutionalNetBuy 만 존재 → DEGRADED', () => {
    const result = evaluateInvestorFlowSemanticAvailability({
      institutionalNetBuy: 500,
    });
    expect(result.status).toBe('DEGRADED');
    expect(result.missingFields).toEqual(['foreignNetBuy']);
  });

  it('NaN / Infinity 값은 missing 으로 분류', () => {
    const result1 = evaluateInvestorFlowSemanticAvailability({
      foreignNetBuy: NaN,
      institutionalNetBuy: 500,
    });
    expect(result1.status).toBe('DEGRADED');
    expect(result1.missingFields).toContain('foreignNetBuy');

    const result2 = evaluateInvestorFlowSemanticAvailability({
      foreignNetBuy: Infinity,
      institutionalNetBuy: -Infinity,
    });
    expect(result2.status).toBe('FIELD_MISSING');
  });

  it('값 0 은 *유효* (운영자 "0주 순매수" 의미)', () => {
    const result = evaluateInvestorFlowSemanticAvailability({
      foreignNetBuy: 0,
      institutionalNetBuy: 0,
    });
    expect(result.available).toBe(true);
    expect(result.status).toBe('OK');
  });

  it('alias 필드 인식 — foreignerNetBuy / institutionNetBuy', () => {
    const result = evaluateInvestorFlowSemanticAvailability({
      foreignerNetBuy: 1000,
      institutionNetBuy: 500,
    });
    expect(result.available).toBe(true);
    expect(result.status).toBe('OK');
  });

  it('source 필드 → provider propagate', () => {
    const result = evaluateInvestorFlowSemanticAvailability({
      foreignNetBuy: 100,
      institutionalNetBuy: 50,
      source: 'KRX_INVESTOR_FLOW',
    });
    expect(result.provider).toBe('KRX_INVESTOR_FLOW');
  });
});

// ── hasNumberLikeField 헬퍼 ─────────────────────────────────────────────

describe('ADR-0421 hasNumberLikeField — 안전 가드', () => {
  it('null/undefined/non-object → false', () => {
    expect(hasNumberLikeField(null, ['foreignNetBuy'])).toBe(false);
    expect(hasNumberLikeField(undefined, ['foreignNetBuy'])).toBe(false);
    expect(hasNumberLikeField('string', ['foreignNetBuy'])).toBe(false);
    expect(hasNumberLikeField(42, ['foreignNetBuy'])).toBe(false);
  });

  it('NaN/Infinity 는 false', () => {
    expect(hasNumberLikeField({ foreignNetBuy: NaN }, ['foreignNetBuy'])).toBe(false);
    expect(hasNumberLikeField({ foreignNetBuy: Infinity }, ['foreignNetBuy'])).toBe(false);
    expect(hasNumberLikeField({ foreignNetBuy: -Infinity }, ['foreignNetBuy'])).toBe(false);
  });

  it('finite number (0 포함) → true', () => {
    expect(hasNumberLikeField({ foreignNetBuy: 0 }, ['foreignNetBuy'])).toBe(true);
    expect(hasNumberLikeField({ foreignNetBuy: 1500 }, ['foreignNetBuy'])).toBe(true);
    expect(hasNumberLikeField({ foreignNetBuy: -1500 }, ['foreignNetBuy'])).toBe(true);
  });

  it('candidates 중 하나라도 가용 → true', () => {
    expect(hasNumberLikeField({ foreignerNetBuy: 100 }, ['foreignNetBuy', 'foreignerNetBuy'])).toBe(true);
  });

  it('field 부재 → false', () => {
    expect(hasNumberLikeField({}, ['foreignNetBuy'])).toBe(false);
    expect(hasNumberLikeField({ source: 'KIS_API' }, ['foreignNetBuy'])).toBe(false);
  });
});

// ── classifyInvestorFlowMarker — supply_health marker SSOT ────────────────

describe('ADR-0421 classifyInvestorFlowMarker — supply_health marker SSOT', () => {
  it('total=0 → MISSING (검증 대상 부재)', () => {
    const m = classifyInvestorFlowMarker({
      total: 0,
      success: 0,
      missing: 0,
      zeroSuspicious: false,
      staleCacheCount: 0,
    });
    expect(m).toBe('MISSING');
  });

  it('success=0 + missing>0 → DATA_UNAVAILABLE (NEUTRAL 절대 금지, 핵심 불변식 #2)', () => {
    const m = classifyInvestorFlowMarker({
      total: 10,
      success: 0,
      missing: 10,
      zeroSuspicious: false,
      staleCacheCount: 0,
    });
    expect(m).toBe('DATA_UNAVAILABLE');
  });

  it('partial (success>0 && success<total) → DEGRADED', () => {
    const m = classifyInvestorFlowMarker({
      total: 10,
      success: 5,
      missing: 5,
      zeroSuspicious: false,
      staleCacheCount: 0,
    });
    expect(m).toBe('DEGRADED');
  });

  it('zeroSuspicious → DEGRADED (success>0 일 때)', () => {
    const m = classifyInvestorFlowMarker({
      total: 10,
      success: 10,
      missing: 0,
      zeroSuspicious: true,
      staleCacheCount: 0,
    });
    expect(m).toBe('DEGRADED');
  });

  it('staleCacheCount>0 + 정상 coverage → STALE', () => {
    const m = classifyInvestorFlowMarker({
      total: 10,
      success: 10,
      missing: 0,
      zeroSuspicious: false,
      staleCacheCount: 3,
    });
    expect(m).toBe('STALE');
  });

  it('전부 정상 → OK', () => {
    const m = classifyInvestorFlowMarker({
      total: 10,
      success: 10,
      missing: 0,
      zeroSuspicious: false,
      staleCacheCount: 0,
    });
    expect(m).toBe('OK');
  });

  it('우선순위 — DATA_UNAVAILABLE 이 zeroSuspicious / staleCache 보다 우선', () => {
    // success=0 + missing>0 + zeroSuspicious + staleCache 모두 활성.
    const m = classifyInvestorFlowMarker({
      total: 10,
      success: 0,
      missing: 10,
      zeroSuspicious: true,
      staleCacheCount: 5,
    });
    expect(m).toBe('DATA_UNAVAILABLE');
  });
});

// ── supplyConfluenceEvaluator wiring 정합 ───────────────────────────────

describe('ADR-0421 supplyConfluenceEvaluator — semantic availability wiring', () => {
  it('kisFlow 객체는 있지만 semantic field 부재 → DATA_UNAVAILABLE (failed 절대 금지)', () => {
    const ctx = {
      quote: {} as any,
      kisFlow: { source: 'KIS_API' } as unknown as KisInvestorFlow,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    const r = supplyConfluenceEvaluator.evaluate(ctx);
    expect(r?.status).toBe('DATA_UNAVAILABLE');
    expect(r?.score).toBe(0);
    expect(r?.detail).toMatch(/Investor flow unavailable: FIELD_MISSING/);
  });

  it('semantic fields 가용 + 양쪽 양수 → FIRED (동반 순매수)', () => {
    const ctx = {
      quote: {} as any,
      kisFlow: {
        foreignNetBuy: 1500,
        institutionalNetBuy: 800,
        individualNetBuy: -2000,
        source: 'KIS_API',
      } as KisInvestorFlow,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    const r = supplyConfluenceEvaluator.evaluate(ctx);
    expect(r?.status).toBe('FIRED');
    expect(r?.score).toBeGreaterThan(0);
  });

  it('semantic fields 가용 + 양쪽 0/음수 → THRESHOLD_NOT_MET (진짜 미달)', () => {
    const ctx = {
      quote: {} as any,
      kisFlow: {
        foreignNetBuy: -1000,
        institutionalNetBuy: 0,
        individualNetBuy: 1000,
        source: 'KIS_API',
      } as KisInvestorFlow,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    const r = supplyConfluenceEvaluator.evaluate(ctx);
    expect(r?.status).toBe('THRESHOLD_NOT_MET');
    expect(r?.score).toBe(0);
    expect(r?.detail).toContain('no positive confluence');
  });

  it('kisFlow null → DATA_UNAVAILABLE (ADR-0416 호환 보존)', () => {
    const ctx = {
      quote: {} as any,
      kisFlow: null,
      weights: {} as any,
    } satisfies Partial<ConditionEvalContext> as unknown as ConditionEvalContext;
    const r = supplyConfluenceEvaluator.evaluate(ctx);
    expect(r?.status).toBe('DATA_UNAVAILABLE');
  });
});

// ── 안전 invariant 정적 가드 ─────────────────────────────────────────────

describe('ADR-0421 안전 invariant — 핵심 불변식 정적 가드', () => {
  it('describeInvestorFlowMarker 5 분기 모두 non-empty', () => {
    const markers: InvestorFlowMarker[] = ['OK', 'STALE', 'DEGRADED', 'MISSING', 'DATA_UNAVAILABLE'];
    for (const m of markers) {
      expect(describeInvestorFlowMarker(m).length).toBeGreaterThan(0);
    }
  });

  it('describeInvestorFlowMarker DATA_UNAVAILABLE 메시지에 "scoring-eligible" / "KRX/NAVER/CACHE" 포함', () => {
    const msg = describeInvestorFlowMarker('DATA_UNAVAILABLE');
    expect(msg).toMatch(/DATA_UNAVAILABLE/);
    expect(msg).toMatch(/KRX|NAVER|CACHE|scoring/);
  });

  it('INVESTOR_FLOW_REQUIRED_FIELDS 정합 — KisInvestorFlow 핵심 필드', () => {
    // 향후 KisInvestorFlow type 변경 시 본 테스트가 fail → SSOT 동기화 강제.
    expect(INVESTOR_FLOW_REQUIRED_FIELDS).toContain('foreignNetBuy');
    expect(INVESTOR_FLOW_REQUIRED_FIELDS).toContain('institutionalNetBuy');
  });

  it('INVESTOR_FLOW_FIELD_ALIASES 매핑 — foreignNetBuy 와 institutionalNetBuy 모두 alias', () => {
    expect(INVESTOR_FLOW_FIELD_ALIASES.foreignNetBuy.length).toBeGreaterThanOrEqual(1);
    expect(INVESTOR_FLOW_FIELD_ALIASES.institutionalNetBuy.length).toBeGreaterThanOrEqual(1);
    expect(INVESTOR_FLOW_FIELD_ALIASES.foreignNetBuy[0]).toBe('foreignNetBuy');
    expect(INVESTOR_FLOW_FIELD_ALIASES.institutionalNetBuy[0]).toBe('institutionalNetBuy');
  });

  it('isExternalDataAvailable kisFlow override 가 semantic 검사 위임 (정적 grep)', async () => {
    // ADR-0421 wiring 회귀 가드 — 코드베이스에서 직접 grep.
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const registrySrc = readFileSync(
      resolve(process.cwd(), 'server/quant/conditions/registry.ts'),
      'utf-8',
    );
    expect(registrySrc).toMatch(/import\s+\{[^}]*evaluateInvestorFlowSemanticAvailability/);
    expect(registrySrc).toMatch(/key === 'kisFlow'/);
    expect(registrySrc).toMatch(/evaluateInvestorFlowSemanticAvailability\(value\)/);
    // ADR-0421 추적 주석.
    expect(registrySrc).toMatch(/ADR-0421/);
  });

  it('supplyConfluenceEvaluator 가 semantic checker 사용 (정적 grep)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const evalSrc = readFileSync(
      resolve(process.cwd(), 'server/quant/conditions/evaluators.ts'),
      'utf-8',
    );
    expect(evalSrc).toMatch(/import\s+\{[^}]*evaluateInvestorFlowSemanticAvailability/);
    expect(evalSrc).toMatch(/evaluateInvestorFlowSemanticAvailability\(kisFlow\)/);
    expect(evalSrc).toMatch(/ADR-0421/);
  });

  it('supply_health classifyInvestorFlowMarker 사용 (정적 grep)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const supplySrc = readFileSync(
      resolve(process.cwd(), 'server/telegram/commands/system/supplyHealth.cmd.ts'),
      'utf-8',
    );
    expect(supplySrc).toMatch(/classifyInvestorFlowMarker/);
    // 회귀 가드: 사용자 명시 NEUTRAL 폐기 패턴이 line 145 inline 산출 부재.
    expect(supplySrc).not.toMatch(/success === 0\s*\?\s*'NEUTRAL'/);
    expect(supplySrc).toMatch(/ADR-0421/);
  });
});
