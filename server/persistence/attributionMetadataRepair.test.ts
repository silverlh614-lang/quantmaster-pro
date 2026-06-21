/**
 * @responsibility Patch 2 gap (d) 회귀 — counterfactual metadata repair append-only + read-only 진단
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('attributionMetadataRepair — counterfactual stop/target backfill (append-only)', () => {
  let tmpDir: string;
  let repo: typeof import('./attributionRepo.js');
  let repair: typeof import('./attributionMetadataRepair.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-repair-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    repo = await import('./attributionRepo.js');
    repair = await import('./attributionMetadataRepair.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  function seedShadow(id: string, stopLoss: number, targetPrice: number) {
    fs.writeFileSync(path.join(tmpDir, 'shadow-trades.json'), JSON.stringify([
      { id, stockCode: '005930', stockName: '삼성전자', signalTime: '2026-04-01T00:00:00Z', signalPrice: 50000, shadowEntryPrice: 50000, quantity: 10, stopLoss, targetPrice, mode: 'SHADOW' },
    ]));
  }

  const cfRec = {
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-24T04:30:00.000Z',
    returnPct: 2,
    isWin: true,
    holdingDays: 2,
    conditionScores: { 2: 8 },
  };

  it('counterfactual 레코드의 결손 stop/target 을 shadow 원장에서 backfill', () => {
    seedShadow('cf-1', 47000, 60000);
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'counterfactual:cf-1' });
    const before = repo.loadAttributionRecords().find(r => r.tradeId === 'counterfactual:cf-1')!;
    expect(before.stopPrice).toBeUndefined();

    const result = repair.repairCounterfactualMetadata();
    expect(result.repaired).toBe(1);
    const after = repo.loadAttributionRecords().find(r => r.tradeId === 'counterfactual:cf-1')!;
    expect(after.stopPrice).toBe(47000);
    expect(after.targetPrice).toBe(60000);
  });

  it('append-only — 기존 표본 수·라벨·returnPct·qtyRatio 불변', () => {
    seedShadow('cf-2', 47000, 60000);
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'counterfactual:cf-2', returnPct: 3.3 });
    const countBefore = repo.loadAttributionRecords().length;
    repair.repairCounterfactualMetadata();
    const all = repo.loadAttributionRecords();
    expect(all.length).toBe(countBefore); // 표본 수 불변
    const rec = all.find(r => r.tradeId === 'counterfactual:cf-2')!;
    expect(rec.returnPct).toBe(3.3);       // 결과 라벨 불변
    expect(rec.attributionType).toBe('FULL_CLOSE');
    expect(rec.qtyRatio).toBe(1.0);
  });

  it('이미 stop/target 있는 레코드는 무수정 (idempotent)', () => {
    seedShadow('cf-3', 47000, 60000);
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'counterfactual:cf-3', stopPrice: 99000, targetPrice: 111000 });
    const result = repair.repairCounterfactualMetadata();
    expect(result.repaired).toBe(0);
    const rec = repo.loadAttributionRecords().find(r => r.tradeId === 'counterfactual:cf-3')!;
    expect(rec.stopPrice).toBe(99000); // 원천으로 덮어쓰지 않음
    expect(rec.targetPrice).toBe(111000);
  });

  it('LIVE lane 레코드는 repair 대상 아님 (live 누수 차단)', () => {
    seedShadow('live-1', 47000, 60000);
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'live-1', evidenceSource: 'LIVE' });
    const result = repair.repairCounterfactualMetadata();
    expect(result.missingBefore).toBe(0);
    expect(result.repaired).toBe(0);
    const rec = repo.loadAttributionRecords().find(r => r.tradeId === 'live-1')!;
    expect(rec.stopPrice).toBeUndefined();
  });

  it('원천 매칭 실패 시 unresolved 로 집계하고 강제 추정하지 않음', () => {
    // shadow 원장 없음
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'counterfactual:orphan' });
    const result = repair.repairCounterfactualMetadata();
    expect(result.missingBefore).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.unresolved).toBe(1);
    const rec = repo.loadAttributionRecords().find(r => r.tradeId === 'counterfactual:orphan')!;
    expect(rec.stopPrice).toBeUndefined();
  });

  it('inspectCounterfactualMetadataHealth — read-only 결손 집계 (데이터 무변경)', () => {
    seedShadow('cf-h', 47000, 60000);
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'counterfactual:cf-h' });          // 결손
    repo.appendAttributionRecord({ ...cfRec, tradeId: 'counterfactual:ok', stopPrice: 1, targetPrice: 2 }); // 완비
    const health = repair.inspectCounterfactualMetadataHealth();
    expect(health.counterfactualSamples).toBe(2);
    expect(health.missingEither).toBe(1);
    // read-only 확인 — 호출 후에도 결손 레코드는 그대로
    const rec = repo.loadAttributionRecords().find(r => r.tradeId === 'counterfactual:cf-h')!;
    expect(rec.stopPrice).toBeUndefined();
  });
});
