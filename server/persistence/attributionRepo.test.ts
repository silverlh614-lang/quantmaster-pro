/**
 * attributionRepo.test.ts — Phase 1.3 스키마 마이그레이션 회귀 테스트
 *
 * v0 (schemaVersion 누락) 레코드가 부팅 마이그레이션으로 v1 로 승격되고,
 * 불완전 레코드는 집계에서 자동 격리되는 계약을 검증한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('attributionRepo — 스키마 마이그레이션', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-migration-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('v0 레코드 (schemaVersion 누락) → v1 으로 승격', async () => {
    const attrFile = path.join(tmpDir, 'attribution-records.json');
    fs.writeFileSync(attrFile, JSON.stringify([
      {
        tradeId: 't1', stockCode: '005930', stockName: '삼성전자',
        closedAt: '2026-03-01T00:00:00Z',
        returnPct: 5.2, isWin: true,
        conditionScores: { 2: 7, 18: 6 },
        holdingDays: 3,
      },
    ]));

    const { migrateAttributionRecords, CURRENT_ATTRIBUTION_SCHEMA_VERSION, loadCurrentSchemaRecords } =
      await import('./attributionRepo.js');
    const result = migrateAttributionRecords();
    expect(result.migrated).toBe(1);
    expect(result.quarantined).toBe(0);

    const current = loadCurrentSchemaRecords();
    expect(current.length).toBe(1);
    expect(current[0].schemaVersion).toBe(CURRENT_ATTRIBUTION_SCHEMA_VERSION);
  });

  it('conditionScores 없는 불완전 레코드는 격리 (파일에서 제거)', async () => {
    const attrFile = path.join(tmpDir, 'attribution-records.json');
    fs.writeFileSync(attrFile, JSON.stringify([
      { tradeId: 't1', stockCode: '005930', stockName: 'A', closedAt: '2026-03-01', returnPct: 1, isWin: true, conditionScores: { 2: 5 }, holdingDays: 1 },
      { tradeId: 't2', /* no conditionScores */ stockCode: '000660', stockName: 'B', closedAt: '2026-03-02', returnPct: 2, isWin: true, holdingDays: 1 },
    ]));

    const { migrateAttributionRecords, loadAttributionRecords } = await import('./attributionRepo.js');
    const result = migrateAttributionRecords();
    expect(result.migrated).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(loadAttributionRecords().length).toBe(1); // 격리된 t2 는 제거됨
  });

  it('appendAttributionRecord 는 schemaVersion 을 강제 주입', async () => {
    const { appendAttributionRecord, loadAttributionRecords, CURRENT_ATTRIBUTION_SCHEMA_VERSION } =
      await import('./attributionRepo.js');
    appendAttributionRecord({
      tradeId: 't-new', stockCode: '005930', stockName: '삼성전자',
      closedAt: new Date().toISOString(), returnPct: 1, isWin: true,
      conditionScores: { 2: 5 }, holdingDays: 1,
    });
    const records = loadAttributionRecords();
    expect(records.length).toBe(1);
    expect(records[0].schemaVersion).toBe(CURRENT_ATTRIBUTION_SCHEMA_VERSION);
  });

  it('computeAttributionStats 는 현행 스키마만 집계 (혼합 시)', async () => {
    const attrFile = path.join(tmpDir, 'attribution-records.json');
    // 의도적으로 혼합 저장 — 미이그레이션 상태에서 stats 가 v0 을 제외해야 함
    fs.writeFileSync(attrFile, JSON.stringify([
      { tradeId: 't-v0', stockCode: '005930', stockName: 'A', closedAt: '2026-03-01', returnPct: 10, isWin: true, conditionScores: { 2: 8 }, holdingDays: 1 /* no schemaVersion */ },
      { tradeId: 't-v1', stockCode: '000660', stockName: 'B', closedAt: '2026-03-02', returnPct: 5, isWin: true, conditionScores: { 2: 7 }, holdingDays: 1, schemaVersion: 1 },
    ]));
    const { computeAttributionStats } = await import('./attributionRepo.js');
    const stats = computeAttributionStats();
    const cond2 = stats.find(s => s.conditionId === 2);
    expect(cond2).toBeDefined();
    expect(cond2!.totalTrades).toBe(1); // v1 한 건만
    expect(cond2!.avgReturn).toBe(5);   // 10 은 제외
  });
});
