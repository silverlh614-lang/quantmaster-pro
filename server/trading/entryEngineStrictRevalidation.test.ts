// @responsibility ADR-0117 evaluateEntryRevalidation extensionPct strict + DATA_HOLD 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateEntryRevalidation } from './entryEngine.js';
import { formatRequiredScore, resolveMacroRegime } from './entryPolicySemantics.js';
import { __resetSafePctChangeStrictWarnsForTests } from '../utils/safePctChange.js';

const ORIGINAL_ENV = process.env.DATA_QUALITY_STRICT_DISABLED;

beforeEach(() => {
  delete process.env.DATA_QUALITY_STRICT_DISABLED;
  __resetSafePctChangeStrictWarnsForTests();
});

describe('entry revalidation policy-blocked logging semantics', () => {
  it('R6_DEFENSE + KRX_NON_TRADING_DAY + POSITION_FULL skips policy-blocked revalidation without exposing /999', () => {
    const r = evaluateEntryRevalidation({
      symbol: '005930',
      currentPrice: 10100,
      entryPrice: 10000,
      quoteGateScore: 5.5,
      quoteSignalType: 'NORMAL',
      minGateScore: 999,
      macroRegimeCandidates: ['R3_CAUTION', 'R6_DEFENSE'],
      executionMode: 'SHADOW_ONLY',
      // 시나리오(NON_TRADING_DAY + POSITION_FULL + SHADOW_ONLY)는 현실적으로 live 진입 불가
      // 상태다. evaluateEntryRevalidation 의 SKIPPED_POLICY_BLOCK 분기는 liveEntryAllowed=false
      // 로 구동되며(entryEngine.ts), upstream(entryRevalidationStep)도 이 값을 명시 전달한다.
      liveEntryAllowed: false,
      marketSessionState: 'NON_TRADING_DAY',
      blockReasons: ['POSITION_FULL', 'KRX_NON_TRADING_DAY'],
    });

    expect(r.ok).toBe(false);
    expect(r.status).toBe('SKIPPED_POLICY_BLOCK');
    expect(r.requiredGateScore).toBeNull();
    expect(r.macroRegime).toBe('R6_DEFENSE');
    expect(r.shadowLearningAllowed).toBe(true);
    expect(r.executionImpact).toBe('NONE');
    expect(`${r.reasons.join(' ')} ${r.structuredLog}`).not.toContain('/999');
    expect(r.structuredLog).toContain('requiredGateScore=N/A');
    expect(r.structuredLog).toContain('macroRegime=R6_DEFENSE');
    expect(r.structuredLog).toContain('executionMode=SHADOW_ONLY');
    expect(r.structuredLog).toContain('marketSessionState=NON_TRADING_DAY');
  });

  it('resolves mixed R3/R6 macro candidates to a single R6_DEFENSE regime', () => {
    expect(resolveMacroRegime(['R3_CAUTION', 'R6_DEFENSE'])).toBe('R6_DEFENSE');
  });

  it('inherits NON_TRADING_DAY from KRX block reason when entry revalidation omits session state', () => {
    const r = evaluateEntryRevalidation({
      symbol: '005930',
      currentPrice: 10100,
      entryPrice: 10000,
      quoteGateScore: 5.5,
      quoteSignalType: 'NORMAL',
      minGateScore: 999,
      macroRegimeCandidates: ['R6_DEFENSE'],
      executionMode: 'SHADOW_ONLY',
      // R6_DEFENSE + KRX_NON_TRADING_DAY 정책차단 컨텍스트 → live 진입 불가(SKIPPED_POLICY_BLOCK).
      liveEntryAllowed: false,
      blockReasons: ['R6_DEFENSE', 'KRX_NON_TRADING_DAY'],
    });
    expect(r.status).toBe('SKIPPED_POLICY_BLOCK');
    expect(r.marketSessionState).toBe('NON_TRADING_DAY');
    expect(r.structuredLog).toContain('marketSessionState=NON_TRADING_DAY');
  });

  it('normal live-entry gate revalidation uses real threshold formatting instead of sentinel', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 10100,
      entryPrice: 10000,
      quoteGateScore: 6.4,
      quoteSignalType: 'NORMAL',
      minGateScore: 7,
      liveEntryAllowed: true,
      marketSessionState: 'OPEN',
    });

    expect(r.status).toBe('FAIL');
    expect(r.requiredGateScore).toBe(7);
    expect(formatRequiredScore(r.requiredGateScore, false)).toBe('7');
    expect(r.reasons.join(' ')).toContain('/7');
    expect(r.reasons.join(' ')).not.toContain('/999');
  });
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DATA_QUALITY_STRICT_DISABLED;
  else process.env.DATA_QUALITY_STRICT_DISABLED = ORIGINAL_ENV;
});

