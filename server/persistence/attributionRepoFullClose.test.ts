/**
 * @responsibility PR-2 emitFullCloseAttribution SSOT 회귀 테스트 (ADR-0006)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('attributionRepo emitFullCloseAttribution (PR-2, ADR-0006)', () => {
  let tmpDir: string;
  let repo: typeof import('./attributionRepo.js');
  const _origEnv = process.env.ATTRIBUTION_FULL_CLOSE_DISABLED;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-fullclose-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.ATTRIBUTION_FULL_CLOSE_DISABLED;
    vi.resetModules();
    repo = await import('./attributionRepo.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    if (_origEnv === undefined) delete process.env.ATTRIBUTION_FULL_CLOSE_DISABLED;
    else process.env.ATTRIBUTION_FULL_CLOSE_DISABLED = _origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const baseInput = {
    tradeId: 'TFC1',
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-30T05:30:00.000Z',
    returnPct: -3.5,
    holdingDays: 2,
    entryRegime: 'R2_BULL',
    exitRuleTag: 'HARD_STOP',
    conditionScores: { 1: 5, 9: 7, 18: 7 } as Record<number, number>,
  };

  it('정상 입력 — FULL_CLOSE 영속 + qtyRatio=1.0 + schemaVersion 자동', () => {
    const rec = repo.emitFullCloseAttribution(baseInput);
    expect(rec).not.toBeNull();
    expect(rec!.attributionType).toBe('FULL_CLOSE');
    expect(rec!.qtyRatio).toBe(1.0);
    expect(rec!.schemaVersion).toBe(repo.CURRENT_ATTRIBUTION_SCHEMA_VERSION);
    expect(rec!.tradeId).toBe('TFC1');
    expect(rec!.isWin).toBe(false); // returnPct=-3.5 → loss
    expect(rec!.fillId).toBeUndefined();

    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(1);
    expect(all[0].tradeId).toBe('TFC1');
  });

  it('returnPct > 0 → isWin=true', () => {
    const rec = repo.emitFullCloseAttribution({ ...baseInput, returnPct: 5.5 });
    expect(rec!.isWin).toBe(true);
  });

  it('빈 conditionScores → null 반환 (학습 오염 차단)', () => {
    const rec = repo.emitFullCloseAttribution({ ...baseInput, conditionScores: {} });
    expect(rec).toBeNull();
    expect(repo.loadAttributionRecords()).toHaveLength(0);
  });

  it('NaN returnPct → null (안전 가드)', () => {
    const rec = repo.emitFullCloseAttribution({ ...baseInput, returnPct: NaN });
    expect(rec).toBeNull();
  });

  it('Infinity returnPct → null', () => {
    const rec = repo.emitFullCloseAttribution({ ...baseInput, returnPct: Infinity });
    expect(rec).toBeNull();
  });

  it('ENV ATTRIBUTION_FULL_CLOSE_DISABLED=true → null (긴급 롤백)', async () => {
    process.env.ATTRIBUTION_FULL_CLOSE_DISABLED = 'true';
    vi.resetModules();
    repo = await import('./attributionRepo.js');

    const rec = repo.emitFullCloseAttribution(baseInput);
    expect(rec).toBeNull();
    expect(repo.loadAttributionRecords()).toHaveLength(0);
  });

  it('ENV "false" 명시 → 정상 작동 (default 정책 적용)', async () => {
    process.env.ATTRIBUTION_FULL_CLOSE_DISABLED = 'false';
    vi.resetModules();
    repo = await import('./attributionRepo.js');

    const rec = repo.emitFullCloseAttribution(baseInput);
    expect(rec).not.toBeNull();
  });

  it('isFullCloseAttributionDisabled — ENV 토글', async () => {
    expect(repo.isFullCloseAttributionDisabled()).toBe(false);

    process.env.ATTRIBUTION_FULL_CLOSE_DISABLED = 'true';
    vi.resetModules();
    repo = await import('./attributionRepo.js');
    expect(repo.isFullCloseAttributionDisabled()).toBe(true);
  });

  it('sellReason 미전달 시 exitRuleTag fallback', () => {
    const rec = repo.emitFullCloseAttribution(baseInput);
    expect(rec!.sellReason).toBe('HARD_STOP');
  });

  it('sellReason 명시 시 exitRuleTag 보다 우선', () => {
    const rec = repo.emitFullCloseAttribution({
      ...baseInput,
      sellReason: 'CUSTOM_REASON',
      exitRuleTag: 'HARD_STOP',
    });
    expect(rec!.sellReason).toBe('CUSTOM_REASON');
  });

  it('holdingDays 음수/실수 → 0 또는 floor 양수', () => {
    const rec1 = repo.emitFullCloseAttribution({ ...baseInput, holdingDays: -5 });
    expect(rec1!.holdingDays).toBe(0);

    const rec2 = repo.emitFullCloseAttribution({ ...baseInput, tradeId: 'TFC2', holdingDays: 3.7 });
    expect(rec2!.holdingDays).toBe(3);
  });

  it('동일 tradeId FULL_CLOSE — dedup overwrite (기존 v1 동작 유지)', () => {
    repo.emitFullCloseAttribution({ ...baseInput, returnPct: -1.0 });
    repo.emitFullCloseAttribution({ ...baseInput, returnPct: -3.5 });
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(1);
    expect(all[0].returnPct).toBe(-3.5); // overwrite
  });

  it('FULL_CLOSE + PARTIAL 병존 (복합키 dedup)', () => {
    repo.emitFullCloseAttribution(baseInput);
    repo.emitPartialAttribution({
      tradeId: baseInput.tradeId,
      fillId: 'fill-1',
      stockCode: baseInput.stockCode,
      stockName: baseInput.stockName,
      closedAt: '2026-04-30T05:00:00.000Z',
      returnPct: 2.5,
      qtyRatio: 0.3,
      holdingDays: 1,
      entryRegime: 'R2_BULL',
      conditionScoresOverride: baseInput.conditionScores,
    });
    const all = repo.loadAttributionRecords();
    expect(all).toHaveLength(2);
    const fullClose = all.find(r => r.attributionType === 'FULL_CLOSE');
    const partial = all.find(r => r.attributionType === 'PARTIAL');
    expect(fullClose).toBeDefined();
    expect(partial).toBeDefined();
    expect(partial!.fillId).toBe('fill-1');
  });

  it('analyzeAttribution / computeAttributionStats 가 신규 레코드 집계', () => {
    repo.emitFullCloseAttribution(baseInput);
    const stats = repo.computeAttributionStats();
    expect(stats.length).toBeGreaterThan(0);
    const cond9 = stats.find(s => s.conditionId === 9);
    expect(cond9).toBeDefined();
    expect(cond9!.totalTrades).toBe(1);
  });
});
