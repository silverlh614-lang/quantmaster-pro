/**
 * @responsibility ADR-0436 Gate Eligibility Split — EmptyScanPostmortem 신규 액션 회귀.
 *
 * 검증:
 *   - PostmortemAction union 에 KEEP_COUNTERFACTUAL_LEARNING / PATCH_PROVIDER 추가
 *   - deriveGateEligibilityActions 결정 트리 SSOT (사용자 §4 절대 변경 금지)
 *   - shadowObservable > 0 + dataUnavailable 우세 → KEEP_COUNTERFACTUAL_LEARNING
 *   - providerDegraded 우세 → PATCH_PROVIDER
 *   - LOOSEN_GATE / "Gate threshold 완화" 정적 grep 회귀 차단
 *   - ADR-0417 deriveActionsByRates 무영향 (책임 분리)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  deriveGateEligibilityActions,
  type PostmortemAction,
} from './emptyScanPostmortem.js';

const POSTMORTEM_PATH = 'server/orchestrator/emptyScanPostmortem.ts';

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('ADR-0436 — EmptyScanPostmortem 신규 액션', () => {
  describe('PostmortemAction union 확장', () => {
    it('KEEP_COUNTERFACTUAL_LEARNING / PATCH_PROVIDER 신규 액션 등재', () => {
      const sample: PostmortemAction[] = ['KEEP_COUNTERFACTUAL_LEARNING', 'PATCH_PROVIDER'];
      expect(sample).toHaveLength(2);
    });

    it('기존 7-value 액션 + legacy 2종 + 신규 2종 = 11 values', () => {
      const all: PostmortemAction[] = [
        'HOLD_AND_WAIT',
        'CHECK_DATA_SOURCE',
        'PATCH_EVALUATOR',
        'REVIEW_GATE_THRESHOLD',
        'INSPECT_MARKET_REGIME',
        'INSPECT_CANDIDATES',
        'NO_ACTION',
        'KEEP_COUNTERFACTUAL_LEARNING',
        'PATCH_PROVIDER',
        'LOOSEN_GATE',
        'NONE',
      ];
      expect(all).toHaveLength(11);
    });
  });

  describe('deriveGateEligibilityActions — 결정 트리 SSOT', () => {
    it('shadowObservable=0 + 모든 카운터 0 → 빈 배열', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 0,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 0,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      expect(actions).toEqual([]);
    });

    it('shadowObservable > 0 + dataUnavailable 우세 → KEEP_COUNTERFACTUAL_LEARNING + CHECK_DATA_SOURCE', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 5,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 5,
        providerDegradedObservableCount: 0,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      expect(actions).toContain('KEEP_COUNTERFACTUAL_LEARNING');
      expect(actions).toContain('CHECK_DATA_SOURCE');
      // 핵심 invariant — LOOSEN_GATE / REVIEW_GATE_THRESHOLD 절대 부재
      expect(actions).not.toContain('LOOSEN_GATE');
      expect(actions).not.toContain('REVIEW_GATE_THRESHOLD');
    });

    it('providerDegraded 우세 (>30%) → PATCH_PROVIDER', () => {
      // 5 live + 5 providerDegraded = 10 total → 50% > 30%
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 5,
        liveEligibleCount: 5,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 5,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      expect(actions).toContain('PATCH_PROVIDER');
      expect(actions).toContain('KEEP_COUNTERFACTUAL_LEARNING');
    });

    it('providerDegraded 30% 이하 → PATCH_PROVIDER 미발화', () => {
      // 9 live + 1 providerDegraded = 10 total → 10% < 30%
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 1,
        liveEligibleCount: 9,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 1,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      expect(actions).not.toContain('PATCH_PROVIDER');
    });

    it('dataUnavailable + providerDegraded 동시 우세 → 두 액션 모두 등장', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 5,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 3,
        providerDegradedObservableCount: 4,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 1,
      });
      expect(actions).toContain('KEEP_COUNTERFACTUAL_LEARNING');
      expect(actions).toContain('CHECK_DATA_SOURCE');
      expect(actions).toContain('PATCH_PROVIDER');
    });

    it('shadowObservable=0 + providerDegraded > 30% → PATCH_PROVIDER 만 (KEEP_COUNTERFACTUAL_LEARNING 미발화)', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 0,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 5,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      expect(actions).toContain('PATCH_PROVIDER');
      expect(actions).not.toContain('KEEP_COUNTERFACTUAL_LEARNING');
    });

    it('total=0 (모든 카운터 0) → division by zero 안전', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 0,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 0,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      expect(actions).toEqual([]);
    });

    it('hardRiskBlocked 단독 → 빈 배열 (학습 표본 오염 차단 정합)', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 0,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 0,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 5,
      });
      // hard risk 만 있을 때는 ADR-0436 액션 미발화 (ADR-0417 영역)
      expect(actions).toEqual([]);
    });

    it('trueGateFail 단독 → 빈 배열 (ADR-0417 REVIEW_GATE_THRESHOLD 영역)', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 0,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 0,
        providerDegradedObservableCount: 0,
        trueGateFailCount: 5,
        hardRiskBlockedCount: 0,
      });
      // 진짜 임계 미달은 ADR-0417 deriveActionsByRates 가 처리 — 본 SSOT 무영향
      expect(actions).toEqual([]);
    });

    it('우선순위 — KEEP_COUNTERFACTUAL_LEARNING + CHECK_DATA_SOURCE 순서', () => {
      const actions = deriveGateEligibilityActions({
        shadowObservableCount: 5,
        liveEligibleCount: 0,
        dataUnavailableBlockedCount: 5,
        providerDegradedObservableCount: 0,
        trueGateFailCount: 0,
        hardRiskBlockedCount: 0,
      });
      // KEEP_COUNTERFACTUAL_LEARNING 이 CHECK_DATA_SOURCE 보다 먼저 등장
      const keepIdx = actions.indexOf('KEEP_COUNTERFACTUAL_LEARNING');
      const checkIdx = actions.indexOf('CHECK_DATA_SOURCE');
      expect(keepIdx).toBeGreaterThanOrEqual(0);
      expect(checkIdx).toBeGreaterThanOrEqual(0);
      expect(keepIdx).toBeLessThan(checkIdx);
    });
  });

  describe('정적 grep 가드 — emptyScanPostmortem.ts ADR-0436 wiring', () => {
    let src = '';
    it('[setup]', () => {
      src = readFileSync(POSTMORTEM_PATH, 'utf-8');
      expect(src.length).toBeGreaterThan(0);
    });

    it('PostmortemAction union 에 신규 2종 등재', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/'KEEP_COUNTERFACTUAL_LEARNING'/);
      expect(stripped).toMatch(/'PATCH_PROVIDER'/);
    });

    it('deriveGateEligibilityActions SSOT export', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/export function deriveGateEligibilityActions/);
    });

    it('buildActionGuidance — 신규 2종 메시지 분기', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/KEEP_COUNTERFACTUAL_LEARNING/);
      expect(stripped).toMatch(/PATCH_PROVIDER/);
    });

    it('runPostmortem — gateEligibilityActions 통합 wiring', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/gateEligibilityActions/);
      expect(stripped).toMatch(/getLastScanSummary/);
    });



    it('fresh snapshot observation lanes prevent PATHOLOGICAL_BLOCK gate-tight shortcut', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/hasFreshObservationLane/);
      expect(stripped).toMatch(/gate2WatchPreservedCount/);
      expect(stripped).toMatch(/gate2ShadowPreservedCount/);
      expect(stripped).toMatch(/preBreakoutWaitPreserved/);
      expect(stripped).toMatch(/Gate1 survivor\/Shadow\/Watch 후보가 있어 PATHOLOGICAL_BLOCK 단정 대신 정상 대기\/관측/);
      expect(stripped).toMatch(/summary\.gateFailRatio > 0\.95 && !hasFreshObservationLane/);
    });

    it('LOOSEN_GATE 신규 출력 부재 (legacy alias 만 union 보존, 결정 트리 발화 0)', () => {
      const stripped = stripComments(src);
      // 결정 트리에서 'LOOSEN_GATE' 발화 부재 — primaryAction = 'LOOSEN_GATE' 같은 패턴
      expect(stripped).not.toMatch(/primaryAction\s*=\s*['"]LOOSEN_GATE['"]/);
      expect(stripped).not.toMatch(/actions\.push\(['"]LOOSEN_GATE['"]\)/);
    });

    it('"Gate threshold 완화" 위험 권고 메시지 부재', () => {
      const stripped = stripComments(src);
      expect(stripped).not.toMatch(/Gate threshold 완화/);
      expect(stripped).not.toMatch(/낮추기 권고/);
    });

    it('ADR-0436 추적 주석 본문 명시', () => {
      expect(src).toContain('ADR-0436');
    });

    it('ADR-0417 deriveActionsByRates SSOT 보존 (책임 분리)', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/export function deriveActionsByRates/);
    });

    it('KIS 주문 함수 5종 import 0건', () => {
      const stripped = stripComments(src);
      expect(stripped).not.toMatch(/placeKisMarketBuyOrder/);
      expect(stripped).not.toMatch(/placeKisSellOrder/);
      expect(stripped).not.toMatch(/cancelKisOrder/);
    });
  });
});
