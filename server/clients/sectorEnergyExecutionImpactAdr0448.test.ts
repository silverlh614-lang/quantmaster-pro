/**
 * @responsibility ADR-0448 Phase 0 — SectorEnergy Execution Decoupler 회귀 테스트.
 *
 * 새 framing (사용자 직접 명시): *"Auxiliary Data Must Not Hard-Block Execution"* —
 * SectorEnergy 는 보조 진단·점수축이지 매매엔진 전역 정지 버튼이 아니다.
 *
 * 본 테스트는 `deriveSectorEnergyExecutionImpact` SSOT 의 3층 분리
 * (diagnostic / scoring / execution) 결정 트리 + ENV 우회 + literal 불변식 검증.
 *
 * 핵심 불변식 (모든 분기에서 정적 검증):
 *   - `hardBlockAllowed: false` literal type — SectorEnergy 유래 HARD_BLOCK 절대 금지.
 *   - OK 외 모든 분기 → `strongBuyAllowed=false` + `sectorBoostAllowed=false`.
 *   - OK 분기만 → 둘 다 true.
 */

import { describe, it, expect, afterEach } from 'vitest';

import {
  deriveSectorEnergyExecutionImpact,
  formatSectorEnergyExecutionImpactCompactLine,
  isSectorEnergyExecutionDecouplingDisabled,
  type SectorEnergyExecutionImpactInput,
} from './sectorEnergyExecutionImpact.js';

const ENV_KEY = 'SECTOR_ENERGY_EXECUTION_DECOUPLING_DISABLED';

