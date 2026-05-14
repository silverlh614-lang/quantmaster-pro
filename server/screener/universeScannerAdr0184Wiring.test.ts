/**
 * @responsibility ADR-0184 (PR-B12-A) site 1 — universeScanner 3 함수 master guard wiring 정적 가드.
 *
 * runFullDiscoveryPipeline / runStage1PreScreening / runStage2_3FinalScreening 진입부에서
 * `ensureScannerMasterUsable` 호출 의무 + ENV `EMERGENCY_MASTER_GUARD_SCAN_ENABLED` default OFF 정합 검증.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, 'universeScanner.ts'),
  'utf-8',
);

describe('ADR-0184 universeScanner master guard wiring', () => {
  describe('헬퍼 정의', () => {
    it('ensureScannerMasterUsable 함수 정의', () => {
      expect(SOURCE).toMatch(/async function ensureScannerMasterUsable\b/);
    });

    it('isEmergencyMasterGuardScanEnabled import', () => {
      expect(SOURCE).toMatch(
        /import\s*{\s*isEmergencyMasterGuardScanEnabled\s*}\s*from\s*['"]\.\.\/dataQuality\/emergencyDataQualityGuards\.js['"]/,
      );
    });

    it('assertProductionMasterUsable + formatProductionMasterBlockedMessage import', () => {
      expect(SOURCE).toMatch(
        /import\s*{\s*assertProductionMasterUsable,\s*formatProductionMasterBlockedMessage,\s*}\s*from\s*['"]\.\.\/dataQuality\/productionMasterGuard\.js['"]/,
      );
    });

    it('ENV gate default OFF — 미설정 시 true return (legacy 동작)', () => {
      // 헬퍼 본체가 ENV 체크 → false 시 true 반환 패턴
      expect(SOURCE).toMatch(/if\s*\(\s*!\s*isEmergencyMasterGuardScanEnabled\(\)\s*\)\s*return\s+true/);
    });

    it('assertProductionMasterUsable("SCANNER") 호출', () => {
      expect(SOURCE).toMatch(/assertProductionMasterUsable\(['"]SCANNER['"]\)/);
    });

    it('try/catch 격리 — telegram throw 가 cron 흐름 차단 안 함', () => {
      expect(SOURCE).toMatch(/sendTelegramAlert\([\s\S]+?\)\.catch\(console\.error\)/);
    });

    it('SCAN_ABORTED dedupeKey + cooldown', () => {
      expect(SOURCE).toMatch(/dedupeKey:\s*`scan_aborted_master_unusable:/);
      expect(SOURCE).toMatch(/cooldownMs:\s*10\s*\*\s*60\s*\*\s*1000/);
    });

    it('jobLabel 인자로 dedupeKey + 메시지 분기 — 3 함수 독립 dedupeKey', () => {
      expect(SOURCE).toMatch(/jobLabel:\s*string/);
    });
  });

  describe('3 진입점 wiring 정합', () => {
    it('runFullDiscoveryPipeline 진입부 ensureScannerMasterUsable("Pipeline")', () => {
      const fnRegion = SOURCE.split('export async function runFullDiscoveryPipeline')[1] ?? '';
      expect(fnRegion).toMatch(/ensureScannerMasterUsable\(['"]Pipeline['"]\)/);
    });

    it('runStage1PreScreening 진입부 ensureScannerMasterUsable("PreScreen")', () => {
      const fnRegion = SOURCE.split('export async function runStage1PreScreening')[1] ?? '';
      expect(fnRegion).toMatch(/ensureScannerMasterUsable\(['"]PreScreen['"]\)/);
    });

    it('runStage2_3FinalScreening 진입부 ensureScannerMasterUsable("FinalScreen")', () => {
      const fnRegion = SOURCE.split('export async function runStage2_3FinalScreening')[1] ?? '';
      expect(fnRegion).toMatch(/ensureScannerMasterUsable\(['"]FinalScreen['"]\)/);
    });

    it('3 함수 모두 guard early return 패턴 (false → return)', () => {
      // 진입부 if (!(await ensureScannerMasterUsable(...))) return; 패턴
      const matches = SOURCE.match(/if\s*\(!\(await\s+ensureScannerMasterUsable\(['"](Pipeline|PreScreen|FinalScreen)['"]\)\)\)\s*return;/g);
      expect(matches?.length).toBe(3);
    });
  });

  describe('회귀 가드', () => {
    it('ADR-0184 추적 주석', () => {
      expect(SOURCE).toMatch(/ADR-0184/);
    });

    it('PR-B12-A 추적 주석', () => {
      expect(SOURCE).toMatch(/PR-B12-A/);
    });

    it('호출자 측 inline ENV 검사 부재 — SSOT 위임', () => {
      // 3 함수 진입부에서 직접 process.env 검사하면 안 됨 (헬퍼 SSOT 위임)
      const fns = ['runFullDiscoveryPipeline', 'runStage1PreScreening', 'runStage2_3FinalScreening'];
      for (const fn of fns) {
        const fnRegion = (SOURCE.split(`export async function ${fn}`)[1] ?? '').slice(0, 1000);
        expect(fnRegion).not.toMatch(/process\.env\.EMERGENCY_MASTER_GUARD_SCAN_ENABLED/);
      }
    });

    it('헬퍼는 단 한 번만 정의 (drift 차단)', () => {
      const matches = SOURCE.match(/async function ensureScannerMasterUsable/g);
      expect(matches?.length).toBe(1);
    });
  });
});
