/**
 * @responsibility ADR-0436 Gate Eligibility Split — classifyGateEligibility SSOT 회귀.
 *
 * 사용자 명시 13 invariants 정적 grep 가드 + 결정 트리 동작 매트릭스.
 *
 * 핵심 검증:
 *   - LIVE_ELIGIBLE vs SHADOW_OBSERVABLE 분리 (실매수 후보 0 ≠ 학습 후보 0)
 *   - DATA_UNAVAILABLE 은 failed 가 아니다 + DATA_UNAVAILABLE 은 PASS 도 아니다
 *   - SHADOW_OBSERVABLE_PASS 는 절대 실매수로 이어지면 안 된다 (Action union 부재)
 *   - 12-value GateEligibilityReason union 정확
 *   - ENV `GATE_ELIGIBILITY_SPLIT_DISABLED === 'true'` 정확 비교 (ADR-0157)
 *   - 호출자 측 inline ENV 검사 0건 (SSOT 위임)
 *   - KIS 주문 함수 import 0건 (정적 grep 가드)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyGateEligibility,
  isGateEligibilitySplitDisabled,
  ALL_GATE_ELIGIBILITY_REASONS,
  type GateEligibilityReason,
} from './gateEligibilityClassifier.js';

const CLASSIFIER_PATH = 'server/trading/signalScanner/gateEligibilityClassifier.ts';

describe('ADR-0436 — Gate Eligibility Split SSOT', () => {
  const ORIGINAL_ENV = process.env.GATE_ELIGIBILITY_SPLIT_DISABLED;

  beforeEach(() => {
    delete process.env.GATE_ELIGIBILITY_SPLIT_DISABLED;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.GATE_ELIGIBILITY_SPLIT_DISABLED;
    } else {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = ORIGINAL_ENV;
    }
  });

  // ── ENV gate (정확 비교 ADR-0157) ────────────────────────────────────────
  describe('ENV gate (ADR-0157 정확 비교)', () => {
    it('default OFF — 미설정 시 split 활성', () => {
      delete process.env.GATE_ELIGIBILITY_SPLIT_DISABLED;
      expect(isGateEligibilitySplitDisabled()).toBe(false);
    });
    it("'true' 정확 매칭 시 split 비활성 (legacy)", () => {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = 'true';
      expect(isGateEligibilitySplitDisabled()).toBe(true);
    });
    it("'1' 거부 (정확 비교 의무)", () => {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = '1';
      expect(isGateEligibilitySplitDisabled()).toBe(false);
    });
    it("'TRUE' 거부 (대소문자 정확)", () => {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = 'TRUE';
      expect(isGateEligibilitySplitDisabled()).toBe(false);
    });
    it("'yes' 거부", () => {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = 'yes';
      expect(isGateEligibilitySplitDisabled()).toBe(false);
    });
  });

  // ── 12-value union 정합 ──────────────────────────────────────────────────
  describe('12-value GateEligibilityReason union', () => {
    it('12 values exactly', () => {
      expect(ALL_GATE_ELIGIBILITY_REASONS).toHaveLength(12);
    });
    it('union 12 specific values', () => {
      const expected: GateEligibilityReason[] = [
        'SUPPLY_DATA_UNAVAILABLE',
        'INVESTOR_FLOW_PROVIDER_UNAVAILABLE',
        'EARNINGS_DATA_UNAVAILABLE',
        'SECTOR_DATA_STALE',
        'SECTOR_DATA_DEGRADED',
        'PRICE_DATA_DEGRADED',
        'MACRO_BLOCK',
        'RISK_BLOCK',
        'TRUE_GATE_FAIL',
        'INSUFFICIENT_SCORE',
        'DATA_STARVED',
        'UNKNOWN',
      ];
      for (const r of expected) {
        expect(ALL_GATE_ELIGIBILITY_REASONS).toContain(r);
      }
    });
  });

  // ── 결정 트리 매트릭스 시나리오 ────────────────────────────────────────────
  describe('결정 트리 — 정상 통과', () => {
    it('정상 통과 → live=true, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        signalGrade: 'BUY',
      });
      expect(r.liveEligible).toBe(true);
      expect(r.shadowObservable).toBe(false);
      expect(r.liveBlockReasons).toHaveLength(0);
      expect(r.hasFatalDefect).toBe(false);
    });
  });

  describe('결정 트리 — DATA_UNAVAILABLE 분기 (shadow=true 가능)', () => {
    it('SUPPLY DATA_UNAVAILABLE + technical setup → live=false, shadow=true', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.liveBlockReasons).toContain('SUPPLY_DATA_UNAVAILABLE');
      expect(r.dataUnavailableReasons).toContain('SUPPLY_DATA_UNAVAILABLE');
      expect(r.shadowObservationReasons).toContain('SUPPLY_DATA_UNAVAILABLE');
    });
    it('INVESTOR_FLOW_PROVIDER_UNAVAILABLE + STRONG_BUY → live=false, shadow=true', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        investorFlowProviderUnavailable: true,
        signalGrade: 'STRONG_BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.liveBlockReasons).toContain('INVESTOR_FLOW_PROVIDER_UNAVAILABLE');
      expect(r.dataUnavailableReasons).toContain('INVESTOR_FLOW_PROVIDER_UNAVAILABLE');
    });
    it('EARNINGS DATA_UNAVAILABLE 단독 + momentum → live=false, shadow=true', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        earningsDataUnavailable: true,
        hasMomentumSignal: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.dataUnavailableReasons).toContain('EARNINGS_DATA_UNAVAILABLE');
    });
  });

  describe('결정 트리 — PROVIDER_DEGRADED 분기 (shadow=true 가능)', () => {
    it('SECTOR_DATA_STALE + technical setup → live=false, shadow=true', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        sectorEnergyDataQuality: 'STALE',
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.degradedProviderReasons).toContain('SECTOR_DATA_STALE');
    });
    it('SECTOR_DATA_DEGRADED → live=false, shadow=true (STRONG_BUY 차단 정합)', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        sectorEnergyDataQuality: 'DEGRADED',
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.degradedProviderReasons).toContain('SECTOR_DATA_DEGRADED');
    });
    it('PARTIAL_VOLUME → SECTOR_DATA_STALE 분기로 매핑', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        sectorEnergyDataQuality: 'PARTIAL_VOLUME',
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.liveBlockReasons).toContain('SECTOR_DATA_STALE');
    });
    it('PRICE_DATA_DEGRADED + STRONG_BUY → live=false, shadow=true', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        priceDataDegraded: true,
        signalGrade: 'STRONG_BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.degradedProviderReasons).toContain('PRICE_DATA_DEGRADED');
    });
  });

  describe('결정 트리 — Hard block 분기 (shadow=false, 학습 표본 오염 차단)', () => {
    it('MACRO_BLOCK 단독 → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        macroBlocked: true,
        hasTechnicalSetup: true,
        signalGrade: 'STRONG_BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
      expect(r.liveBlockReasons).toContain('MACRO_BLOCK');
    });
    it('RISK_BLOCK 단독 → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        riskBlocked: true,
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
    it('TRUE_GATE_FAIL 단독 → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        trueGateFail: true,
        signalGrade: 'BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
    it('INSUFFICIENT_SCORE 단독 → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        insufficientScore: true,
        signalGrade: 'BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
    it('DATA_STARVED 단독 → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        dataStarved: true,
        signalGrade: 'STRONG_BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
  });

  describe('결정 트리 — 치명 결함 (fatal)', () => {
    it('가격 0 → fatal → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 0,
        stockCode: '005930',
        signalGrade: 'STRONG_BUY',
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
      expect(r.hasFatalDefect).toBe(true);
    });
    it('가격 NaN → fatal', () => {
      const r = classifyGateEligibility({
        currentPrice: NaN,
        stockCode: '005930',
        hasTechnicalSetup: true,
      });
      expect(r.hasFatalDefect).toBe(true);
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
    it('code invalid (5자리) → fatal', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '12345',
        hasTechnicalSetup: true,
      });
      expect(r.hasFatalDefect).toBe(true);
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
    it('code invalid (알파벳) → fatal', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: 'ABC123',
        hasTechnicalSetup: true,
      });
      expect(r.hasFatalDefect).toBe(true);
    });
    it('hasFatalDefect=true 명시 → live=false, shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        hasFatalDefect: true,
        hasTechnicalSetup: true,
      });
      expect(r.hasFatalDefect).toBe(true);
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
  });

  describe('결정 트리 — 후보성 부재 (shadow=false)', () => {
    it('DATA_UNAVAILABLE + technical/momentum/catalyst 모두 false + signalGrade undefined → shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        // hasTechnicalSetup, hasMomentumSignal, hasCatalystSignal, signalGrade 모두 부재
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
    it('signalGrade=HOLD + DATA_UNAVAILABLE → shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        signalGrade: 'HOLD',
      });
      expect(r.shadowObservable).toBe(false);
    });
    it('signalGrade=NEUTRAL + DATA_UNAVAILABLE → shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        signalGrade: 'NEUTRAL',
      });
      expect(r.shadowObservable).toBe(false);
    });
  });

  describe('결정 트리 — 다중 사유 동시 (reasons 배열 모두 포함)', () => {
    it('SUPPLY + EARNINGS + SECTOR_STALE 동시 → 3 사유 모두 누적, shadow=true', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        earningsDataUnavailable: true,
        sectorEnergyDataQuality: 'STALE',
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true);
      expect(r.dataUnavailableReasons).toContain('SUPPLY_DATA_UNAVAILABLE');
      expect(r.dataUnavailableReasons).toContain('EARNINGS_DATA_UNAVAILABLE');
      expect(r.degradedProviderReasons).toContain('SECTOR_DATA_STALE');
      expect(r.shadowObservationReasons).toHaveLength(3);
    });
    it('DATA_UNAVAILABLE + MACRO_BLOCK 동시 → hardBlockOnly=false → shadow=true (DATA_UNAVAILABLE 우선)', () => {
      // hardBlockOnly 가 *every* — 1건이라도 비-hard 가 있으면 false → shadow 가능.
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        macroBlocked: true,
        hasTechnicalSetup: true,
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(true); // DATA_UNAVAILABLE 이 함께 있으면 hardBlockOnly 아님
    });
    it('MACRO_BLOCK + RISK_BLOCK 동시 → hardBlockOnly=true → shadow=false', () => {
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        macroBlocked: true,
        riskBlocked: true,
        hasTechnicalSetup: true,
        signalGrade: 'STRONG_BUY',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.shadowObservable).toBe(false);
    });
  });

  describe('legacy 동작 (ENV `GATE_ELIGIBILITY_SPLIT_DISABLED=true`)', () => {
    it('legacy ENV 활성 시 shadowObservable 항상 false (ADR-0436 미작동)', () => {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = 'true';
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        hasTechnicalSetup: true,
      });
      expect(r.shadowObservable).toBe(false);
      expect(r.notes).toContain('legacy');
    });
    it('legacy 모드에서도 liveEligible 차단 사유 누적 정상', () => {
      process.env.GATE_ELIGIBILITY_SPLIT_DISABLED = 'true';
      const r = classifyGateEligibility({
        currentPrice: 50000,
        stockCode: '005930',
        supplyDataUnavailable: true,
        sectorEnergyDataQuality: 'DEGRADED',
      });
      expect(r.liveEligible).toBe(false);
      expect(r.liveBlockReasons.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ── 정적 grep 가드 (사용자 명시 13 invariants) ────────────────────────────────
describe('ADR-0436 — 정적 grep 가드 (회귀 차단)', () => {
  let src = '';
  beforeEach(() => {
    src = readFileSync(CLASSIFIER_PATH, 'utf-8');
  });

  // stripComments — false positive 차단 (ADR-0146 표준 패턴)
  function stripComments(s: string): string {
    return s
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/^\s*\/\/.*$/gm, '');      // line comments
  }

  it('invariant 1: KIS 주문 함수 5종 import 0건 (placeKisMarketBuyOrder/placeKisSellOrder/placeKisStopLossOrder/placeKisTakeProfitOrder/cancelKisOrder)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/placeKisMarketBuyOrder/);
    expect(stripped).not.toMatch(/placeKisSellOrder/);
    expect(stripped).not.toMatch(/placeKisStopLossOrder/);
    expect(stripped).not.toMatch(/placeKisTakeProfitOrder/);
    expect(stripped).not.toMatch(/cancelKisOrder/);
  });

  it('invariant 2: autoTradeEngine import 0건', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/autoTradeEngine/);
  });

  it('invariant 3: orderExecutor import 0건', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/orderExecutor/);
  });

  it('invariant 4: shadowTradeRepo import 0건 (분류 layer 만, 영속 wiring 후속 PR scope)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/shadowTradeRepo/);
    expect(stripped).not.toMatch(/from .*persistence\/shadowTradeRepo/);
  });

  it('invariant 5: 외부 API import 0건 (kisClient/Yahoo/Naver/KRX fetch)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/from ['"][^'"]*kisClient/);
    expect(stripped).not.toMatch(/from ['"][^'"]*yahooClient/);
    expect(stripped).not.toMatch(/import .* fetch ['"]node-fetch['"]/);
  });

  it('invariant 6: ENV 정확 비교 의무 (=== \'true\')', () => {
    expect(src).toContain("=== 'true'");
    // != 'true' 또는 != "true" 같은 부정확 비교 부재
    expect(src).not.toMatch(/!==?\s*['"]true['"]/);
    // toLowerCase / toUpperCase ENV 검사 부재
    expect(src).not.toMatch(/process\.env\.GATE_ELIGIBILITY[^=]+\.toLowerCase/);
  });

  it('invariant 7: classifyGateEligibility 시그니처 — shadowObservable 옵셔널 0 (필수)', () => {
    expect(src).toMatch(/shadowObservable:\s*boolean[;,\s)]/);
    // shadowObservable?: boolean 같은 옵셔널 패턴 부재 (필수 필드 보장)
    const result = src.match(/export interface GateEligibility[\s\S]*?\n\}/);
    expect(result).toBeTruthy();
    if (result) {
      expect(result[0]).toMatch(/shadowObservable:\s*boolean;/);
      expect(result[0]).not.toMatch(/shadowObservable\?:/);
    }
  });

  it('invariant 8: PROMOTE_TO_LIVE / PROMOTE_TO_PAPER / EXECUTE Action union 부재 (자동 매수 승격 차단)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/PROMOTE_TO_LIVE/);
    expect(stripped).not.toMatch(/PROMOTE_TO_PAPER/);
    expect(stripped).not.toMatch(/EXECUTE\b/);
    expect(stripped).not.toMatch(/promoteToLive/);
    expect(stripped).not.toMatch(/promoteToPaper/);
  });

  it('invariant 9: 호출자 측 inline ENV 검사 패턴 부재 — SSOT 헬퍼 위임 의무', () => {
    // isGateEligibilitySplitDisabled() SSOT export
    expect(src).toMatch(/export function isGateEligibilitySplitDisabled/);
    // 단일 process.env 직접 비교 — 헬퍼 안에서만
    const matches = src.match(/process\.env\.GATE_ELIGIBILITY_SPLIT_DISABLED/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it('invariant 10: ALL_GATE_ELIGIBILITY_REASONS 12-value union readonly export', () => {
    expect(src).toMatch(/ALL_GATE_ELIGIBILITY_REASONS/);
    expect(src).toMatch(/readonly GateEligibilityReason\[\]/);
  });

  it('invariant 11: LOOSEN_GATE / "Gate threshold 완화" 메시지 부재 (위험 권고 영구 차단)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/LOOSEN_GATE/);
    // 코드 안 위험 메시지 echo 없음
  });

  it('invariant 12: ADR-0436 추적 주석 본문 헤더 명시', () => {
    expect(src).toContain('ADR-0436');
  });

  it('invariant 13: 외부 의존성 0 (외부 fs/zustand/persistence import 부재 — 순수 함수)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/from ['"]fs['"]/);
    expect(stripped).not.toMatch(/from ['"]node:fs['"]/);
    expect(stripped).not.toMatch(/from ['"]zustand['"]/);
    expect(stripped).not.toMatch(/from ['"][^'"]*persistence\//);
  });
});
