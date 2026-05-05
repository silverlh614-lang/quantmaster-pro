/**
 * @responsibility ADR-0185 (PR-B12-B) ENV 우회 헬퍼 정합성 회귀.
 * `isEmergencyBuyPipelineCodeGuardEnabled` (default ON) +
 * `isEmergencyStage1StrictEnabled` (default OFF) ENV gate 분기 검증.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isEmergencyBuyPipelineCodeGuardEnabled,
  isEmergencyStage1StrictEnabled,
} from './emergencyDataQualityGuards';

const ORIG_BUY_GUARD = process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED;
const ORIG_STAGE1 = process.env.EMERGENCY_STAGE1_STRICT_ENABLED;

function clearAdrEnv(): void {
  delete process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED;
  delete process.env.EMERGENCY_STAGE1_STRICT_ENABLED;
}

function restoreAdrEnv(): void {
  if (ORIG_BUY_GUARD === undefined) delete process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED;
  else process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = ORIG_BUY_GUARD;
  if (ORIG_STAGE1 === undefined) delete process.env.EMERGENCY_STAGE1_STRICT_ENABLED;
  else process.env.EMERGENCY_STAGE1_STRICT_ENABLED = ORIG_STAGE1;
}

describe('ADR-0185 (PR-B12-B) ENV 헬퍼', () => {
  beforeEach(clearAdrEnv);
  afterEach(restoreAdrEnv);

  describe('isEmergencyBuyPipelineCodeGuardEnabled (default ON)', () => {
    it('미설정 시 true 반환 (default ON — 잘못된 code 영구 차단)', () => {
      expect(isEmergencyBuyPipelineCodeGuardEnabled()).toBe(true);
    });

    it('"true" 명시 시 false (legacy 동작)', () => {
      process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = 'true';
      expect(isEmergencyBuyPipelineCodeGuardEnabled()).toBe(false);
    });

    it('"false" 명시 시 true (default 와 동일)', () => {
      process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = 'false';
      expect(isEmergencyBuyPipelineCodeGuardEnabled()).toBe(true);
    });

    it('"1" / "TRUE" 거부 (정확 비교 의무) — guard 활성 유지', () => {
      process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = '1';
      expect(isEmergencyBuyPipelineCodeGuardEnabled()).toBe(true);
      process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = 'TRUE';
      expect(isEmergencyBuyPipelineCodeGuardEnabled()).toBe(true);
    });

    it('빈 문자열 시 true (default 보수)', () => {
      process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = '';
      expect(isEmergencyBuyPipelineCodeGuardEnabled()).toBe(true);
    });
  });

  describe('isEmergencyStage1StrictEnabled (default OFF)', () => {
    it('미설정 시 false 반환 (default OFF — 통계 분포 변동 격리)', () => {
      expect(isEmergencyStage1StrictEnabled()).toBe(false);
    });

    it('"true" 정확 비교 시 true (strict 활성)', () => {
      process.env.EMERGENCY_STAGE1_STRICT_ENABLED = 'true';
      expect(isEmergencyStage1StrictEnabled()).toBe(true);
    });

    it('"1" / "TRUE" / "yes" 거부 (정확 비교 의무)', () => {
      process.env.EMERGENCY_STAGE1_STRICT_ENABLED = '1';
      expect(isEmergencyStage1StrictEnabled()).toBe(false);
      process.env.EMERGENCY_STAGE1_STRICT_ENABLED = 'TRUE';
      expect(isEmergencyStage1StrictEnabled()).toBe(false);
      process.env.EMERGENCY_STAGE1_STRICT_ENABLED = 'yes';
      expect(isEmergencyStage1StrictEnabled()).toBe(false);
    });

    it('"false" 명시 시 false', () => {
      process.env.EMERGENCY_STAGE1_STRICT_ENABLED = 'false';
      expect(isEmergencyStage1StrictEnabled()).toBe(false);
    });
  });
});
