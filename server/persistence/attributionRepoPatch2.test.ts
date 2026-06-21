/**
 * @responsibility Patch 2 회귀 — regime 집계·qtyRatio 누적 가드·counterfactual prefix 격리·stop/target round-trip
 *
 * 전부 shadow lane. executionImpact=NONE. LIVE 매매 본체 무관.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('attributionRepo Patch 2 — shadow attribution 정밀화', () => {
  let tmpDir: string;
  let repo: typeof import('./attributionRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-patch2-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    repo = await import('./attributionRepo.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const baseRec = {
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-24T04:30:00.000Z',
    isWin: true,
    holdingDays: 2,
  };

  // ── gap (c) regime-conditioned aggregation ────────────────────────────────

  describe('gap (c) regime-conditioned 집계', () => {
    function seedTwoRegimes() {
      // R2_BULL 두 건 (+10, +6 → 둘 다 win), R6_DEFENSE 한 건 (-8 loss).
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'B1', returnPct: 10, entryRegime: 'R2_BULL', conditionScores: { 2: 8 } });
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'B2', returnPct: 6, entryRegime: 'R2_BULL', conditionScores: { 2: 7 } });
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'D1', returnPct: -8, entryRegime: 'R6_DEFENSE', isWin: false, conditionScores: { 2: 8 } });
    }

    it('무인자 호출은 전 레짐 global pool 집계 (byte-equivalent baseline)', () => {
      seedTwoRegimes();
      const all = repo.computeAttributionStats();
      const cond2 = all.find(s => s.conditionId === 2)!;
      // 3건 전부 — 평균 (10+6-8)/3 = 2.67, 승률 2/3 = 66.7%
      expect(cond2.totalTrades).toBe(3);
      expect(cond2.avgReturn).toBeCloseTo(2.67, 1);
      expect(cond2.winRate).toBeCloseTo(66.7, 1);
    });

    it('regime 지정 시 해당 레짐 표본만 집계 (R6 오염 제거)', () => {
      seedTwoRegimes();
      const bull = repo.computeAttributionStats({ regime: 'R2_BULL' });
      const c2 = bull.find(s => s.conditionId === 2)!;
      // R2_BULL 두 건만 — 평균 (10+6)/2 = 8, 승률 100%
      expect(c2.totalTrades).toBe(2);
      expect(c2.avgReturn).toBeCloseTo(8, 1);
      expect(c2.winRate).toBeCloseTo(100, 1);

      const defense = repo.computeAttributionStats({ regime: 'R6_DEFENSE' });
      const c2d = defense.find(s => s.conditionId === 2)!;
      expect(c2d.totalTrades).toBe(1);
      expect(c2d.avgReturn).toBeCloseTo(-8, 1);
      expect(c2d.winRate).toBeCloseTo(0, 1);
    });

    it('레짐 분리 표본 합 = global 표본 (오염 없음, 합 보존)', () => {
      seedTwoRegimes();
      const bull = repo.computeAttributionStats({ regime: 'R2_BULL' }).find(s => s.conditionId === 2)!;
      const defense = repo.computeAttributionStats({ regime: 'R6_DEFENSE' }).find(s => s.conditionId === 2)!;
      const global = repo.computeAttributionStats().find(s => s.conditionId === 2)!;
      expect(bull.totalTrades + defense.totalTrades).toBe(global.totalTrades);
    });

    it('regime 라벨 fallback — entryRegime 없으면 effectiveRegime/rawRegime 재사용', () => {
      repo.saveAttributionRecords([
        { ...baseRec, schemaVersion: repo.CURRENT_ATTRIBUTION_SCHEMA_VERSION, tradeId: 'E1', returnPct: 4, conditionScores: { 2: 8 }, effectiveRegime: 'R3_EARLY' },
        { ...baseRec, schemaVersion: repo.CURRENT_ATTRIBUTION_SCHEMA_VERSION, tradeId: 'R1', returnPct: 9, conditionScores: { 2: 8 }, rawRegime: 'R3_EARLY' },
      ] as any);
      const early = repo.computeAttributionStats({ regime: 'R3_EARLY' }).find(s => s.conditionId === 2)!;
      expect(early.totalTrades).toBe(2);
    });

    it('미존재 regime 지정 → 빈 배열', () => {
      seedTwoRegimes();
      expect(repo.computeAttributionStats({ regime: 'R9_NONEXISTENT' })).toEqual([]);
    });
  });

  // ── gap (a) qtyRatio 누적 가드 ─────────────────────────────────────────────

  describe('gap (a) PARTIAL qtyRatio 누적 ≤1.0 가드', () => {
    it('누적 합 1.0 초과 시 잔여분만 clamp 기록', () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'P', returnPct: 0, conditionScores: { 1: 8 } }); // FULL_CLOSE baseline
      const f1 = repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f1', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 0.7, holdingDays: 1 });
      const f2 = repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f2', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 0.7, holdingDays: 1 });
      expect(f1?.qtyRatio).toBeCloseTo(0.7, 4);
      // 0.7 + 0.7 = 1.4 > 1.0 → 잔여 0.3 으로 clamp
      expect(f2?.qtyRatio).toBeCloseTo(0.3, 4);
    });

    it('이미 1.0 도달 시 추가 PARTIAL 은 skip(null)', () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'P', returnPct: 0, conditionScores: { 1: 8 } });
      repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f1', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 1.0, holdingDays: 1 });
      const f2 = repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f2', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 0.5, holdingDays: 1 });
      expect(f2).toBeNull();
    });

    it('정상 범위(합 ≤1.0) 는 clamp 없이 그대로 기록 (회귀 무영향)', () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'P', returnPct: 0, conditionScores: { 1: 8 } });
      const f1 = repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f1', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 0.3, holdingDays: 1 });
      const f2 = repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f2', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 0.4, holdingDays: 1 });
      expect(f1?.qtyRatio).toBeCloseTo(0.3, 4);
      expect(f2?.qtyRatio).toBeCloseTo(0.4, 4);
    });

    it('동일 fillId 재emit 은 dedup 대상 — 누적에 이중 산입하지 않음', () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'P', returnPct: 0, conditionScores: { 1: 8 } });
      repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f1', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 1, qtyRatio: 0.6, holdingDays: 1 });
      // 같은 fillId 재기록 — prior 합에서 자기 자신 제외되므로 0.6 그대로 가능.
      const again = repo.emitPartialAttribution({ tradeId: 'P', fillId: 'f1', stockCode: '005930', stockName: '삼성전자', closedAt: baseRec.closedAt, returnPct: 2, qtyRatio: 0.6, holdingDays: 1 });
      expect(again?.qtyRatio).toBeCloseTo(0.6, 4);
      const partials = repo.loadAttributionRecords().filter(r => r.attributionType === 'PARTIAL');
      expect(partials).toHaveLength(1); // dedup 보존
    });
  });

  // ── gap (a) counterfactual prefix 격리 ─────────────────────────────────────

  describe('gap (a) counterfactual prefix fallback 견고화', () => {
    async function evidenceFor(month: string) {
      const ledger = await import('./attributionEvidenceLedgerRepo.js');
      return ledger.loadAttributionEvidenceForMonth(month);
    }

    it('counterfactual: prefix → evidence source COUNTERFACTUAL (live 누수 없음)', async () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'counterfactual:abc', returnPct: 3, conditionScores: { 2: 8 } });
      const ev = await evidenceFor('2026-04');
      expect(ev.some(e => e.source === 'COUNTERFACTUAL')).toBe(true);
      expect(ev.some(e => e.source === 'LIVE')).toBe(false);
    });

    it('prefix 없어도 NOT_EXECUTED + live linkage 부재 → COUNTERFACTUAL 보강', async () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'plain-cf', returnPct: 2, conditionScores: { 2: 8 }, evidenceExecutionStatus: 'NOT_EXECUTED' });
      const ev = await evidenceFor('2026-04');
      expect(ev.some(e => e.source === 'COUNTERFACTUAL')).toBe(true);
      expect(ev.some(e => e.source === 'LIVE')).toBe(false);
    });

    it('signalId 존재 시(명시 live linkage) 과탐 방지 — COUNTERFACTUAL 보강 안 함', async () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'has-signal', returnPct: 2, conditionScores: { 2: 8 }, evidenceExecutionStatus: 'NOT_EXECUTED', signalId: 'SIG1' });
      const ev = await evidenceFor('2026-04');
      expect(ev.some(e => e.source === 'COUNTERFACTUAL')).toBe(false);
      expect(ev.some(e => e.source === 'LIVE')).toBe(false); // 여전히 LIVE 누수 없음
    });
  });

  // ── gap (d) stop/target round-trip ─────────────────────────────────────────

  describe('gap (d) stopPrice/targetPrice 옵셔널 보존', () => {
    it('emitFullCloseAttribution 없이 직접 append round-trip', () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'counterfactual:t', returnPct: 1, conditionScores: { 2: 8 }, stopPrice: 48000, targetPrice: 62000 });
      const rec = repo.loadAttributionRecords().find(r => r.tradeId === 'counterfactual:t')!;
      expect(rec.stopPrice).toBe(48000);
      expect(rec.targetPrice).toBe(62000);
    });

    it('stop/target 미지정 시 undefined (옵셔널, 스키마 무회귀)', () => {
      repo.appendAttributionRecord({ ...baseRec, tradeId: 'no-meta', returnPct: 1, conditionScores: { 2: 8 } });
      const rec = repo.loadAttributionRecords().find(r => r.tradeId === 'no-meta')!;
      expect(rec.stopPrice).toBeUndefined();
      expect(rec.targetPrice).toBeUndefined();
      expect(rec.schemaVersion).toBe(repo.CURRENT_ATTRIBUTION_SCHEMA_VERSION); // version bump 없음
    });
  });
});
