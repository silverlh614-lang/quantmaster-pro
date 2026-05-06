// @responsibility ADR-0391 P0-A §A-3 /exec_paths 회귀 테스트
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_DIRECT_ACCESS,
  NEEDS_MIGRATION,
  buildExecPathsDiagnosis,
  formatExecPathsMessage,
} from './execPaths.cmd.js';

describe('ALLOWED_DIRECT_ACCESS 카탈로그 (ADR-0391 §A-3)', () => {
  it('5 entries — state.ts SSOT 내부 + index.ts 3 위치 + bootManifest', () => {
    expect(ALLOWED_DIRECT_ACCESS.length).toBe(5);
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
});

describe('NEEDS_MIGRATION 카탈로그 (ADR-0391 §A-3)', () => {
  it('7 entries — 사용자 명시 6곳 + audit 검출 healthCheckJob 1곳', () => {
    expect(NEEDS_MIGRATION.length).toBe(7);
  });

  it('사용자 명시 6 파일 모두 포함', () => {
    const userSpecified = [
      'server/orchestrator/tradingOrchestrator.ts',
      'server/trading/trancheExecutor.ts',
      'server/trading/dryRunScanner.ts',
      'server/trading/signalScanner/preflight.ts',
      'server/trading/bootReconcile.ts',
      'server/telegram/commands/system/gateAudit.cmd.ts',
    ];
    for (const f of userSpecified) {
      expect(NEEDS_MIGRATION.some(e => e.file === f)).toBe(true);
    }
  });

  it('audit 검출 healthCheckJob 포함 — 사용자 누락 보정', () => {
    expect(NEEDS_MIGRATION.some(e => e.file === 'server/scheduler/healthCheckJob.ts')).toBe(true);
  });

  it('모든 entry 에 file + line + reason 존재', () => {
    for (const e of NEEDS_MIGRATION) {
      expect(e.file).toBeTruthy();
      expect(e.line).toBeGreaterThan(0);
      expect(e.reason).toBeTruthy();
    }
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

describe('formatExecPathsMessage (ADR-0391 §A-3)', () => {
  it('Allowed/Needs Migration 카운트 + 카탈로그 + 진단 모두 표시', () => {
    const msg = formatExecPathsMessage();
    expect(msg).toContain(`Allowed (${ALLOWED_DIRECT_ACCESS.length})`);
    expect(msg).toContain(`Needs Migration (${NEEDS_MIGRATION.length})`);
    expect(msg).toContain('진단:');
  });

  it('현재 baseline — Needs Migration 7곳 → 🚨 마커', () => {
    const msg = formatExecPathsMessage();
    expect(msg).toContain('🚨');
    expect(msg).toContain('P0-B 마이그레이션 필요');
  });

  it('Allowed 카탈로그 entry 모두 라인:line 포맷 또는 file 만 표시', () => {
    const msg = formatExecPathsMessage();
    for (const e of ALLOWED_DIRECT_ACCESS) {
      expect(msg).toContain(e.file);
      expect(msg).toContain(e.reason);
    }
  });

  it('Needs Migration 카탈로그 entry 모두 file:line 포맷 표시', () => {
    const msg = formatExecPathsMessage();
    for (const e of NEEDS_MIGRATION) {
      expect(msg).toContain(`${e.file}:${e.line}`);
    }
  });
});
