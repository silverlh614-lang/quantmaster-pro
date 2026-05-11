/**
 * @responsibility ADR-0126 PR-2 Price Source Policy execution wiring 회귀 테스트
 *
 * 사용자 후속 PR-2: shouldAllowExecution 매수 직전 final 방어선 의무화.
 * - toDataQualityInfo 매핑 SSOT (DataQualityResult → DataQualityInfo)
 * - evaluateDataQualityFromStock 헬퍼 (stock + currentPrice → DataQualityInfo)
 * - ENV PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED=true 우회
 * - perSymbolEvaluation 의 sizingTierDecider wiring 정적 검증
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateDataQuality,
  evaluateDataQualityFromStock,
  isPriceSourceExecutionGateDisabled,
  toDataQualityInfo,
} from './priceSourcePolicy.js';
import { shouldBlockTradingByDataQuality } from '../types/dataQuality.js';

const ORIGINAL_YAHOO_PRICE_ROLE = process.env.YAHOO_PRICE_ROLE;

beforeEach(() => {
  delete process.env.YAHOO_PRICE_ROLE;
});

afterEach(() => {
  if (ORIGINAL_YAHOO_PRICE_ROLE === undefined) delete process.env.YAHOO_PRICE_ROLE;
  else process.env.YAHOO_PRICE_ROLE = ORIGINAL_YAHOO_PRICE_ROLE;
});

describe('toDataQualityInfo — DataQualityResult → DataQualityInfo 매핑 SSOT', () => {
  it('VALID → undefined (매수 허용)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 50500 });
    expect(toDataQualityInfo(result)).toBeUndefined();
  });

  it('WARN → undefined (매수 허용, KIS canonical)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 53000 });
    expect(toDataQualityInfo(result)).toBeUndefined();
  });

  it('KIS primary + Yahoo 20% divergence → VALID without data quarantine', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 60000 });
    const dq = toDataQualityInfo(result);
    expect(result.status).toBe('VALID');
    expect(result.canonicalSource).toBe('KIS');
    expect(result.allowExecution).toBe(true);
    expect(result.reasons.join(' ')).toContain('KIS_PRIMARY_YAHOO_DIAGNOSTIC_ONLY');
    expect(result.reasons.join(' ')).toContain('noProviderDegrade=true');
    expect(dq).toBeUndefined();
  });

  it('KIS primary + Yahoo 40% divergence → VALID without provider degrade', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 70000 });
    const dq = toDataQualityInfo(result);
    expect(result.status).toBe('VALID');
    expect(result.canonicalPrice).toBe(50000);
    expect(result.discrepancyPct).toBe(40);
    expect(dq).toBeUndefined();
  });

  it('YAHOO_PRICE_ROLE=ACTIVE restores legacy INVALID quarantine', () => {
    process.env.YAHOO_PRICE_ROLE = 'ACTIVE';
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 60000 });
    const dq = toDataQualityInfo(result);
    expect(result.status).toBe('INVALID');
    expect(dq).toBeDefined();
    expect(dq?.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });

  it('YAHOO_PRICE_ROLE=ACTIVE restores legacy corporate-action quarantine', () => {
    process.env.YAHOO_PRICE_ROLE = 'ACTIVE';
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 70000 });
    const dq = toDataQualityInfo(result);
    expect(result.status).toBe('CORPORATE_ACTION_SUSPECT');
    expect(dq).toBeDefined();
    expect(dq?.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });

  it('STALE → SOURCE_UNTRUSTED (KIS 부재)', () => {
    const result = evaluateDataQuality({ yahooPrice: 50000 });
    const dq = toDataQualityInfo(result);
    expect(dq).toBeDefined();
    expect(dq?.status).toBe('SOURCE_UNTRUSTED');
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });

  it('MISSING → ZERO_OR_INVALID_PRICE (둘 다 부재)', () => {
    const result = evaluateDataQuality({});
    const dq = toDataQualityInfo(result);
    expect(dq).toBeDefined();
    expect(dq?.status).toBe('ZERO_OR_INVALID_PRICE');
    expect(shouldBlockTradingByDataQuality(dq)).toBe(true);
  });

  it('reasons + context 영속 — 진단 메시지 sizingTier BLOCKED 라벨에 반영', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 80000 });
    const dq = toDataQualityInfo(result, 'final-candidate:000660');
    expect(result.status).toBe('VALID');
    expect(result.reasons.join(' ')).toContain('discrepancy=60.00%');
    expect(dq).toBeUndefined();
  });

  it('discrepancyPct context 자동 생성 (context 미전달 시)', () => {
    const result = evaluateDataQuality({ kisPrice: 50000, yahooPrice: 80000 });
    const dq = toDataQualityInfo(result);
    expect(result.discrepancyPct).toBe(60);
    expect(dq).toBeUndefined();
  });
});

describe('evaluateDataQualityFromStock — stock + currentPrice 합성 SSOT', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED;
    delete process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED;
    else process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED = original;
  });

  it('정상 매칭 (KIS=50000, Yahoo=50500) → undefined (매수 허용)', () => {
    expect(evaluateDataQualityFromStock({ priceKrw: 50500 }, 50000)).toBeUndefined();
  });

  it('KIS primary + Yahoo 30%+ divergence → no dataQuality block by default', () => {
    const dq = evaluateDataQualityFromStock({ priceKrw: 70000 }, 50000);
    expect(dq).toBeUndefined();
  });

  it('KIS primary + Yahoo 10~30% divergence → no dataQuality block by default', () => {
    const dq = evaluateDataQualityFromStock({ priceKrw: 60000 }, 50000);
    expect(dq).toBeUndefined();
  });

  it('KIS 부재 (현재가 null) + Yahoo 만 있음 → SOURCE_UNTRUSTED', () => {
    const dq = evaluateDataQualityFromStock({ priceKrw: 50000 }, null);
    expect(dq?.status).toBe('SOURCE_UNTRUSTED');
  });

  it('둘 다 부재 → ZERO_OR_INVALID_PRICE', () => {
    const dq = evaluateDataQualityFromStock({ priceKrw: null }, null);
    expect(dq?.status).toBe('ZERO_OR_INVALID_PRICE');
  });

  it('ENV PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED=true → 항상 undefined (우회)', () => {
    process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED = 'true';
    // 60% 괴리도 차단 안 함
    expect(evaluateDataQualityFromStock({ priceKrw: 80000 }, 50000)).toBeUndefined();
    expect(evaluateDataQualityFromStock({ priceKrw: null }, null)).toBeUndefined();
  });

  it('isPriceSourceExecutionGateDisabled — ENV 검사', () => {
    expect(isPriceSourceExecutionGateDisabled()).toBe(false);
    process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED = 'true';
    expect(isPriceSourceExecutionGateDisabled()).toBe(true);
    process.env.PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED = 'false';
    expect(isPriceSourceExecutionGateDisabled()).toBe(false);
  });

  it('1차 로그 098460 시나리오 — Yahoo +221% drift is ignored when KIS is primary', () => {
    // KIS=15000 (정상) + Yahoo=48150 (액면병합 전 가격)
    const dq = evaluateDataQualityFromStock({ priceKrw: 48150 }, 15000);
    expect(dq).toBeUndefined();
  });

  it('context propagate — 디버그 라벨', () => {
    const dq = evaluateDataQualityFromStock({ priceKrw: 80000 }, 50000, 'test-context');
    expect(dq).toBeUndefined();
  });
});

describe('PR-2 perSymbolEvaluation wiring 정적 검증', () => {
  // ADR-0134: perSymbolEvaluation.ts 분해 후 본체는 perSymbol/buyListLoop.ts + intradayLoop.ts.
  const buyListLoopPath = path.resolve(__dirname, 'signalScanner', 'perSymbol', 'buyListLoop.ts');
  const intradayLoopPath = path.resolve(__dirname, 'signalScanner', 'perSymbol', 'intradayLoop.ts');
  const source =
    fs.readFileSync(buyListLoopPath, 'utf-8') + '\n' +
    fs.readFileSync(intradayLoopPath, 'utf-8');

  it('evaluateDataQualityFromStock import 존재', () => {
    // ADR-0134: import path 깊이 무관 (분해 후 ../../ 가 됨)
    expect(source).toMatch(/import\s*{\s*evaluateDataQualityFromStock\s*}\s*from\s*'[^']*priceSourcePolicy\.js'/);
  });

  it('sizingTierDecider 호출에 dataQuality 인자 전달', () => {
    expect(source).toMatch(/sizingTierDecider\(\s*\{[\s\S]*?dataQuality:\s*mergedDataQuality/);
  });

  it('evaluateDataQualityFromStock 호출 + final-candidate context', () => {
    // 정규식 dot 가 줄바꿈 매칭 안 되므로 [\s\S] 사용
    expect(source).toMatch(/evaluateDataQualityFromStock\([\s\S]*?final-candidate/);
  });

  it('drift sanity (stock.dataQuality) + priceSource 결합 OR 우선순위', () => {
    expect(source).toMatch(/mergedDataQuality\s*=\s*stock\.dataQuality\s*\?\?\s*priceSourceDataQuality/);
  });

  it('ADR-0126 주석 명시 — 매수 직전 final 방어선', () => {
    expect(source).toMatch(/ADR-0126.*PR-2.*매수 직전 final 방어선/);
  });
});