describe('ADR-0448 Phase 0 — sectorEnergyExecutionImpact SSOT', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  describe('Group A — ENV gate (ADR-0157 정확 비교)', () => {
    it('default OFF (env 미설정) → false', () => {
      delete process.env[ENV_KEY];
      expect(isSectorEnergyExecutionDecouplingDisabled()).toBe(false);
    });

    it('=== "true" → true', () => {
      process.env[ENV_KEY] = 'true';
      expect(isSectorEnergyExecutionDecouplingDisabled()).toBe(true);
    });

    it('"1" 거부 — ADR-0157 정확 비교 의무', () => {
      process.env[ENV_KEY] = '1';
      expect(isSectorEnergyExecutionDecouplingDisabled()).toBe(false);
    });

    it('"TRUE" 거부 — 대소문자 구분', () => {
      process.env[ENV_KEY] = 'TRUE';
      expect(isSectorEnergyExecutionDecouplingDisabled()).toBe(false);
    });

    it('"yes" 거부', () => {
      process.env[ENV_KEY] = 'yes';
      expect(isSectorEnergyExecutionDecouplingDisabled()).toBe(false);
    });

    it('"false" 명시 → false', () => {
      process.env[ENV_KEY] = 'false';
      expect(isSectorEnergyExecutionDecouplingDisabled()).toBe(false);
    });
  });

  describe('Group B — 결정 트리 (사용자 §"권장 결정" 정합)', () => {
    it('SectorEnergy OK → ALLOW_SECTOR_BOOST + NO_EXECUTION_BLOCK', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'OK',
        leadershipConfidence: 'OK',
        sourceTier: 'KRX_CODE',
        sanityConfidenceImpact: 'NONE',
        fallbackUsed: 'NONE',
      });
      expect(result.diagnosticStatus).toBe('OK');
      expect(result.scoringImpact).toBe('ALLOW_SECTOR_BOOST');
      expect(result.executionImpact).toBe('NO_EXECUTION_BLOCK');
      expect(result.sectorBoostAllowed).toBe(true);
      expect(result.strongBuyAllowed).toBe(true);
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('SectorEnergy DEGRADED → ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'DEGRADED',
        leadershipConfidence: 'DEGRADED',
      });
      expect(result.diagnosticStatus).toBe('DEGRADED');
      expect(result.scoringImpact).toBe('ZERO_SECTOR_BOOST');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
      expect(result.sectorBoostAllowed).toBe(false);
      expect(result.strongBuyAllowed).toBe(false);
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('SectorEnergy STALE → STALE + DISALLOW_STRONG_BUY_ONLY (HARD_BLOCK 아님)', () => {
      const result = deriveSectorEnergyExecutionImpact({ dataQuality: 'STALE' });
      expect(result.diagnosticStatus).toBe('STALE');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
      expect(result.sectorBoostAllowed).toBe(false);
      expect(result.strongBuyAllowed).toBe(false);
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('SectorEnergy FAILED → BLOCKED diagnosticStatus (HARD_BLOCK 아님)', () => {
      const result = deriveSectorEnergyExecutionImpact({ dataQuality: 'FAILED' });
      expect(result.diagnosticStatus).toBe('BLOCKED');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('leadershipConfidence BLOCKED + sanity BLOCKED → BLOCKED diagnosticStatus', () => {
      const result = deriveSectorEnergyExecutionImpact({
        leadershipConfidence: 'BLOCKED',
        sanityConfidenceImpact: 'BLOCKED',
      });
      expect(result.diagnosticStatus).toBe('BLOCKED');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('sanity confidenceImpact BLOCKED 단독 → BLOCKED + HARD_BLOCK 아님', () => {
      const result = deriveSectorEnergyExecutionImpact({
        sanityConfidenceImpact: 'BLOCKED',
      });
      expect(result.diagnosticStatus).toBe('BLOCKED');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('STOCK_DAILY fallback → DEGRADED + HARD_BLOCK 아님', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'OK',
        sourceTier: 'STOCK_DAILY',
      });
      expect(result.diagnosticStatus).toBe('DEGRADED');
      expect(result.scoringImpact).toBe('ZERO_SECTOR_BOOST');
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('UNKNOWN sourceTier → DEGRADED + HARD_BLOCK 아님', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'OK',
        sourceTier: 'UNKNOWN',
      });
      expect(result.diagnosticStatus).toBe('DEGRADED');
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('fallbackUsed != NONE → DEGRADED', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'OK',
        fallbackUsed: 'CACHE',
      });
      expect(result.diagnosticStatus).toBe('DEGRADED');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
    });

    it('PARTIAL_VOLUME → STALE 분기 + STRONG_BUY 차단 (ADR-0415 정합)', () => {
      const result = deriveSectorEnergyExecutionImpact({ dataQuality: 'PARTIAL_VOLUME' });
      expect(result.diagnosticStatus).toBe('STALE');
      expect(result.strongBuyAllowed).toBe(false);
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('PARTIAL → DEGRADED + STRONG_BUY 보수적 차단', () => {
      const result = deriveSectorEnergyExecutionImpact({ dataQuality: 'PARTIAL' });
      expect(result.diagnosticStatus).toBe('DEGRADED');
      expect(result.scoringImpact).toBe('ZERO_SECTOR_BOOST');
      expect(result.strongBuyAllowed).toBe(false);
    });

    it('null 입력 → DATA_UNAVAILABLE + STRONG_BUY 차단 + HARD_BLOCK 아님', () => {
      const result = deriveSectorEnergyExecutionImpact(null);
      expect(result.diagnosticStatus).toBe('DATA_UNAVAILABLE');
      expect(result.scoringImpact).toBe('SECTOR_SCORE_NEUTRAL');
      expect(result.executionImpact).toBe('DISALLOW_STRONG_BUY_ONLY');
      expect(result.strongBuyAllowed).toBe(false);
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('빈 입력 — 모든 필드 undefined → DATA_UNAVAILABLE', () => {
      const result = deriveSectorEnergyExecutionImpact({});
      expect(result.diagnosticStatus).toBe('DATA_UNAVAILABLE');
      expect(result.hardBlockAllowed).toBe(false);
    });

    it('알 수 없는 dataQuality + leadership OK → DATA_UNAVAILABLE 안전 fallback', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'WEIRD_VALUE',
        leadershipConfidence: 'OK',
      } as SectorEnergyExecutionImpactInput);
      // 결정 트리 (1)~(5) 미매칭 + (6) dq !== 'OK' → 안전 fallback
      expect(result.diagnosticStatus).toBe('DATA_UNAVAILABLE');
      expect(result.hardBlockAllowed).toBe(false);
    });
  });

  describe('Group C — 절대 불변식 (사용자 §"절대 불변식")', () => {
    const inputMatrix: SectorEnergyExecutionImpactInput[] = [
      { dataQuality: 'OK', leadershipConfidence: 'OK', sanityConfidenceImpact: 'NONE' },
      { dataQuality: 'PARTIAL' },
      { dataQuality: 'STALE' },
      { dataQuality: 'DEGRADED' },
      { dataQuality: 'FAILED' },
      { dataQuality: 'PARTIAL_VOLUME' },
      { sanityConfidenceImpact: 'BLOCKED' },
      { leadershipConfidence: 'BLOCKED', sanityConfidenceImpact: 'BLOCKED' },
      { sourceTier: 'STOCK_DAILY' },
      { sourceTier: 'UNKNOWN' },
      { sourceTier: 'FAILED' },
      { fallbackUsed: 'STOCK_DAILY' },
      { fallbackUsed: 'ETF' },
      { fallbackUsed: 'CACHE' },
      {},
    ];

    it.each(inputMatrix)('어떤 입력이든 hardBlockAllowed=false (literal) [%#]', (input) => {
      const result = deriveSectorEnergyExecutionImpact(input);
      expect(result.hardBlockAllowed).toBe(false);
      // executionImpact 도 HARD_BLOCK 절대 부재 (사용자 §"절대 불변식" #15)
      expect(result.executionImpact).not.toBe('HARD_BLOCK');
    });

    it('OK 외 모든 분기 → strongBuyAllowed=false', () => {
      const nonOkInputs: SectorEnergyExecutionImpactInput[] = [
        { dataQuality: 'PARTIAL' },
        { dataQuality: 'STALE' },
        { dataQuality: 'DEGRADED' },
        { dataQuality: 'FAILED' },
        { sanityConfidenceImpact: 'BLOCKED' },
        { sourceTier: 'STOCK_DAILY' },
        { fallbackUsed: 'CACHE' },
      ];
      for (const input of nonOkInputs) {
        const result = deriveSectorEnergyExecutionImpact(input);
        expect(result.strongBuyAllowed).toBe(false);
      }
    });

    it('OK 외 모든 분기 → sectorBoostAllowed=false', () => {
      const nonOkInputs: SectorEnergyExecutionImpactInput[] = [
        { dataQuality: 'STALE' },
        { dataQuality: 'DEGRADED' },
        { sourceTier: 'STOCK_DAILY' },
      ];
      for (const input of nonOkInputs) {
        const result = deriveSectorEnergyExecutionImpact(input);
        expect(result.sectorBoostAllowed).toBe(false);
      }
    });
  });

  describe('Group D — formatSectorEnergyExecutionImpactCompactLine', () => {
    it('OK 분기 → "execution HARD_BLOCK=no" 명시', () => {
      const result = deriveSectorEnergyExecutionImpact({
        dataQuality: 'OK',
        leadershipConfidence: 'OK',
      });
      const line = formatSectorEnergyExecutionImpactCompactLine(result);
      expect(line).toContain('🧩 SectorEnergy:');
      expect(line).toContain('diagnostic OK');
      expect(line).toContain('STRONG_BUY allowed');
      expect(line).toContain('execution HARD_BLOCK=no');
    });

    it('BLOCKED 분기 → diagnostic BLOCKED + STRONG_BUY blocked + execution HARD_BLOCK=no', () => {
      const result = deriveSectorEnergyExecutionImpact({ dataQuality: 'FAILED' });
      const line = formatSectorEnergyExecutionImpactCompactLine(result);
      expect(line).toContain('diagnostic BLOCKED');
      expect(line).toContain('sectorBoost=0');
      expect(line).toContain('STRONG_BUY blocked');
      expect(line).toContain('execution HARD_BLOCK=no');
    });

    it('plain text — Telegram <b> raw tag 부재 (HTML parse failure 방지)', () => {
      const result = deriveSectorEnergyExecutionImpact({ dataQuality: 'STALE' });
      const line = formatSectorEnergyExecutionImpactCompactLine(result);
      expect(line).not.toContain('<b>');
      expect(line).not.toContain('</b>');
      expect(line).not.toContain('<i>');
    });
  });
});