describe('evaluateEntryRevalidation — ADR-0117 DATA_HOLD 분기', () => {
  it('정상 currentPrice/entryPrice — 기존 동작 (ok=true 또는 reasons 만)', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 10500,
      entryPrice: 10000,
      quoteGateScore: 8,
      quoteSignalType: 'NORMAL',
    });
    // ok=true 또는 reasons 만 있고 dataQuality 부재
    expect(r.dataQuality).toBeUndefined();
    expect(r.waitReason).toBeUndefined();
  });

  it('1차 로그 098460 시뮬 (currentPrice=40500, entryPrice=12610) → DATA_HOLD', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 40500,
      entryPrice: 12610,
      quoteGateScore: 8,
      quoteSignalType: 'NORMAL',
    });
    expect(r.ok).toBe(false);
    expect(r.waitReason).toBe('DATA_HOLD');
    expect(r.dataQuality).toBeDefined();
    expect(r.dataQuality?.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(r.reasons[0]).toMatch(/DATA_HOLD_STALE_BASE_OR_SPLIT_ADJUSTMENT/);
  });

  it('current=0 → ZERO_OR_INVALID_PRICE DATA_HOLD', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 0,
      entryPrice: 10000,
      quoteGateScore: 8,
      quoteSignalType: 'NORMAL',
    });
    expect(r.ok).toBe(false);
    expect(r.waitReason).toBe('DATA_HOLD');
    expect(r.dataQuality?.status).toBe('ZERO_OR_INVALID_PRICE');
  });

  it('entryPrice=0 → ZERO_OR_INVALID_PRICE DATA_HOLD', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 10500,
      entryPrice: 0,
      quoteGateScore: 8,
      quoteSignalType: 'NORMAL',
    });
    expect(r.ok).toBe(false);
    expect(r.waitReason).toBe('DATA_HOLD');
    expect(r.dataQuality?.status).toBe('ZERO_OR_INVALID_PRICE');
  });

  it('dataQuality 메타 — context=entryEngine.extensionPct + updatedAt ISO', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 30000,
      entryPrice: 10000,
      quoteGateScore: 8,
      quoteSignalType: 'NORMAL',
    });
    expect(r.dataQuality?.context).toBe('entryEngine.extensionPct');
    expect(r.dataQuality?.current).toBe(30000);
    expect(r.dataQuality?.base).toBe(10000);
    expect(r.dataQuality?.source).toBe('KIS_REALTIME');
    expect(r.dataQuality?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ENV DATA_QUALITY_STRICT_DISABLED=true → 기존 동작 복원 (DATA_HOLD 분기 우회)', () => {
    process.env.DATA_QUALITY_STRICT_DISABLED = 'true';
    const r = evaluateEntryRevalidation({
      currentPrice: 40500,
      entryPrice: 12610,
      quoteGateScore: 8,
      quoteSignalType: 'NORMAL',
    });
    // ENV 우회 — extensionPct strict 가 ok=true 반환 → 정상 흐름 진행 → 다른 reasons 가능
    expect(r.dataQuality).toBeUndefined();
    expect(r.waitReason).toBeUndefined();
  });

  it('Gate 미달 + 정상 가격 → 기존 동작 (DATA_HOLD 아님)', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 10100,
      entryPrice: 10000,
      quoteGateScore: 4,
      quoteSignalType: 'NORMAL',
      minGateScore: 7,
    });
    expect(r.ok).toBe(false);
    expect(r.dataQuality).toBeUndefined();
    expect(r.waitReason).toBeUndefined();
    expect(r.reasons[0]).toMatch(/Gate 재검증 미달/);
  });

  it('정상 +5% — Gate 통과 → DATA_HOLD 미진입 (dataQuality 부재)', () => {
    const r = evaluateEntryRevalidation({
      currentPrice: 10500,
      entryPrice: 10000,
      quoteGateScore: 9,
      quoteSignalType: 'NORMAL',
      minGateScore: 7,
    });
    // ADR-0117 핵심 가드: dataQuality / waitReason 미부여 (정상 진행).
    // ok=true 보장은 다른 reasons (volume 등) 영향 가능 — DATA_HOLD 미진입 만 검증.
    expect(r.dataQuality).toBeUndefined();
    expect(r.waitReason).toBeUndefined();
  });
});
