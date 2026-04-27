/**
 * @responsibility reflectionImpactPolicy 회귀 테스트 — status 결정 트리 (ADR-0047 PR-Y2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ORIGINAL_DISABLED = process.env.LEARNING_REFLECTION_HALFLIFE_DISABLED;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('reflectionImpactPolicy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-policy-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.LEARNING_REFLECTION_HALFLIFE_DISABLED;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    if (ORIGINAL_DISABLED === undefined) delete process.env.LEARNING_REFLECTION_HALFLIFE_DISABLED;
    else process.env.LEARNING_REFLECTION_HALFLIFE_DISABLED = ORIGINAL_DISABLED;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('데이터 부재 → "grace" (신규 모듈)', async () => {
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    expect(getModuleStatus('mainReflection')).toBe('grace');
  });

  it('grace period 30일 내 → "grace"', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 10일 전 첫 등장
    const t = new Date(now.getTime() - 10 * DAY_MS);
    recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), false, t);
    expect(getModuleStatus('mainReflection', now)).toBe('grace');
  });

  it('grace period 통과 + 표본 < 20 → "grace"', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 60일 전 첫 등장 (grace 통과) — 5건만
    for (let i = 0; i < 5; i++) {
      const t = new Date(now.getTime() - (60 - i) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), false, t);
    }
    // 표본 부족 → grace
    expect(getModuleStatus('mainReflection', now)).toBe('grace');
  });

  it('영향률 0% (전부 silent) + 표본 ≥ 20 → "deprecated"', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 60일 전부터 25건 (전부 silent)
    for (let i = 0; i < 25; i++) {
      const t = new Date(now.getTime() - (60 - i * 2) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), false, t);
    }
    expect(getModuleStatus('mainReflection', now)).toBe('deprecated');
  });

  it('영향률 3% → "silent" (일자별 record)', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 100일치 record (각 일자 1건씩) — 첫 3건만 meaningful (3%)
    for (let i = 0; i < 100; i++) {
      const t = new Date(now.getTime() - (100 - i) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), i < 3, t);
    }
    expect(getModuleStatus('mainReflection', now)).toBe('silent');
  });

  it('영향률 10% (≥ 5%) → "normal"', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 50일치 record — 첫 5건 meaningful (10%)
    for (let i = 0; i < 50; i++) {
      const t = new Date(now.getTime() - (50 - i) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), i < 5, t);
    }
    // 그러나 firstSeenAt 이 50일 전 — grace period(30일) 통과
    expect(getModuleStatus('mainReflection', now)).toBe('normal');
  });

  it('영향률 boundary 5% 정확 → "normal" (≥ 5%)', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 60일치 — 3 meaningful = 5% 정확
    for (let i = 0; i < 60; i++) {
      const t = new Date(now.getTime() - (60 - i) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), i < 3, t);
    }
    expect(getModuleStatus('mainReflection', now)).toBe('normal');
  });

  it('boundary 1% 정확 → "silent" (< 5%, ≥ 1%)', async () => {
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 100일치 — 1 meaningful = 1%
    for (let i = 0; i < 100; i++) {
      const t = new Date(now.getTime() - (100 - i) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), i < 1, t);
    }
    expect(getModuleStatus('mainReflection', now)).toBe('silent');
  });

  it('LEARNING_REFLECTION_HALFLIFE_DISABLED=true → 항상 "normal"', async () => {
    process.env.LEARNING_REFLECTION_HALFLIFE_DISABLED = 'true';
    const { recordReflectionImpact } = await import('../persistence/reflectionImpactRepo.js');
    const { getModuleStatus } = await import('./reflectionImpactPolicy.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 영향률 0% 인데도 환경 변수로 우회
    for (let i = 0; i < 25; i++) {
      const t = new Date(now.getTime() - (60 - i * 2) * DAY_MS);
      recordReflectionImpact('mainReflection', t.toISOString().slice(0, 10), false, t);
    }
    expect(getModuleStatus('mainReflection', now)).toBe('normal');
  });

  it('getAllModuleStatuses — 13 카탈로그 반환 + grace 기본', async () => {
    const { getAllModuleStatuses, KNOWN_REFLECTION_MODULES } =
      await import('./reflectionImpactPolicy.js');
    const reports = getAllModuleStatuses(KNOWN_REFLECTION_MODULES.slice());
    expect(reports).toHaveLength(KNOWN_REFLECTION_MODULES.length);
    expect(reports.every(r => r.status === 'grace')).toBe(true);
    expect(reports.every(r => r.runs === 0)).toBe(true);
  });

  it('KNOWN_REFLECTION_MODULES 13개 보존 (drift 가드)', async () => {
    const { KNOWN_REFLECTION_MODULES } = await import('./reflectionImpactPolicy.js');
    expect(KNOWN_REFLECTION_MODULES).toHaveLength(13);
    expect(KNOWN_REFLECTION_MODULES).toContain('mainReflection');
    expect(KNOWN_REFLECTION_MODULES).toContain('biasHeatmap');
    expect(KNOWN_REFLECTION_MODULES).toContain('experimentProposal');
    expect(KNOWN_REFLECTION_MODULES).toContain('weeklyReflectionAudit');
  });
});
