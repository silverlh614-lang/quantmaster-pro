/**
 * @responsibility tradeSignalStatusRepo 회귀 테스트 — 6 상태머신 전이 + 영속·idempotent (ADR-0077)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('tradeSignalStatusRepo — TradeSignalStatus 상태머신', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-signal-status-test-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  // ─── canTransition 매트릭스 (8 케이스) ────────────────────────────────────

  describe('canTransition 매트릭스 SSOT', () => {
    it('null → AI_CANDIDATE 만 허용 (initial)', async () => {
      const { canTransition } = await import('./tradeSignalStatusRepo.js');
      expect(canTransition(null, 'AI_CANDIDATE')).toBe(true);
      expect(canTransition(null, 'DATA_VERIFIED')).toBe(false);
      expect(canTransition(null, 'BLOCKED')).toBe(false);
    });

    it('AI_CANDIDATE → DATA_VERIFIED | BLOCKED 만 허용', async () => {
      const { canTransition } = await import('./tradeSignalStatusRepo.js');
      expect(canTransition('AI_CANDIDATE', 'DATA_VERIFIED')).toBe(true);
      expect(canTransition('AI_CANDIDATE', 'BLOCKED')).toBe(true);
      expect(canTransition('AI_CANDIDATE', 'RISK_APPROVED')).toBe(false);
      expect(canTransition('AI_CANDIDATE', 'USER_APPROVED')).toBe(false);
      expect(canTransition('AI_CANDIDATE', 'AUTO_TRADE_READY')).toBe(false);
    });

    it('DATA_VERIFIED → RISK_APPROVED | BLOCKED 만 허용', async () => {
      const { canTransition } = await import('./tradeSignalStatusRepo.js');
      expect(canTransition('DATA_VERIFIED', 'RISK_APPROVED')).toBe(true);
      expect(canTransition('DATA_VERIFIED', 'BLOCKED')).toBe(true);
      expect(canTransition('DATA_VERIFIED', 'USER_APPROVED')).toBe(false);
      expect(canTransition('DATA_VERIFIED', 'AUTO_TRADE_READY')).toBe(false);
    });

    it('RISK_APPROVED → USER_APPROVED | AUTO_TRADE_READY (SHADOW 직접) | BLOCKED', async () => {
      const { canTransition } = await import('./tradeSignalStatusRepo.js');
      expect(canTransition('RISK_APPROVED', 'USER_APPROVED')).toBe(true);
      expect(canTransition('RISK_APPROVED', 'AUTO_TRADE_READY')).toBe(true);
      expect(canTransition('RISK_APPROVED', 'BLOCKED')).toBe(true);
      expect(canTransition('RISK_APPROVED', 'DATA_VERIFIED')).toBe(false);
    });

    it('USER_APPROVED → AUTO_TRADE_READY | BLOCKED 만 허용', async () => {
      const { canTransition } = await import('./tradeSignalStatusRepo.js');
      expect(canTransition('USER_APPROVED', 'AUTO_TRADE_READY')).toBe(true);
      expect(canTransition('USER_APPROVED', 'BLOCKED')).toBe(true);
      expect(canTransition('USER_APPROVED', 'DATA_VERIFIED')).toBe(false);
    });

    it('AUTO_TRADE_READY 는 terminal — 모든 전이 false', async () => {
      const { canTransition, ALL_TRADE_SIGNAL_STATUSES } = await import('./tradeSignalStatusRepo.js');
      for (const to of ALL_TRADE_SIGNAL_STATUSES) {
        expect(canTransition('AUTO_TRADE_READY', to)).toBe(false);
      }
    });

    it('BLOCKED 는 terminal — 모든 전이 false', async () => {
      const { canTransition, ALL_TRADE_SIGNAL_STATUSES } = await import('./tradeSignalStatusRepo.js');
      for (const to of ALL_TRADE_SIGNAL_STATUSES) {
        expect(canTransition('BLOCKED', to)).toBe(false);
      }
    });

    it('BlockGate 13 분류 SSOT 정합', async () => {
      const { ALL_BLOCK_GATES } = await import('./tradeSignalStatusRepo.js');
      expect(ALL_BLOCK_GATES).toHaveLength(13);
      expect(ALL_BLOCK_GATES).toContain('DATA');
      expect(ALL_BLOCK_GATES).toContain('USER_REJECT');
      expect(ALL_BLOCK_GATES).toContain('EMERGENCY_STOP');
    });
  });

  // ─── buildSignalId (2 케이스) ─────────────────────────────────────────────

  describe('buildSignalId', () => {
    it('signalTimeIso:stockCode 형식', async () => {
      const { buildSignalId } = await import('./tradeSignalStatusRepo.js');
      expect(buildSignalId('2026-04-27T05:00:00Z', '005930')).toBe('2026-04-27T05:00:00Z:005930');
    });

    it('빈 stockCode 도 string concat (검증은 호출자 책임)', async () => {
      const { buildSignalId } = await import('./tradeSignalStatusRepo.js');
      expect(buildSignalId('2026-04-27T05:00:00Z', '')).toBe('2026-04-27T05:00:00Z:');
    });
  });

  // ─── 영속 round-trip (3 케이스) ───────────────────────────────────────────

  describe('영속 round-trip', () => {
    it('빈 파일 → 빈 배열', async () => {
      const { loadTradeSignalRecords } = await import('./tradeSignalStatusRepo.js');
      expect(loadTradeSignalRecords()).toEqual([]);
    });

    it('recordAiCandidate 후 디스크 직렬화 round-trip', async () => {
      const { recordAiCandidate, loadTradeSignalRecords } = await import('./tradeSignalStatusRepo.js');
      const created = recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '삼성전자',
        recommendationType: 'STRONG_BUY',
        signalGateScore: 12,
      });
      expect(created).not.toBeNull();
      const loaded = loadTradeSignalRecords();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('2026-04-27T05:00:00Z:005930');
      expect(loaded[0].status).toBe('AI_CANDIDATE');
      expect(loaded[0].signalGateScore).toBe(12);
      expect(loaded[0].schemaVersion).toBe(1);
    });

    it('손상 JSON → 빈 배열 fallback (console.warn)', async () => {
      const { TRADE_SIGNAL_STATUS_FILE } = await import('./paths.js');
      const dir = path.dirname(TRADE_SIGNAL_STATUS_FILE);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TRADE_SIGNAL_STATUS_FILE, '{ corrupted JSON without closing');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { loadTradeSignalRecords } = await import('./tradeSignalStatusRepo.js');
      expect(loadTradeSignalRecords()).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ─── recordAiCandidate (4 케이스) ─────────────────────────────────────────

  describe('recordAiCandidate', () => {
    it('첫 진입 — AI_CANDIDATE record + transitions[0]={null→AI_CANDIDATE}', async () => {
      const { recordAiCandidate } = await import('./tradeSignalStatusRepo.js');
      const r = recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '삼성전자',
        recommendationType: 'BUY',
      });
      expect(r?.transitions).toHaveLength(1);
      expect(r?.transitions[0]).toMatchObject({
        from: null,
        to: 'AI_CANDIDATE',
        reason: 'AI 추천 후보 발생',
      });
      expect(r?.createdAt).toBeTruthy();
    });

    it('동일 id 두 번 호출 — idempotent (transitions 그대로)', async () => {
      const { recordAiCandidate, loadTradeSignalRecords } = await import('./tradeSignalStatusRepo.js');
      recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '삼성전자',
        recommendationType: 'BUY',
      });
      const second = recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '다른이름',
        recommendationType: 'STRONG_BUY',
      });
      expect(second?.stockName).toBe('삼성전자'); // 첫 record 보존
      expect(loadTradeSignalRecords()).toHaveLength(1);
    });

    it('빈 stockCode → null + 영속 변경 없음', async () => {
      const { recordAiCandidate, loadTradeSignalRecords } = await import('./tradeSignalStatusRepo.js');
      const r = recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '',
        stockName: '?',
        recommendationType: 'BUY',
      });
      expect(r).toBeNull();
      expect(loadTradeSignalRecords()).toHaveLength(0);
    });

    it('잘못된 recommendationType → null', async () => {
      const { recordAiCandidate } = await import('./tradeSignalStatusRepo.js');
      const r = recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '삼성전자',
        recommendationType: 'INVALID' as unknown as 'BUY',
      });
      expect(r).toBeNull();
    });
  });

  // ─── 정상 전이 시퀀스 (6 케이스) ──────────────────────────────────────────

  describe('정상 전이 시퀀스', () => {
    async function setupCandidate(): Promise<string> {
      const { recordAiCandidate, buildSignalId } = await import('./tradeSignalStatusRepo.js');
      recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '삼성전자',
        recommendationType: 'STRONG_BUY',
      });
      return buildSignalId('2026-04-27T05:00:00Z', '005930');
    }

    it('AI_CANDIDATE → DATA_VERIFIED 전이 (transitions 누적)', async () => {
      const id = await setupCandidate();
      const { markDataVerified } = await import('./tradeSignalStatusRepo.js');
      const r = markDataVerified({ id, reason: 'Gate 통과 (Score 12)' });
      expect(r?.status).toBe('DATA_VERIFIED');
      expect(r?.transitions).toHaveLength(2);
      expect(r?.transitions[1]).toMatchObject({
        from: 'AI_CANDIDATE',
        to: 'DATA_VERIFIED',
        reason: 'Gate 통과 (Score 12)',
      });
    });

    it('DATA_VERIFIED → RISK_APPROVED → USER_APPROVED → AUTO_TRADE_READY 전체 사이클', async () => {
      const id = await setupCandidate();
      const { markDataVerified, markRiskApproved, markUserApproved, markAutoTradeReady } =
        await import('./tradeSignalStatusRepo.js');
      markDataVerified({ id });
      markRiskApproved({ id, reason: 'Kelly 0.75' });
      markUserApproved({ id, approvedBy: 'telegram' });
      const r = markAutoTradeReady({ id });
      expect(r?.status).toBe('AUTO_TRADE_READY');
      expect(r?.transitions).toHaveLength(5); // null→AI, AI→DATA, DATA→RISK, RISK→USER, USER→AUTO
      expect(r?.finalizedAt).toBeTruthy();
    });

    it('SHADOW 직접 전이 — RISK_APPROVED → AUTO_TRADE_READY', async () => {
      const id = await setupCandidate();
      const { markDataVerified, markRiskApproved, markAutoTradeReady } =
        await import('./tradeSignalStatusRepo.js');
      markDataVerified({ id });
      markRiskApproved({ id });
      const r = markAutoTradeReady({ id, reason: 'SHADOW 자동 진입' });
      expect(r?.status).toBe('AUTO_TRADE_READY');
      expect(r?.transitions[r.transitions.length - 1]).toMatchObject({
        from: 'RISK_APPROVED',
        to: 'AUTO_TRADE_READY',
      });
    });

    it('미등록 id 전이 시도 → null 반환', async () => {
      const { markDataVerified } = await import('./tradeSignalStatusRepo.js');
      expect(markDataVerified({ id: 'nonexistent:id' })).toBeNull();
    });

    it('canTransition false (skip) — DATA_VERIFIED 상태에서 USER_APPROVED 호출 시 silent skip', async () => {
      const id = await setupCandidate();
      const { markDataVerified, markUserApproved } = await import('./tradeSignalStatusRepo.js');
      markDataVerified({ id });
      const r = markUserApproved({ id });
      // canTransition false → silent skip, current record 그대로 반환
      expect(r?.status).toBe('DATA_VERIFIED');
      expect(r?.transitions).toHaveLength(2); // 추가 전이 없음
    });

    it('동일 status 재전이 시도 → idempotent silent skip', async () => {
      const id = await setupCandidate();
      const { markDataVerified } = await import('./tradeSignalStatusRepo.js');
      markDataVerified({ id });
      const r = markDataVerified({ id });
      expect(r?.status).toBe('DATA_VERIFIED');
      expect(r?.transitions).toHaveLength(2); // null→AI, AI→DATA only
    });
  });

  // ─── markBlocked 분기 (3 케이스) ──────────────────────────────────────────

  describe('markBlocked', () => {
    async function setupCandidate(): Promise<string> {
      const { recordAiCandidate, buildSignalId } = await import('./tradeSignalStatusRepo.js');
      recordAiCandidate({
        signalTimeIso: '2026-04-27T05:00:00Z',
        stockCode: '005930',
        stockName: '삼성전자',
        recommendationType: 'BUY',
      });
      return buildSignalId('2026-04-27T05:00:00Z', '005930');
    }

    it('정상 BLOCK — blockGate + blockReason + finalizedAt 설정', async () => {
      const id = await setupCandidate();
      const { markBlocked } = await import('./tradeSignalStatusRepo.js');
      const r = markBlocked({ id, gate: 'SECTOR', reason: '배터리 32% 초과' });
      expect(r?.status).toBe('BLOCKED');
      expect(r?.blockGate).toBe('SECTOR');
      expect(r?.blockReason).toBe('배터리 32% 초과');
      expect(r?.finalizedAt).toBeTruthy();
    });

    it('미등록 BlockGate → null, 영속 변경 없음', async () => {
      const id = await setupCandidate();
      const { markBlocked, getTradeSignalRecord } = await import('./tradeSignalStatusRepo.js');
      const r = markBlocked({ id, gate: 'INVALID_GATE' as unknown as 'OTHER', reason: '?' });
      expect(r).toBeNull();
      const rec = getTradeSignalRecord(id);
      expect(rec?.status).toBe('AI_CANDIDATE'); // 그대로
    });

    it('AUTO_TRADE_READY 도달 후 BLOCK 시도 → silent skip (terminal)', async () => {
      const id = await setupCandidate();
      const { markDataVerified, markRiskApproved, markAutoTradeReady, markBlocked } =
        await import('./tradeSignalStatusRepo.js');
      markDataVerified({ id });
      markRiskApproved({ id });
      markAutoTradeReady({ id });
      const r = markBlocked({ id, gate: 'OTHER', reason: '뒤늦은 차단' });
      expect(r?.status).toBe('AUTO_TRADE_READY'); // 변경 없음
      expect(r?.blockGate).toBeUndefined();
    });
  });

  // ─── FIFO trim (1 케이스) ─────────────────────────────────────────────────

  describe('FIFO trim', () => {
    it('1001 건 추가 시 최근 1000 보존 (createdAt 내림차순)', async () => {
      const { recordAiCandidate, loadTradeSignalRecords, TRADE_SIGNAL_STATUS_MAX } =
        await import('./tradeSignalStatusRepo.js');
      const baseTs = Date.parse('2026-04-27T05:00:00Z');
      for (let i = 0; i < TRADE_SIGNAL_STATUS_MAX + 1; i++) {
        const iso = new Date(baseTs + i * 1000).toISOString();
        recordAiCandidate({
          signalTimeIso: iso,
          stockCode: String(100000 + i),
          stockName: `종목${i}`,
          recommendationType: 'BUY',
          now: new Date(baseTs + i * 1000),
        });
      }
      const all = loadTradeSignalRecords();
      expect(all).toHaveLength(TRADE_SIGNAL_STATUS_MAX);
      // 가장 오래된 (i=0) 가 trim 됨
      const codes = new Set(all.map(r => r.stockCode));
      expect(codes.has('100000')).toBe(false);
      expect(codes.has('101000')).toBe(true); // 마지막 (i=1000)
    });
  });

  // ─── 진단 read API (2 케이스) ─────────────────────────────────────────────

  describe('getRecentTradeSignalRecords / getTradeSignalRecord', () => {
    it('limit 적용 + createdAt 내림차순', async () => {
      const { recordAiCandidate, getRecentTradeSignalRecords } =
        await import('./tradeSignalStatusRepo.js');
      const baseTs = Date.parse('2026-04-27T05:00:00Z');
      for (let i = 0; i < 5; i++) {
        recordAiCandidate({
          signalTimeIso: new Date(baseTs + i * 1000).toISOString(),
          stockCode: String(100000 + i),
          stockName: `종목${i}`,
          recommendationType: 'BUY',
          now: new Date(baseTs + i * 1000),
        });
      }
      const recent = getRecentTradeSignalRecords(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].stockCode).toBe('100004'); // 가장 최근
      expect(recent[2].stockCode).toBe('100002');
    });

    it('limit ≤ 0 → 빈 배열', async () => {
      const { getRecentTradeSignalRecords } = await import('./tradeSignalStatusRepo.js');
      expect(getRecentTradeSignalRecords(0)).toEqual([]);
      expect(getRecentTradeSignalRecords(-5)).toEqual([]);
    });
  });
});
