// @responsibility ADR-0425 Gate Decision Router 회귀 테스트.
//
// 사용자 명시 §H 11 케이스 + 정적 grep 가드 (Router 가 매수 정책/threshold/weight/order 변경 0건).

import { describe, expect, it } from 'vitest';
import {
  deriveGateDecisionRouterResult,
  formatGateDecisionRouterSection,
  GATE_DECISION_ROUTER_THRESHOLDS,
  type GateDecisionRouterInput,
} from './gateDecisionRouter.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROUTER_PATH = join(__dirname, 'gateDecisionRouter.ts');
const ROUTER_SOURCE = readFileSync(ROUTER_PATH, 'utf-8');

describe('ADR-0425 Gate Decision Router', () => {
  // ADR drift (always-on rollback): gateDecisionRouter 가 legacy SELL_ONLY / R6_DEFENSE risk
  // flag 를 더 이상 live-block reason 으로 승격하지 않는다 (production L185 "Legacy SELL_ONLY is
  // ignored by the rollback", L188 "Legacy R6 defense is forensic-only and must not become a live
  // gate block"). 동일 always-on 방향의 SSOT 가 emptyScanLivenessPolicy.ts("legacy SELL_ONLY
  // ignored by the rollback") 및 scheduler always-on cleanup(커밋 3e7ca19) 와 정합. 따라서 sellOnly/
  // r6Defense 만 set 된 입력은 reasons 에 매핑되지 않아 분류 데이터 부족 → WATCH_ONLY(UNKNOWN) 로
  // 떨어진다. live-safety 불변식은 보존됨: liveAllowed=false 유지 (live 는 여전히 열리지 않음).
  it('legacy SELL_ONLY + R6_DEFENSE 는 forensic-only — live block reason 미승격 (WATCH_ONLY/UNKNOWN, live 차단 유지)', () => {
    const result = deriveGateDecisionRouterResult({
      riskFlags: { sellOnly: true, r6Defense: true },
    });
    expect(result.severity).toBe('WATCH_ONLY');
    expect(result.label).toBe('UNKNOWN');
    expect(result.reasons).toEqual(['UNKNOWN']);
    // live-safety 보존 — live/paper 는 차단, shadow/watch 진단은 always-on.
    expect(result.liveAllowed).toBe(false);
    expect(result.paperAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    // legacy SELL_ONLY / R6 는 reason 으로도 더 이상 emit 되지 않음 (rollback).
    expect(result.reasons).not.toContain('SELL_ONLY');
    expect(result.reasons).not.toContain('R6_DEFENSE');
  });

  it('R4/R5 live-entry regime flags are macro live blocks with diagnostics still open', () => {
    const r4 = deriveGateDecisionRouterResult({
      riskFlags: { r4Neutral: true },
    });
    const r5 = deriveGateDecisionRouterResult({
      riskFlags: { r5Caution: true },
    });

    for (const result of [r4, r5]) {
      expect(result.severity).toBe('MACRO_LIVE_BLOCK');
      expect(result.liveAllowed).toBe(false);
      expect(result.paperAllowed).toBe(false);
      expect(result.shadowAllowed).toBe(true);
      expect(result.watchAllowed).toBe(true);
      expect(result.lanes).toEqual(expect.objectContaining({
        live: false,
        paper: false,
        shadow: true,
        watch: true,
        learning: true,
        counterfactual: true,
      }));
      expect(result.executionImpact).toBe('NONE');
    }
    expect(r4.reasons).toContain('R4_NEUTRAL');
    expect(r5.reasons).toContain('R5_CAUTION');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 1: emergencyStop → HARD_BLOCK
  // ────────────────────────────────────────────────────────
  it('§H#1: emergencyStop → HARD_BLOCK + Shadow 도 차단', () => {
    const result = deriveGateDecisionRouterResult({
      riskFlags: { emergencyStop: true },
    });
    expect(result.severity).toBe('HARD_BLOCK');
    expect(result.liveAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    expect(result.lanes).toEqual(expect.objectContaining({
      live: false,
      paper: false,
      shadow: true,
      watch: true,
      learning: true,
      counterfactual: true,
    }));
    expect(result.reasons).toContain('EMERGENCY_STOP');
    expect(result.label).toBe('BLOCK_RISK');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 2: legacy SELL_ONLY → forensic-only (always-on rollback, 위 §22 와 동일 근거)
  //   production L185 "Legacy SELL_ONLY is ignored by the rollback" — sellOnly 단독 입력은
  //   reason 미매핑 → WATCH_ONLY(UNKNOWN). shadow/watch 관측은 always-on, live 차단 유지.
  // ────────────────────────────────────────────────────────
  it('§H#2: legacy SELL_ONLY 단독 → forensic-only (WATCH_ONLY/UNKNOWN) + shadow/watch 관측 유지', () => {
    const result = deriveGateDecisionRouterResult({
      riskFlags: { sellOnly: true },
    });
    expect(result.severity).toBe('WATCH_ONLY');
    expect(result.label).toBe('UNKNOWN');
    expect(result.liveAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    expect(result.reasons).not.toContain('SELL_ONLY');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 3: SectorEnergy STALE → SOFT_DEGRADE
  // ────────────────────────────────────────────────────────
  it('§H#3: SectorEnergy STALE → SOFT_DEGRADE + shadowAllowed=true', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 10,
      gate2Pass: 0,
      sectorEnergyDiagnostic: {
        dataQuality: 'STALE',
        validSectorCount: 11,
        expectedSectorCount: 12,
        totalSectorRows: 12,
        rowsWithIndexCode: 0,
        indexCodeCoverage: 0,
        missingIndexCodeCount: 12,
        symmetryValidationPassed: false,
        fallbackUsed: 'STOCK_DAILY',
        reasons: ['INDEX_CODE_COVERAGE_ZERO'],
        shouldBlockLeadershipConfidence: true,
        operatorMessage: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(result.severity).toBe('SOFT_DEGRADE');
    expect(result.liveAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    expect(result.reasons).toContain('SECTOR_DATA_STALE');
    expect(result.label).toBe('SOFT_DEGRADE_DATA');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 4: DATA_UNAVAILABLE 우세 → SOFT_DEGRADE
  // ────────────────────────────────────────────────────────
  it('§H#4: DATA_UNAVAILABLE 우세 → SOFT_DEGRADE', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 10,
      gate2Pass: 0,
      gate2Attribution: {
        scanId: 'test',
        scannedAtKst: '2026-05-07',
        candidates: 50,
        gate1Pass: 10,
        gate2Pass: 0,
        gate3Pass: 0,
        entries: 0,
        lastTriggerPass: 0,
        buckets: [
          {
            conditionKey: 'supply_confluence',
            passed: 0,
            failed: 0,
            unavailable: 8,
            error: 0,
            skipped: 0,
            stale: 0,
            wait: 0,
            total: 8,
            failedRate: 0,
            unavailableRate: 1,
            errorRate: 0,
            staleRate: 0,
            waitRate: 0,
          },
          {
            conditionKey: 'earnings_quality',
            passed: 0,
            failed: 0,
            unavailable: 6,
            error: 0,
            skipped: 0,
            stale: 0,
            wait: 0,
            total: 6,
            failedRate: 0,
            unavailableRate: 1,
            errorRate: 0,
            staleRate: 0,
            waitRate: 0,
          },
        ],
        recommendedDiagnosis: 'DATA_UNAVAILABLE_DOMINANT',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(result.severity).toBe('SOFT_DEGRADE');
    expect(result.shadowAllowed).toBe(true);
    expect(result.reasons).toContain('DATA_UNAVAILABLE');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 5: Pre-breakout WAIT 우세 → WATCH_ONLY
  // ────────────────────────────────────────────────────────
  it('§H#5: Pre-breakout WAIT 우세 → WATCH_ONLY', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 10,
      gate2Pass: 0,
      blockReasons: { preBreakoutWait: 8 }, // 8/10 = 80% > 50%
    });
    expect(result.severity).toBe('WATCH_ONLY');
    expect(result.watchAllowed).toBe(true);
    expect(result.shadowAllowed).toBe(true);
    expect(result.reasons).toContain('PRE_BREAKOUT_WAIT');
    expect(result.label).toBe('WATCH_PRE_BREAKOUT');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 6: 진짜 기술 미달 우세 → TRUE_WEAKNESS
  // ────────────────────────────────────────────────────────
  it('§H#6: 진짜 기술 미달 우세 → TRUE_WEAKNESS + Shadow/Counterfactual 차단 (학습 오염 방지)', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 10,
      gate2Pass: 0,
      gate2Attribution: {
        scanId: 'test',
        scannedAtKst: '2026-05-07',
        candidates: 50,
        gate1Pass: 10,
        gate2Pass: 0,
        gate3Pass: 0,
        entries: 0,
        lastTriggerPass: 0,
        buckets: [
          {
            conditionKey: 'trend_acceleration',
            passed: 0,
            failed: 9,
            unavailable: 0,
            error: 0,
            skipped: 0,
            stale: 0,
            wait: 0,
            total: 9,
            failedRate: 1,
            unavailableRate: 0,
            errorRate: 0,
            staleRate: 0,
            waitRate: 0,
          },
        ],
        recommendedDiagnosis: 'TRUE_NO_LEADERSHIP',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(result.severity).toBe('TRUE_WEAKNESS');
    expect(result.liveAllowed).toBe(false);
    // 진짜 기술 미달은 실거래·shadow 공통 게이트 미달 — Watch 만 보존, shadow/counterfactual 차단.
    // provisionalShadowLane / counterfactualShadowLearningLane 이 severity 로 차단하는 실동작과 정합.
    expect(result.shadowAllowed).toBe(false);
    expect(result.watchAllowed).toBe(true);
    expect(result.counterfactualLearningAllowed).toBe(false);
    expect(result.learningShadowAllowed).toBe(false);
    expect(result.reasons).toContain('TRUE_NO_LEADERSHIP');
    expect(result.label).toBe('BLOCK_TRUE_WEAKNESS');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 7: 기존 full pass → FULL_ENTRY_CANDIDATE
  // ────────────────────────────────────────────────────────
  it('§H#7: 기존 full pass → FULL_ENTRY_CANDIDATE', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 5,
      gate2Pass: 5,
      gate3Pass: 3,
      lastTriggerPass: 1,
      entries: 1,
    });
    expect(result.severity).toBe('FULL_ENTRY_CANDIDATE');
    expect(result.liveAllowed).toBe(true);
    expect(result.label).toBe('FULL_CANDIDATE');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 8: legacy SELL_ONLY 가 forensic-only 로 무시되므로 (always-on rollback) sellOnly +
  //   sectorEnergy STALE 동시 입력은 SELL_ONLY 가 아니라 sectorStale 우세 → SOFT_DEGRADE 로 분류.
  //   (과거 "SELL_ONLY > SOFT_DEGRADE 우선" 가정은 SELL_ONLY rollback 후 무의미.) live 차단 유지.
  // ────────────────────────────────────────────────────────
  it('§H#8: legacy SELL_ONLY forensic-only → sectorEnergy STALE 우세 (SOFT_DEGRADE, live 차단 유지)', () => {
    const result = deriveGateDecisionRouterResult({
      riskFlags: { sellOnly: true },
      sectorEnergyDiagnostic: {
        dataQuality: 'STALE',
        validSectorCount: 11,
        expectedSectorCount: 12,
        totalSectorRows: 12,
        rowsWithIndexCode: 0,
        indexCodeCoverage: 0,
        missingIndexCodeCount: 12,
        symmetryValidationPassed: false,
        fallbackUsed: 'STOCK_DAILY',
        reasons: [],
        shouldBlockLeadershipConfidence: true,
        operatorMessage: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(result.severity).toBe('SOFT_DEGRADE');
    expect(result.reasons).toContain('SECTOR_DATA_STALE');
    expect(result.liveAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
  });

  // ────────────────────────────────────────────────────────
  // §H Test 9: formatter 가 router section 표시
  // ────────────────────────────────────────────────────────
  it('§H#9: formatGateDecisionRouterSection 가 7 항목 모두 노출', () => {
    const result = deriveGateDecisionRouterResult({
      riskFlags: { emergencyStop: true },
    });
    const section = formatGateDecisionRouterSection(result);
    expect(section).toBeTruthy();
    expect(section).toContain('Gate Decision Router');
    expect(section).toContain('severity');
    expect(section).toContain('HARD_BLOCK');
    expect(section).toContain('live=');
    expect(section).toContain('shadow=');
    expect(section).toContain('reasons');
    expect(section).toContain('operatorMessage');
    expect(section).toContain('EMERGENCY_STOP');
  });

  // ────────────────────────────────────────────────────────
  // §H Test 10: Router 가 threshold/weights/order policy 변경 0
  // ────────────────────────────────────────────────────────
  describe('§H#10: 정적 grep 가드 — Router 매매 정책 변경 0', () => {
    it('KIS 주문 함수 5종 import 0건', () => {
      expect(ROUTER_SOURCE).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    });

    it('autoTradeEngine import 0건', () => {
      expect(ROUTER_SOURCE).not.toMatch(/autoTradeEngine/);
    });

    it('orderExecutor / trancheExecutor import 0건', () => {
      expect(ROUTER_SOURCE).not.toMatch(/orderExecutor|trancheExecutor/);
    });

    it('Gate threshold 변경 키워드 부재', () => {
      // "MIN_GATE" 같은 임계 SSOT 변경 패턴 차단 (절대 원칙 #1)
      expect(ROUTER_SOURCE).not.toMatch(/setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX/);
    });

    it('STRONG_BUY 조건 변경 키워드 부재', () => {
      expect(ROUTER_SOURCE).not.toMatch(/STRONG_BUY_OVERRIDE|setStrongBuyThreshold/);
    });

    it('Router 본체 fetch / axios / 외부 API 호출 0건', () => {
      expect(ROUTER_SOURCE).not.toMatch(/\bfetch\(|axios\.|node-fetch/);
    });

    it('GATE_DECISION_ROUTER_THRESHOLDS Object.freeze SSOT', () => {
      expect(ROUTER_SOURCE).toContain('Object.freeze');
      expect(GATE_DECISION_ROUTER_THRESHOLDS.WATCH_PRE_BREAKOUT_WAIT_RATIO).toBe(0.5);
      expect(GATE_DECISION_ROUTER_THRESHOLDS.TRUE_WEAKNESS_FAIL_RATIO).toBe(0.7);
      expect(GATE_DECISION_ROUTER_THRESHOLDS.SOFT_DEGRADE_DATA_RATIO).toBe(0.5);
    });
  });

  // ────────────────────────────────────────────────────────
  // §H Test 11: DATA_UNAVAILABLE 은 failed 가 아님 회귀
  // ────────────────────────────────────────────────────────
  it('§H#11: DATA_UNAVAILABLE 은 SOFT_DEGRADE 분기, TRUE_WEAKNESS 아님', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 10,
      gate2Pass: 0,
      gate2Attribution: {
        scanId: 'test',
        scannedAtKst: '2026-05-07',
        candidates: 50,
        gate1Pass: 10,
        gate2Pass: 0,
        gate3Pass: 0,
        entries: 0,
        lastTriggerPass: 0,
        buckets: [
          {
            conditionKey: 'supply_confluence',
            passed: 0,
            failed: 0,
            unavailable: 10,
            error: 0,
            skipped: 0,
            stale: 0,
            wait: 0,
            total: 10,
            failedRate: 0,
            unavailableRate: 1,
            errorRate: 0,
            staleRate: 0,
            waitRate: 0,
          },
        ],
        recommendedDiagnosis: 'DATA_UNAVAILABLE_DOMINANT',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(result.severity).toBe('SOFT_DEGRADE');
    expect(result.severity).not.toBe('TRUE_WEAKNESS');
    expect(result.shadowAllowed).toBe(true);
    expect(result.reasons).toContain('DATA_UNAVAILABLE');
    expect(result.reasons).not.toContain('TRUE_GATE_REJECTION');
    expect(result.reasons).not.toContain('TRUE_NO_LEADERSHIP');
  });

  // ────────────────────────────────────────────────────────
  // 추가: 정상 운영 (분류 데이터 부족) → UNKNOWN
  // ────────────────────────────────────────────────────────
  it('보너스: 분류 데이터 부족 → UNKNOWN + WATCH_ONLY', () => {
    const result = deriveGateDecisionRouterResult({});
    expect(result.severity).toBe('WATCH_ONLY');
    expect(result.label).toBe('UNKNOWN');
    expect(result.reasons).toContain('UNKNOWN');
  });

  // ────────────────────────────────────────────────────────
  // 보너스: 부분 pass → REDUCED_ENTRY_CANDIDATE
  // ────────────────────────────────────────────────────────
  it('보너스: gate1>0 + gate2/3/lastTrigger=0 → REDUCED_ENTRY_CANDIDATE', () => {
    const result: GateDecisionRouterInput = {
      gate1Pass: 5,
      gate2Pass: 0,
      gate3Pass: 0,
      lastTriggerPass: 0,
    };
    const out = deriveGateDecisionRouterResult(result);
    expect(out.severity).toBe('REDUCED_ENTRY_CANDIDATE');
    expect(out.shadowAllowed).toBe(true);
    expect(out.label).toBe('REDUCED_CANDIDATE');
  });

  // ────────────────────────────────────────────────────────
  // 보너스: SIZING_BLOCKED 우세 → WATCH_ONLY 보존
  // ────────────────────────────────────────────────────────
  it('보너스: SIZING_BLOCKED 우세 (블록 비율 ≥ 100%) → WATCH_ONLY shadow/watch 보존', () => {
    const result = deriveGateDecisionRouterResult({
      gate1Pass: 5,
      blockReasons: { sizingBlocked: 5 },
    });
    expect(result.severity).toBe('WATCH_ONLY');
    expect(result.reasons).toContain('SIZING_BLOCKED');
    expect(result.liveAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    expect(result.executionImpact).toBe('NONE');
  });

  // ────────────────────────────────────────────────────────
  // formatter — null 입력 처리
  // ────────────────────────────────────────────────────────
  it('formatGateDecisionRouterSection — null/undefined 입력 시 null 반환', () => {
    expect(formatGateDecisionRouterSection(null)).toBeNull();
    expect(formatGateDecisionRouterSection(undefined)).toBeNull();
  });
});
