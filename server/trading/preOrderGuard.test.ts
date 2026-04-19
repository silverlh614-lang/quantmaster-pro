/**
 * preOrderGuard.test.ts — Phase 2차 C3 회귀 테스트
 *
 * 가드가 3가지 위험 입력에 대해 반드시 throw 하고, 정상 입력은 통과시키는
 * 계약을 고정한다. 사이드이펙트(state 변화, 파일 쓰기)는 mock 으로 격리.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('preOrderGuard — Automated Kill Switch', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // 외부 I/O 차단 — 텔레그램 실제 발송/KIS API 콜 방지
    vi.resetModules();
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../emergency.js', () => ({
      cancelAllPendingOrders: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../alerts/contaminationBlastRadius.js', () => ({
      sendBlastRadiusReport: vi.fn().mockResolvedValue(true),
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../alerts/telegramClient.js');
    vi.doUnmock('../emergency.js');
    vi.doUnmock('../alerts/contaminationBlastRadius.js');
  });

  it('정상 주문 — throw 하지 않음', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    })).not.toThrow();
  });

  it('POSITION_EXPLOSION — 주문가치 > 총자산×1.5 시 throw + incident 기록', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 1000, entryPrice: 200_000, stopLoss: 190_000,  // 2억
      totalAssets: 100_000_000,  // 1억 → ×1.5 = 1.5억 < 2억
    })).toThrow(PreOrderGuardError);

    // incident log 에 기록됐는지
    const incidentFile = path.join(tmpDir, 'incident-log.json');
    expect(fs.existsSync(incidentFile)).toBe(true);
    const entries = JSON.parse(fs.readFileSync(incidentFile, 'utf-8'));
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toContain('주문가치');
    expect(entries[0].context.reason).toBe('POSITION_EXPLOSION');
  });

  it('STOPLOSS_LOGIC_BROKEN — stopLoss >= entryPrice 시 throw', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 70000,  // equal → BROKEN
      totalAssets: 100_000_000,
    })).toThrow(PreOrderGuardError);
  });

  it('ORDER_LOOP_SUSPECT — 동일 종목 3회 주문 시 3번째에서 throw', async () => {
    const { assertSafeOrder, PreOrderGuardError, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    const base = {
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10, entryPrice: 70000, stopLoss: 66000,
      totalAssets: 100_000_000,
    };
    expect(() => assertSafeOrder(base)).not.toThrow();
    expect(() => assertSafeOrder(base)).not.toThrow();
    expect(() => assertSafeOrder(base)).toThrow(PreOrderGuardError);
  });

  it('totalAssets 미상(null) → 팽창 검사 건너뜀', async () => {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders();
    expect(() => assertSafeOrder({
      stockCode: '005930', stockName: '삼성전자',
      quantity: 10_000, entryPrice: 200_000, stopLoss: 190_000,  // 20억
      totalAssets: null,  // 미상 → 검사 skip
    })).not.toThrow();
  });
});
