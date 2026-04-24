/**
 * @responsibility PR-19 attributionRepo 복합키/qtyRatio/PARTIAL 회귀 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('attributionRepo PR-19 (fillId + qtyRatio + PARTIAL)', () => {
  let tmpDir: string;
  let repo: typeof import('./attributionRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attribution-repo-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // DATA_DIR 은 paths.ts import 시점에 해석 → 매 테스트마다 모듈 캐시 리셋 필수.
    vi.resetModules();
    repo = await import('./attributionRepo.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const baseRec = {
    tradeId: 'T1',
    stockCode: '004020',
    stockName: '현대제철',
    closedAt: '2026-04-24T04:30:00.000Z',
    returnPct: 5.0,
    isWin: true,
    conditionScores: { 1: 8, 2: 7, 3: 6 },
    holdingDays: 2,
  };

  it('appendAttributionRecord — FULL_CLOSE dedup by tradeId (기존 동작 유지)', () => {
    repo.appendAttributionRecord({ ...baseRec, returnPct: 5.0 });
    // 동일 tradeId 로 다시 저장 → FULL_CLOSE 는 tradeId 만 보고 overwrite.
    repo.appendAttributionRecord({ ...baseRec, returnPct: 7.0 });
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(1);
    expect(all[0].returnPct).toBe(7.0);
    expect(all[0].attributionType).toBe('FULL_CLOSE');
    expect(all[0].qtyRatio).toBe(1.0);
  });

  it('PARTIAL — 동일 tradeId 라도 fillId 다르면 둘 다 보존', () => {
    repo.appendAttributionRecord({ ...baseRec, fillId: 'f1', qtyRatio: 0.3, returnPct: 5.0 });
    repo.appendAttributionRecord({ ...baseRec, fillId: 'f2', qtyRatio: 0.4, returnPct: 3.0 });
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(2);
    expect(all.map(r => r.fillId).sort()).toEqual(['f1', 'f2']);
    expect(all.every(r => r.attributionType === 'PARTIAL')).toBe(true);
  });

  it('FULL_CLOSE 와 PARTIAL 은 독립 병존 (같은 tradeId)', () => {
    // PARTIAL 먼저 저장.
    repo.appendAttributionRecord({ ...baseRec, fillId: 'p1', qtyRatio: 0.3, returnPct: 5.0 });
    // FULL_CLOSE 추가 (fillId 없음).
    repo.appendAttributionRecord({ ...baseRec, returnPct: -10.0 });
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(2);
    const partial = all.find(r => r.attributionType === 'PARTIAL');
    const full    = all.find(r => r.attributionType === 'FULL_CLOSE' || !r.attributionType);
    expect(partial).toBeDefined();
    expect(full).toBeDefined();
    expect(partial?.fillId).toBe('p1');
  });

  it('migrateAttributionRecords v1→v2 — 기존 v1 레코드에 FULL_CLOSE + qtyRatio=1.0 주입', () => {
    // v1 레코드 직접 저장 (appendAttributionRecord 우회).
    repo.saveAttributionRecords([
      {
        ...baseRec,
        schemaVersion: 1,
        tradeId: 'LEGACY_V1',
        // attributionType / qtyRatio 부재
      },
      {
        ...baseRec,
        schemaVersion: 0,
        tradeId: 'LEGACY_V0',
        // v0 — 마이그레이션 대상
      },
    ] as any);
    const result = repo.migrateAttributionRecords();
    expect(result.migrated).toBe(2);
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(2);
    for (const r of all) {
      expect(r.schemaVersion).toBe(repo.CURRENT_ATTRIBUTION_SCHEMA_VERSION);
      expect(r.attributionType).toBe('FULL_CLOSE');
      expect(r.qtyRatio).toBe(1.0);
    }
  });

  it('computeAttributionStats — qtyRatio 가중 반영', () => {
    // 조건 1 에 score=8 인 trade 가 2건: 전량청산 (+5%, qtyRatio=1.0) + PARTIAL (+0%, qtyRatio=0.5)
    repo.appendAttributionRecord({ ...baseRec, tradeId: 'WIN', returnPct: 10.0 }); // FULL_CLOSE win
    repo.appendAttributionRecord({
      ...baseRec,
      tradeId: 'PART',
      fillId: 'f1',
      qtyRatio: 0.5,
      returnPct: -2.0, // loss fill
    });
    const stats = repo.computeAttributionStats();
    const cond1 = stats.find(s => s.conditionId === 1)!;
    // 가중 승률 = weight(win) / (weight(win) + weight(loss)) = 1.0 / 1.5 ≈ 66.7%
    expect(cond1.winRate).toBeCloseTo(66.7, 1);
    // 가중 평균 return = (10×1.0 + (-2)×0.5) / 1.5 = 9 / 1.5 = 6.0
    expect(cond1.avgReturn).toBeCloseTo(6.0, 1);
    // totalTrades 는 가중 합 (1.0 + 0.5 = 1.5 → round = 2)
    expect(cond1.totalTrades).toBe(2);
  });

  it('emitPartialAttribution — 기존 FULL_CLOSE 에서 conditionScores 승계', () => {
    // 먼저 FULL_CLOSE 저장.
    repo.appendAttributionRecord({ ...baseRec, tradeId: 'PARENT', returnPct: 0 });
    // PARTIAL emit.
    const emitted = repo.emitPartialAttribution({
      tradeId: 'PARENT',
      fillId: 'partial1',
      stockCode: '004020',
      stockName: '현대제철',
      closedAt: '2026-04-24T06:00:00.000Z',
      returnPct: 3.5,
      qtyRatio: 0.25,
      holdingDays: 2,
    });
    expect(emitted).not.toBeNull();
    expect(emitted?.attributionType).toBe('PARTIAL');
    expect(emitted?.qtyRatio).toBe(0.25);
    expect(emitted?.conditionScores).toEqual(baseRec.conditionScores);
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(2);
  });

  it('emitPartialAttribution — 부모 없고 override 도 없으면 null', () => {
    const emitted = repo.emitPartialAttribution({
      tradeId: 'NOBASE',
      fillId: 'f1',
      stockCode: 'X',
      stockName: 'X',
      closedAt: '2026-04-24T06:00:00.000Z',
      returnPct: 1.0,
      qtyRatio: 0.2,
      holdingDays: 1,
    });
    expect(emitted).toBeNull();
    expect(repo.loadAttributionRecords()).toHaveLength(0);
  });

  it('emitPartialAttribution — override conditionScores 로 자립 가능', () => {
    const emitted = repo.emitPartialAttribution({
      tradeId: 'STANDALONE',
      fillId: 'f1',
      stockCode: 'X',
      stockName: 'X',
      closedAt: '2026-04-24T06:00:00.000Z',
      returnPct: 1.0,
      qtyRatio: 0.2,
      holdingDays: 1,
      conditionScoresOverride: { 1: 9, 2: 8 },
    });
    expect(emitted).not.toBeNull();
    expect(emitted?.conditionScores).toEqual({ 1: 9, 2: 8 });
  });
});
