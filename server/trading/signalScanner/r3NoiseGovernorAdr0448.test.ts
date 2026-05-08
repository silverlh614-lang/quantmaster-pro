/**
 * @responsibility ADR-0448 Phase 0 — R3 Noise Governor 회귀 테스트.
 *
 * 새 framing (사용자): *"Auxiliary Data Must Not Hard-Block Execution"* —
 * R3 streak 가 SELL_ONLY/LUNCH_BREAK/DATA_UNAVAILABLE/SectorEnergy diagnostic BLOCKED/
 * shadowObservable 존재 시 누적되어 SHADOW_ONLY pre-scan 발동 → 매매엔진 정지로
 * 이어지던 결함 차단.
 *
 * 핵심 불변식 (모든 분기에서 정적 검증):
 *   - `liveBlockPreserved: true` literal — streakImpact=0 이어도 Live 차단은 기존 규칙 그대로.
 *   - cause 분류 8-value union (TRUE_GATE1_ZERO/SELL_ONLY/LUNCH_BREAK/DATA_UNAVAILABLE/
 *     SECTOR_ENERGY_DIAGNOSTIC_BLOCKED/PROVIDER_DEGRADED/SHADOW_OBSERVABLE_EXISTS/UNKNOWN).
 *   - Provider healthy + gate1Pass=0 + no shadow observable → streakImpact=1 (정상 누적).
 */

import { describe, it, expect, afterEach } from 'vitest';

import {
  evaluateR3NoiseGovernor,
  formatR3NoiseGovernorCompactLine,
  isR3NoiseGovernorDisabled,
  type R3NoiseGovernorInput,
} from './r3NoiseGovernor.js';
import type { StreakSkipContext } from './r3StreakSkipPolicy.js';

const ENV_KEY = 'R3_NOISE_GOVERNOR_DISABLED';

function makeStreakCtx(overrides: Partial<StreakSkipContext> = {}): StreakSkipContext {
  return {
    todayKstDate: '2026-05-08',
    isKrxTradingDay: true,
    volumeClockAllowsEntry: true,
    emergencyStop: false,
    manualBlockNewBuy: false,
    manualManageOnly: false,
    sellOnlyMode: false,
    regime: 'R3_EXPANSION',
    bearDefenseMode: false,
    vixGatingActive: false,
    fomcBlockActive: false,
    dataStarvedScan: false,
    frozenQuoteDataQuality: 'OK',
    ...overrides,
  };
}

function makeInput(overrides: Partial<R3NoiseGovernorInput> = {}): R3NoiseGovernorInput {
  return {
    streakSkipContext: overrides.streakSkipContext ?? makeStreakCtx(),
    gate1Pass: 0,
    candidates: 50,
    ...overrides,
  };
}

