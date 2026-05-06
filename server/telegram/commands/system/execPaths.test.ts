// @responsibility ADR-0391 P0-A §A-3 /exec_paths 회귀 테스트 (ADR-0392 P0-B 갱신)
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_DIRECT_ACCESS,
  NEEDS_MIGRATION,
  buildExecPathsDiagnosis,
  formatExecPathsMessage,
} from './execPaths.cmd.js';

describe('ALLOWED_DIRECT_ACCESS 카탈로그 (ADR-0392 P0-B 후)', () => {
  it('7 entries — state.ts SSOT + index.ts 3 위치 + bootManifest + gateAudit display + healthCheckJob display', () => {
    expect(ALLOWED_DIRECT_ACCESS.length).toBe(7);
  });

  it('state.ts 가 첫 번째 — readEnvMode SSOT 의 정당한 출처', () => {
    expect(ALLOWED_DIRECT_ACCESS[0]?.file).toBe('server/state.ts');
    expect(ALLOWED_DIRECT_ACCESS[0]?.reason).toMatch(/SSOT/);
  });

  it('모든 entry 에 file + reason 필드 존재', () => {
    for (const e of ALLOWED_DIRECT_ACCESS) {
      expect(e.file).toBeTruthy();
      expect(e.reason).toBeTruthy();
    }
  });

  it('gateAudit + healthCheckJob 재분류 (ADR-0392) — display only ALLOWED', () => {
    expect(ALLOWED_DIRECT_ACCESS.some(e => e.file === 'server/telegram/commands/system/gateAudit.cmd.ts')).toBe(true);
    expect(ALLOWED_DIRECT_ACCESS.some(e => e.file === 'server/scheduler/healthCheckJob.ts')).toBe(true);
  });
});

describe('NEEDS_MIGRATION 카탈로그 (ADR-0392 P0-B 완료)', () => {
  it('0 entries — 모든 분기 로직 getTradingMode() SSOT 통일', () => {
    expect(NEEDS_MIGRATION.length).toBe(0);
  });
});

describe('buildExecPathsDiagnosis (ADR-0391 §A-3)', () => {
  it('카운트 0 → ✅ 모든 참조 SSOT 통과', () => {
    expect(buildExecPathsDiagnosis(0)).toContain('✅');
    expect(buildExecPathsDiagnosis(0)).toContain('SSOT 통과');
  });

  it('카운트 1+ → 🚨 마이그레이션 필요', () => {
    const result = buildExecPathsDiagnosis(7);
    expect(result).toContain('🚨');
    expect(result).toContain('7곳');
    expect(result).toContain('P0-B');
  });
});

describe('formatExecPathsMessage (ADR-0392 P0-B 후)', () => {
  it('Allowed/Needs Migration 카운트 + 진단 모두 표시', () => {
    const msg = formatExecPathsMessage();
    expect(msg).toContain(`Allowed (${ALLOWED_DIRECT_ACCESS.length})`);
    expect(msg).toContain(`Needs Migration (${NEEDS_MIGRATION.length})`);
    expect(msg).toContain('진단:');
  });

  it('P0-B 후 — Needs Migration 0건 → ✅ 마커 (측정 가능한 효과)', () => {
    const msg = formatExecPathsMessage();
    expect(msg).toContain('✅');
    expect(msg).toContain('SSOT 통과');
    expect(msg).not.toContain('🚨');
  });

  it('Allowed 카탈로그 entry 모두 file + reason 표시', () => {
    const msg = formatExecPathsMessage();
    for (const e of ALLOWED_DIRECT_ACCESS) {
      expect(msg).toContain(e.file);
      expect(msg).toContain(e.reason);
    }
  });
});
