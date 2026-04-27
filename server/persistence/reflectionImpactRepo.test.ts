/**
 * @responsibility reflectionImpactRepo 회귀 테스트 (ADR-0047 PR-Y2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('reflectionImpactRepo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-impact-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('빈 파일 → 빈 배열', async () => {
    const { loadReflectionImpactRecords } = await import('./reflectionImpactRepo.js');
    expect(loadReflectionImpactRecords()).toEqual([]);
  });

  it('첫 record 누적 + 정상 round-trip', async () => {
    const { recordReflectionImpact, loadReflectionImpactRecords } =
      await import('./reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    const entry = recordReflectionImpact('mainReflection', '2026-04-26', true, now);
    expect(entry.module).toBe('mainReflection');
    expect(entry.meaningful).toBe(true);

    const all = loadReflectionImpactRecords();
    expect(all).toHaveLength(1);
    expect(all[0].date).toBe('2026-04-26');
  });

  it('동일 (date, module) 중복 호출 → 마지막 값으로 덮어쓰기', async () => {
    const { recordReflectionImpact, loadReflectionImpactRecords } =
      await import('./reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    recordReflectionImpact('biasHeatmap', '2026-04-26', false, now);
    recordReflectionImpact('biasHeatmap', '2026-04-26', true, now);

    const all = loadReflectionImpactRecords();
    expect(all).toHaveLength(1);
    expect(all[0].meaningful).toBe(true);
  });

  it('잘못된 date 형식 → throw', async () => {
    const { recordReflectionImpact } = await import('./reflectionImpactRepo.js');
    expect(() => recordReflectionImpact('m', '2026-4-26', true)).toThrow();
    expect(() => recordReflectionImpact('m', '20260426', true)).toThrow();
  });

  it('1년 이전 record 자동 trim', async () => {
    const { recordReflectionImpact, loadReflectionImpactRecords } =
      await import('./reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 400일 전 (1년 초과)
    const old = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    recordReflectionImpact('mainReflection', old.toISOString().slice(0, 10), true, old);
    // 새 record 추가 — old 자동 trim
    recordReflectionImpact('mainReflection', '2026-04-26', true, now);

    const all = loadReflectionImpactRecords();
    expect(all).toHaveLength(1);
    expect(all[0].date).toBe('2026-04-26');
  });

  it('손상된 JSON → 빈 배열 fallback', async () => {
    const filePath = path.join(tmpDir, 'reflection-impact.json');
    fs.writeFileSync(filePath, '{{not valid json');
    const { loadReflectionImpactRecords } = await import('./reflectionImpactRepo.js');
    expect(loadReflectionImpactRecords()).toEqual([]);
  });

  it('getModuleStats — 0건 → impactRate=0 + firstSeenAt=null', async () => {
    const { getModuleStats } = await import('./reflectionImpactRepo.js');
    const stats = getModuleStats('mainReflection');
    expect(stats.runs).toBe(0);
    expect(stats.impactRate).toBe(0);
    expect(stats.firstSeenAt).toBeNull();
  });

  it('getModuleStats — 60% impactRate 계산', async () => {
    const { recordReflectionImpact, getModuleStats } =
      await import('./reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 5건: 3 meaningful, 2 silent — 일자 다르게
    for (let i = 0; i < 5; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      recordReflectionImpact('biasHeatmap', d.toISOString().slice(0, 10), i < 3, now);
    }
    const stats = getModuleStats('biasHeatmap', 30, now);
    expect(stats.runs).toBe(5);
    expect(stats.meaningfulRuns).toBe(3);
    expect(stats.impactRate).toBe(0.6);
    expect(stats.firstSeenAt).not.toBeNull();
  });

  it('getModuleStats — 윈도우 30일 밖 record 제외', async () => {
    const { recordReflectionImpact, getModuleStats } =
      await import('./reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // 60일 전 (30일 윈도우 밖)
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    recordReflectionImpact('mainReflection', old.toISOString().slice(0, 10), true, old);
    // 5일 전 (30일 윈도우 안)
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    recordReflectionImpact('mainReflection', recent.toISOString().slice(0, 10), false, recent);

    const stats = getModuleStats('mainReflection', 30, now);
    expect(stats.runs).toBe(1); // 윈도우 안 1건만
    expect(stats.firstSeenAt).toBe(old.toISOString().slice(0, 10)); // 전체 데이터의 first
  });

  it('getAllModuleStats — impactRate 오름차순 (가장 silent 한 모듈 선두)', async () => {
    const { recordReflectionImpact, getAllModuleStats } =
      await import('./reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    // moduleA: 100% impact (1/1)
    recordReflectionImpact('moduleA', '2026-04-26', true, now);
    // moduleB: 0% impact (0/1)
    recordReflectionImpact('moduleB', '2026-04-26', false, now);
    // moduleC: 50% impact (1/2)
    recordReflectionImpact('moduleC', '2026-04-25', true, now);
    recordReflectionImpact('moduleC', '2026-04-26', false, now);

    const all = getAllModuleStats(30, now);
    expect(all).toHaveLength(3);
    expect(all[0].module).toBe('moduleB'); // 0%
    expect(all[1].module).toBe('moduleC'); // 50%
    expect(all[2].module).toBe('moduleA'); // 100%
  });
});