describe('ADR-0448 Phase 0 — r3NoiseGovernor SSOT', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  describe('Group A — ENV gate (ADR-0157 정확 비교)', () => {
    it('default OFF → false', () => {
      delete process.env[ENV_KEY];
      expect(isR3NoiseGovernorDisabled()).toBe(false);
    });

    it('=== "true" → true', () => {
      process.env[ENV_KEY] = 'true';
      expect(isR3NoiseGovernorDisabled()).toBe(true);
    });

    it('"1" 거부', () => {
      process.env[ENV_KEY] = '1';
      expect(isR3NoiseGovernorDisabled()).toBe(false);
    });

    it('"TRUE" 거부', () => {
      process.env[ENV_KEY] = 'TRUE';
      expect(isR3NoiseGovernorDisabled()).toBe(false);
    });

    it('"yes" 거부', () => {
      process.env[ENV_KEY] = 'yes';
      expect(isR3NoiseGovernorDisabled()).toBe(false);
    });

    it('ENV DISABLED → 기존 ADR-0419 동작 복원 (TRUE_GATE1_ZERO + streakImpact=1)', () => {
      process.env[ENV_KEY] = 'true';
      const decision = evaluateR3NoiseGovernor(makeInput({ shadowObservableExists: true }));
      expect(decision.cause).toBe('TRUE_GATE1_ZERO');
      expect(decision.streakImpact).toBe(1);
      expect(decision.liveBlockPreserved).toBe(true);
    });
  });

  describe('Group B — 결정 트리 cause 분류 (사용자 §"구현 C 결정")', () => {
    it('SELL_ONLY + gate1Pass=0 → SELL_ONLY_GATE1_ZERO + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ streakSkipContext: makeStreakCtx({ sellOnlyMode: true }) }),
      );
      expect(decision.cause).toBe('SELL_ONLY_GATE1_ZERO');
      expect(decision.streakImpact).toBe(0);
      expect(decision.liveBlockPreserved).toBe(true);
    });

    it('LUNCH_BREAK (volumeClockAllowsEntry=false) → LUNCH_BREAK_GATE1_ZERO + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ streakSkipContext: makeStreakCtx({ volumeClockAllowsEntry: false }) }),
      );
      expect(decision.cause).toBe('LUNCH_BREAK_GATE1_ZERO');
      expect(decision.streakImpact).toBe(0);
      expect(decision.liveBlockPreserved).toBe(true);
    });

    it('DATA_STARVED_SCAN → DATA_UNAVAILABLE_GATE1_ZERO + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ streakSkipContext: makeStreakCtx({ dataStarvedScan: true }) }),
      );
      expect(decision.cause).toBe('DATA_UNAVAILABLE_GATE1_ZERO');
      expect(decision.streakImpact).toBe(0);
    });

    it('FrozenQuote STALE → DATA_UNAVAILABLE_GATE1_ZERO + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({
          streakSkipContext: makeStreakCtx({ frozenQuoteDataQuality: 'STALE' }),
        }),
      );
      expect(decision.cause).toBe('DATA_UNAVAILABLE_GATE1_ZERO');
      expect(decision.streakImpact).toBe(0);
    });

    it('SectorEnergy diagnostic BLOCKED → SECTOR_ENERGY_DIAGNOSTIC_BLOCKED + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ sectorEnergyDiagnosticBlocked: true }),
      );
      expect(decision.cause).toBe('SECTOR_ENERGY_DIAGNOSTIC_BLOCKED');
      expect(decision.streakImpact).toBe(0);
      expect(decision.action).toBe('KEEP_SHADOW_OBSERVATION');
    });

    it('shadowObservableExists=true → SHADOW_OBSERVABLE_EXISTS + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ shadowObservableExists: true }),
      );
      expect(decision.cause).toBe('SHADOW_OBSERVABLE_EXISTS');
      expect(decision.streakImpact).toBe(0);
      expect(decision.action).toBe('KEEP_COUNTERFACTUAL_LEARNING');
    });

    it('providerDegraded=true → PROVIDER_DEGRADED_GATE1_ZERO + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(makeInput({ providerDegraded: true }));
      expect(decision.cause).toBe('PROVIDER_DEGRADED_GATE1_ZERO');
      expect(decision.streakImpact).toBe(0);
      expect(decision.action).toBe('PATCH_PROVIDER');
    });

    it('Provider healthy + gate1Pass=0 + no shadow observable → TRUE_GATE1_ZERO + streakImpact=1', () => {
      const decision = evaluateR3NoiseGovernor(makeInput());
      expect(decision.cause).toBe('TRUE_GATE1_ZERO');
      expect(decision.streakImpact).toBe(1);
      expect(decision.action).toBe('R3_TRUE_EMPTY_SCAN');
      expect(decision.liveBlockPreserved).toBe(true);
    });

    it('R6_DEFENSE_REGIME → UNKNOWN cause + streakImpact=0 (호출자 별도 처리)', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ streakSkipContext: makeStreakCtx({ regime: 'R6_DEFENSE' }) }),
      );
      expect(decision.cause).toBe('UNKNOWN');
      expect(decision.streakImpact).toBe(0);
    });

    it('VIX_BLOCK → UNKNOWN cause + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ streakSkipContext: makeStreakCtx({ vixGatingActive: true }) }),
      );
      expect(decision.cause).toBe('UNKNOWN');
      expect(decision.streakImpact).toBe(0);
    });

    it('FOMC_BLOCK → UNKNOWN cause + streakImpact=0', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({ streakSkipContext: makeStreakCtx({ fomcBlockActive: true }) }),
      );
      expect(decision.cause).toBe('UNKNOWN');
      expect(decision.streakImpact).toBe(0);
    });
  });

  describe('Group C — 절대 불변식 (사용자 §"중요" / §"절대 불변식")', () => {
    it('모든 분기에서 liveBlockPreserved=true literal — streakImpact=0 이어도', () => {
      const cases: R3NoiseGovernorInput[] = [
        makeInput({ streakSkipContext: makeStreakCtx({ sellOnlyMode: true }) }),
        makeInput({ streakSkipContext: makeStreakCtx({ volumeClockAllowsEntry: false }) }),
        makeInput({ shadowObservableExists: true }),
        makeInput({ sectorEnergyDiagnosticBlocked: true }),
        makeInput({ providerDegraded: true }),
        makeInput(),
      ];
      for (const input of cases) {
        const decision = evaluateR3NoiseGovernor(input);
        expect(decision.liveBlockPreserved).toBe(true);
      }
    });

    it('streakImpact 은 항상 0 또는 1 (literal type)', () => {
      const decisions = [
        evaluateR3NoiseGovernor(
          makeInput({ streakSkipContext: makeStreakCtx({ sellOnlyMode: true }) }),
        ),
        evaluateR3NoiseGovernor(makeInput()),
      ];
      for (const d of decisions) {
        expect([0, 1]).toContain(d.streakImpact);
      }
    });

    it('우선순위 — ENV DISABLED 가 모든 분기보다 우선', () => {
      process.env[ENV_KEY] = 'true';
      const decision = evaluateR3NoiseGovernor(
        makeInput({
          streakSkipContext: makeStreakCtx({ sellOnlyMode: true }),
          shadowObservableExists: true,
          sectorEnergyDiagnosticBlocked: true,
          providerDegraded: true,
        }),
      );
      expect(decision.cause).toBe('TRUE_GATE1_ZERO');
      expect(decision.streakImpact).toBe(1);
    });

    it('우선순위 — ADR-0419 skip > shadowObservable > sectorEnergy > provider > true', () => {
      // shadowObservable + sectorEnergy + provider + sellOnly 동시 → SELL_ONLY 우선 (ADR-0419)
      const decision = evaluateR3NoiseGovernor(
        makeInput({
          streakSkipContext: makeStreakCtx({ sellOnlyMode: true }),
          shadowObservableExists: true,
          sectorEnergyDiagnosticBlocked: true,
          providerDegraded: true,
        }),
      );
      expect(decision.cause).toBe('SELL_ONLY_GATE1_ZERO');
    });

    it('우선순위 — shadowObservable > sectorEnergy (ADR-0419 skip 부재 시)', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({
          shadowObservableExists: true,
          sectorEnergyDiagnosticBlocked: true,
          providerDegraded: true,
        }),
      );
      expect(decision.cause).toBe('SHADOW_OBSERVABLE_EXISTS');
    });

    it('우선순위 — sectorEnergy > provider', () => {
      const decision = evaluateR3NoiseGovernor(
        makeInput({
          sectorEnergyDiagnosticBlocked: true,
          providerDegraded: true,
        }),
      );
      expect(decision.cause).toBe('SECTOR_ENERGY_DIAGNOSTIC_BLOCKED');
    });
  });

  describe('Group D — formatR3NoiseGovernorCompactLine', () => {
    it('TRUE_GATE1_ZERO → "scan empty" tail', () => {
      const decision = evaluateR3NoiseGovernor(makeInput());
      const line = formatR3NoiseGovernorCompactLine(decision);
      expect(line).toContain('🛡️ R3 Noise:');
      expect(line).toContain('cause TRUE_GATE1_ZERO');
      expect(line).toContain('streakImpact=1');
      expect(line).toContain('scan empty');
    });

    it('SHADOW_OBSERVABLE_EXISTS → "learning kept" tail', () => {
      const decision = evaluateR3NoiseGovernor(makeInput({ shadowObservableExists: true }));
      const line = formatR3NoiseGovernorCompactLine(decision);
      expect(line).toContain('cause SHADOW_OBSERVABLE_EXISTS');
      expect(line).toContain('streakImpact=0');
      expect(line).toContain('learning kept');
    });

    it('SECTOR_ENERGY_DIAGNOSTIC_BLOCKED → "shadow observed" tail', () => {
      const decision = evaluateR3NoiseGovernor(makeInput({ sectorEnergyDiagnosticBlocked: true }));
      const line = formatR3NoiseGovernorCompactLine(decision);
      expect(line).toContain('cause SECTOR_ENERGY_DIAGNOSTIC_BLOCKED');
      expect(line).toContain('streakImpact=0');
      expect(line).toContain('shadow observed');
    });

    it('PROVIDER_DEGRADED → "patch provider" tail', () => {
      const decision = evaluateR3NoiseGovernor(makeInput({ providerDegraded: true }));
      const line = formatR3NoiseGovernorCompactLine(decision);
      expect(line).toContain('cause PROVIDER_DEGRADED_GATE1_ZERO');
      expect(line).toContain('patch provider');
    });

    it('plain text — Telegram <b> raw tag 부재', () => {
      const decision = evaluateR3NoiseGovernor(makeInput({ shadowObservableExists: true }));
      const line = formatR3NoiseGovernorCompactLine(decision);
      expect(line).not.toContain('<b>');
      expect(line).not.toContain('</b>');
    });
  });
});
