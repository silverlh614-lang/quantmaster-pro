/**
 * tradingOrchestrator.test.ts — preMarketOrderPrep 가드 계약 테스트.
 *
 * 이번 PR 에서 추가된 3가지 안전 가드의 회귀 방지:
 *  1. 포지션 Full 가드 — activeCount >= maxPositions 이면 전체 스킵
 *  2. Gap Probe SKIP_* — fetchKisPrevClose 실패 시 해당 종목만 continue
 *  3. 워치리스트 skipReason 기록 — 스킵된 종목의 lastSkipReason/lastSkipAt 갱신
 *
 * 외부 I/O (KIS / Telegram / Yahoo) 는 전부 mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('tradingOrchestrator — preMarketOrderPrep 가드', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    process.env.AUTO_TRADE_MODE = 'SHADOW'; // Telegram 알림만
    vi.resetModules();

    // Telegram · KIS · scanner · screener 등 외부 I/O 차단
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
      escapeHtml: (s: string) => s,
      answerCallbackQuery: vi.fn(),
      isDigestEnabled: () => false,
      setDigestEnabled: vi.fn(),
    }));
    vi.doMock('../clients/kisClient.js', () => ({
      BUY_TR_ID: 'VTTC0802U',
      refreshKisToken: vi.fn().mockResolvedValue('token'),
      kisPost: vi.fn().mockResolvedValue({ output: { odno: null } }),
      fetchAccountBalance: vi.fn().mockResolvedValue(10_000_000),
    }));
    vi.doMock('../trading/fillMonitor.js', () => ({
      fillMonitor: { addOrder: vi.fn(), pollFills: vi.fn(), autoCancelAtClose: vi.fn(), getPendingOrders: () => [] },
    }));
    vi.doMock('../trading/trancheExecutor.js', () => ({
      trancheExecutor: { checkPendingTranches: vi.fn().mockResolvedValue(undefined) },
    }));
    vi.doMock('../trading/signalScanner.js', () => ({
      runAutoSignalScan: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('../screener/stockScreener.js', () => ({
      preScreenStocks: vi.fn(),
      autoPopulateWatchlist: vi.fn().mockResolvedValue(0),
      sendWatchlistRejectionReport: vi.fn(),
    }));
    vi.doMock('../screener/watchlistManager.js', () => ({
      cleanupWatchlist: vi.fn(),
    }));
    vi.doMock('../alerts/reportGenerator.js', () => ({
      generateDailyReport: vi.fn(),
    }));
    vi.doMock('../learning/recommendationTracker.js', () => ({
      isRealTradeReady: () => false,
    }));
    vi.doMock('./adaptiveScanScheduler.js', () => ({
      decideScan: () => ({ shouldScan: false, intervalMinutes: 5, reason: '', priority: 'FULL' }),
      recordScanResult: vi.fn(),
    }));
    vi.doMock('./learningOrchestrator.js', () => ({
      learningOrchestrator: { runDailyEval: vi.fn(), runMonthlyEvolution: vi.fn() },
    }));
    vi.doMock('../learning/adaptiveLearningClock.js', () => ({
      shouldRunMonthlyEvolution: () => false,
      getLearningInterval: () => ({ mode: 'NORMAL', calibrateTriggerDays: 28, reason: '' }),
    }));
    vi.doMock('../screener/intradayScanner.js', () => ({
      scanAndUpdateIntradayWatchlist: vi.fn(),
    }));
    vi.doMock('../persistence/intradayWatchlistRepo.js', () => ({
      clearIntradayWatchlist: vi.fn(),
    }));
    vi.doMock('../trading/preMarketSmokeTest.js', () => ({
      runPreMarketSmokeTest: vi.fn(),
    }));

    // 레짐: maxPositions 작게 (테스트 편의)
    vi.doMock('../trading/regimeBridge.js', () => ({
      getLiveRegime: () => 'R2_BULL',
    }));
    vi.doMock('../../src/services/quant/regimeEngine.js', () => ({
      REGIME_CONFIGS: { R2_BULL: { maxPositions: 3 } },
    }));
    vi.doMock('../persistence/macroStateRepo.js', () => ({
      loadMacroState: () => null,
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.AUTO_TRADE_MODE;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('포지션 Full 가드 — activeCount >= maxPositions 이면 전체 스킵 (KIS 호출 없음)', async () => {
    // preMarketGapProbe 는 호출되지 않아야 한다 — spy 로 검증.
    const gapSpy = vi.fn().mockResolvedValue({ stockCode: '005930', prevClose: 70000, gapPct: 0, decision: 'PROCEED' });
    vi.doMock('../trading/preMarketGapProbe.js', () => ({
      probePreMarketGap: gapSpy,
    }));

    const watchlist = [
      { code: '005930', name: '삼성전자', entryPrice: 70000, stopLoss: 66000, targetPrice: 80000, addedAt: new Date().toISOString(), addedBy: 'AUTO' },
    ];
    const shadows = Array.from({ length: 3 }).map((_, i) => ({
      id: `t${i}`, stockCode: `00000${i}`, stockName: `T${i}`,
      signalTime: new Date().toISOString(), signalPrice: 100, shadowEntryPrice: 100,
      quantity: 1, stopLoss: 95, targetPrice: 110, status: 'ACTIVE',
    }));

    vi.doMock('../persistence/watchlistRepo.js', () => ({
      loadWatchlist: () => watchlist,
      saveWatchlist: vi.fn(),
    }));
    vi.doMock('../persistence/shadowTradeRepo.js', () => ({
      loadShadowTrades: () => shadows,
    }));
    vi.doMock('../trading/entryEngine.js', () => ({
      calculateOrderQuantity: () => ({ quantity: 0, effectiveBudget: 0 }),
      isOpenShadowStatus: (s: string) => ['PENDING', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'ACTIVE', 'EUPHORIA_PARTIAL'].includes(s),
    }));

    const { preMarketOrderPrep } = await import('./tradingOrchestrator.js');
    await preMarketOrderPrep();

    // gap probe 가 호출되지 않아야 함 (Full 가드에서 조기 리턴)
    expect(gapSpy).not.toHaveBeenCalled();
  });

  it('Gap Probe SKIP_NO_DATA — 해당 종목만 continue, 워치리스트 lastSkipReason 기록', async () => {
    const saveMock = vi.fn();
    const watchlist = [
      { code: '005930', name: '삼성전자', entryPrice: 70000, stopLoss: 66000, targetPrice: 80000, addedAt: new Date().toISOString(), addedBy: 'AUTO' },
    ];
    vi.doMock('../persistence/watchlistRepo.js', () => ({
      loadWatchlist: () => watchlist,
      saveWatchlist: saveMock,
    }));
    vi.doMock('../persistence/shadowTradeRepo.js', () => ({
      loadShadowTrades: () => [],
    }));
    vi.doMock('../trading/entryEngine.js', () => ({
      calculateOrderQuantity: () => ({ quantity: 10, effectiveBudget: 700_000 }),
      isOpenShadowStatus: () => false,
    }));
    vi.doMock('../trading/preMarketGapProbe.js', () => ({
      probePreMarketGap: vi.fn().mockResolvedValue({
        stockCode: '005930', prevClose: null, gapPct: null, decision: 'SKIP_NO_DATA', reason: 'KIS 실패',
      }),
    }));

    const { preMarketOrderPrep } = await import('./tradingOrchestrator.js');
    await preMarketOrderPrep();

    // saveWatchlist 가 lastSkipReason 로 호출되어야 함
    expect(saveMock).toHaveBeenCalled();
    const saved = saveMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(saved[0].lastSkipReason).toBe('SKIP_NO_DATA');
    expect(typeof saved[0].lastSkipAt).toBe('string');
  });

  it('Gap Probe PROCEED — Shadow 모드에서 정상 진행 (KIS 주문 없음)', async () => {
    const watchlist = [
      { code: '005930', name: '삼성전자', entryPrice: 70000, stopLoss: 66000, targetPrice: 80000, addedAt: new Date().toISOString(), addedBy: 'AUTO', gateScore: 7 },
    ];
    vi.doMock('../persistence/watchlistRepo.js', () => ({
      loadWatchlist: () => watchlist,
      saveWatchlist: vi.fn(),
    }));
    vi.doMock('../persistence/shadowTradeRepo.js', () => ({
      loadShadowTrades: () => [],
    }));
    vi.doMock('../trading/entryEngine.js', () => ({
      calculateOrderQuantity: () => ({ quantity: 10, effectiveBudget: 700_000 }),
      isOpenShadowStatus: () => false,
    }));
    const gapSpy = vi.fn().mockResolvedValue({
      stockCode: '005930', prevClose: 70000, gapPct: 0.5, decision: 'PROCEED',
    });
    vi.doMock('../trading/preMarketGapProbe.js', () => ({
      probePreMarketGap: gapSpy,
    }));

    const { preMarketOrderPrep } = await import('./tradingOrchestrator.js');
    await preMarketOrderPrep();

    expect(gapSpy).toHaveBeenCalledWith({ stockCode: '005930', entryPrice: 70000 });
  });
});
