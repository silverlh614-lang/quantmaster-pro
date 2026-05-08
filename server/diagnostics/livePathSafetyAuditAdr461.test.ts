import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runLivePathSafetyAudit } from './livePathSafetyAudit.js';

let tmp: string | null = null;

function makeTmp(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr461-live-path-'));
  return tmp;
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe('ADR-461 live path safety audit', () => {
  it('livePathSafetyAudit 정상 소스에서 passed=true', () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, 'server/learning'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'server/learning/safe.ts'), 'export const executionImpact = "NONE";');
    const result = runLivePathSafetyAudit({ cwd, roots: ['server/learning'] });
    expect(result.passed).toBe(true);
  });

  it('금지 패턴 삽입 fixture에서 passed=false', () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, 'server/learning'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'server/learning/unsafe.ts'), 'export const x = { createLiveOrder: true, executionImpact: "FULL" };');
    const result = runLivePathSafetyAudit({ cwd, roots: ['server/learning'] });
    expect(result.passed).toBe(false);
    expect(result.createLiveOrderTrueDetected).toBe(true);
    expect(result.executionImpactFullOrPartialDetected).toBe(true);
  });

  it('ADR-460 관련 운영 artifact 발견 시 unexpectedAdr460ArtifactDetected=true', () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, 'server/persistence'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'server/persistence/overlay.ts'), 'export const GateLiveOverlay = {};');
    const result = runLivePathSafetyAudit({ cwd, roots: ['server/persistence'] });
    expect(result.unexpectedAdr460ArtifactDetected).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('테스트/문서 false positive는 allowlist 처리', () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, 'server/learning'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'server/learning/unsafe.test.ts'), 'createLiveOrder: true; GateLiveOverlay;');
    fs.writeFileSync(path.join(cwd, 'server/learning/README.md'), 'placeKisMarketOrder');
    const result = runLivePathSafetyAudit({ cwd, roots: ['server/learning'] });
    expect(result.passed).toBe(true);
  });

  it('KIS order API / Gate threshold / Kelly / normalizedGateScore live decision 변경 없음 정적 grep', () => {
    const result = runLivePathSafetyAudit();
    expect(result.kisOrderImportDetected).toBe(false);
    expect(result.gateThresholdMutationDetected).toBe(false);
    expect(result.kellyMutationDetected).toBe(false);
    expect(result.normalizedGateScoreLiveDecisionDetected).toBe(false);
  });
});
