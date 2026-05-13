/**
 * shadowExecutionPipelinePatch001.test.ts — Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001
 *
 * 사용자 명시 11 핵심 시나리오 (Test 1-11) + 안전 invariant 정적 grep 가드.
 *
 * 절대 불변식:
 *   - LIVE 매매 본체 0줄 변경 (KIS 주문 함수 5종 import 0건)
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - 외부 API (fetch / axios / node-fetch) 호출 0건
 *   - executionImpact: 'NONE' literal 강제
 *   - liveOrderPlaced: false literal 강제
 *   - SSOT (appendFill / saveShadowTrades) 위임 의무
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 *   - 호출자 측 inline ENV 검사 0건
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Test isolation ────────────────────────────────────────────────────────────

describe('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — executeShadowBuy SSOT', () => {
  let tmpDir: string;
  let pipeline: typeof import('./shadowExecutionPipeline.js');
  let repo: typeof import('../persistence/shadowTradeRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-exec-pipeline-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    vi.resetModules();
    pipeline = await import('./shadowExecutionPipeline.js');
    repo = await import('../persistence/shadowTradeRepo.js');
    pipeline.__resetShadowExecutionPipelineSummaryForTests();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  function makeTrade(
    overrides: Partial<import('../persistence/shadowTradeRepo.js').ServerShadowTrade> = {},
  ): import('../persistence/shadowTradeRepo.js').ServerShadowTrade {
    return {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      stockCode: '452280',
      stockName: '한선엔지니어링',
      signalTime: new Date().toISOString(),
      signalPrice: 10000,
      shadowEntryPrice: 10000,
      quantity: 5,
      originalQuantity: 5,
      stopLoss: 9300,
      targetPrice: 11500,
      status: 'PENDING',
      mode: 'SHADOW',
      ...overrides,
    } as import('../persistence/shadowTradeRepo.js').ServerShadowTrade;
  }

  // ─── Test 1: 정상 paper-fill ───────────────────────────────────────────────
  it('Test 1: 정상 SHADOW 승인 → executeShadowBuy → status=ACTIVE + INITIAL_BUY fill 영속', async () => {
    const trade = makeTrade();
    const allTrades = [trade];

    const result = await pipeline.executeShadowBuy({ trade, allTrades });

    expect(result.outcome).toBe('EXECUTED');
    expect(result.statusAfter).toBe('ACTIVE');
    expect(result.fillPrice).toBe(10000);
    expect(result.fillId).toBeTruthy();
    // 영속 invariant
    expect(result.liveOrderPlaced).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    // trade 자체에도 반영
    expect(trade.status).toBe('ACTIVE');
    expect(trade.fills).toHaveLength(1);
    expect(trade.fills?.[0].type).toBe('BUY');
    expect(trade.fills?.[0].subType).toBe('INITIAL_BUY');
    expect(trade.fills?.[0].qty).toBe(5);
    expect(trade.fills?.[0].price).toBe(10000);
    expect(trade.fills?.[0].status).toBe('CONFIRMED');
    // 디스크 영속 — repo.loadShadowTrades 로 다시 읽어 검증
    const loaded = repo.loadShadowTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(trade.id);
    expect(loaded[0].status).toBe('ACTIVE');
    expect(loaded[0].fills).toHaveLength(1);
  });

  // ─── Test 2: 멱등 — 동일 trade 두 번 호출 시 ALREADY_FILLED ─────────────
  it('Test 2: 멱등 — 동일 trade 두 번 executeShadowBuy 호출 시 ALREADY_FILLED, 영속 1회만', async () => {
    const trade = makeTrade();
    const allTrades = [trade];

    const r1 = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r1.outcome).toBe('EXECUTED');
    expect(trade.fills).toHaveLength(1);

    const r2 = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r2.outcome).toBe('ALREADY_FILLED');
    expect(r2.statusAfter).toBe('ACTIVE');
    // 영속 변화 없음
    expect(trade.fills).toHaveLength(1);
    const loaded = repo.loadShadowTrades();
    expect(loaded[0].fills).toHaveLength(1);
  });

  // ─── Test 3: ENV DISABLED ───────────────────────────────────────────────
  it('Test 3: ENV SHADOW_EXECUTION_PIPELINE_DISABLED=true → ENV_DISABLED skip + 영속 0', async () => {
    process.env.SHADOW_EXECUTION_PIPELINE_DISABLED = 'true';
    const trade = makeTrade();
    const allTrades = [trade];

    const r = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r.outcome).toBe('ENV_DISABLED');
    expect(r.liveOrderPlaced).toBe(false);
    expect(r.executionImpact).toBe('NONE');
    // status / fills 변경 없음
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
  });

  // ─── Test 4: LIVE 모드 차단 ────────────────────────────────────────────
  it('Test 4: trade.mode=LIVE → NOT_SHADOW skip (LIVE path 영향 0)', async () => {
    const trade = makeTrade({ mode: 'LIVE' });
    const allTrades = [trade];

    const r = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r.outcome).toBe('NOT_SHADOW');
    expect(r.liveOrderPlaced).toBe(false);
    expect(r.executionImpact).toBe('NONE');
    // LIVE trade 의 status 무수정
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
  });

  // ─── Test 5: status 가 이미 ACTIVE → 멱등 skip ──────────────────────────
  it('Test 5: trade.status=ACTIVE 이미 fill 처리됨 → ALREADY_FILLED 멱등 skip', async () => {
    const trade = makeTrade({ status: 'ACTIVE' });
    const allTrades = [trade];

    const r = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r.outcome).toBe('ALREADY_FILLED');
    expect(r.statusAfter).toBe('ACTIVE');
    expect(trade.fills ?? []).toHaveLength(0); // 강제 fill 추가 0
  });

  // ─── Test 6: 입력 검증 — shadowEntryPrice ≤ 0 ─────────────────────────
  it('Test 6: shadowEntryPrice=0 → INVALID_INPUT skip + 영속 0', async () => {
    const trade = makeTrade({ shadowEntryPrice: 0, signalPrice: 0 });
    const allTrades = [trade];

    const r = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r.outcome).toBe('INVALID_INPUT');
    expect(trade.status).toBe('PENDING');
    expect(trade.fills ?? []).toHaveLength(0);
  });

  // ─── Test 7: fillPrice 명시 시 그 값 사용, 미명시 시 shadowEntryPrice ────
  it('Test 7: fillPrice 명시 시 그 값으로 paper-fill (currentPrice override)', async () => {
    const trade = makeTrade({ shadowEntryPrice: 10000 });
    const allTrades = [trade];

    const r = await pipeline.executeShadowBuy({
      trade,
      allTrades,
      fillPrice: 10250, // approval 시점 가격이 더 높았다
    });
    expect(r.outcome).toBe('EXECUTED');
    expect(r.fillPrice).toBe(10250);
    expect(trade.fills?.[0].price).toBe(10250);
  });

  // ─── Test 8: 영속 후 다시 load → 멱등 검증 ────────────────────────────
  it('Test 8: 영속 후 다시 load → BUY fill 존재 인식 → 두 번째 호출 ALREADY_FILLED', async () => {
    const trade = makeTrade();
    const allTrades = [trade];

    const r1 = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r1.outcome).toBe('EXECUTED');

    // 영속 후 다시 load — 새 인스턴스
    const reloaded = repo.loadShadowTrades();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].fills?.some((f) => f.type === 'BUY')).toBe(true);

    // 두 번째 호출 (mock cron 재시작 시뮬)
    const r2 = await pipeline.executeShadowBuy({
      trade: reloaded[0],
      allTrades: reloaded,
    });
    expect(r2.outcome).toBe('ALREADY_FILLED');
  });

  // ─── Test 9: notifyFilled 콜백 호출 + invariant 전달 ───────────────────
  it('Test 9: notifyFilled 콜백 호출 — mode=SHADOW + liveOrderPlaced=false invariant 전달', async () => {
    const trade = makeTrade();
    const allTrades = [trade];
    const notifyFilled = vi.fn().mockResolvedValue(undefined);

    const r = await pipeline.executeShadowBuy({
      trade,
      allTrades,
      notifyFilled,
    });
    expect(r.outcome).toBe('EXECUTED');
    expect(notifyFilled).toHaveBeenCalledTimes(1);
    const arg = notifyFilled.mock.calls[0][0];
    expect(arg.mode).toBe('SHADOW');
    expect(arg.liveOrderPlaced).toBe(false);
    expect(arg.stockCode).toBe('452280');
    expect(arg.fillPrice).toBe(10000);
    expect(arg.quantity).toBe(5);
    expect(arg.fillId).toBeTruthy();
    expect(arg.tradeId).toBe(trade.id);
  });

  // ─── Test 10: notifyFilled throw 시 영속은 그대로 (영속 우선) ───────────
  it('Test 10: notifyFilled throw 시 영속 보존 + 결과는 EXECUTED', async () => {
    const trade = makeTrade();
    const allTrades = [trade];
    const notifyFilled = vi.fn().mockRejectedValue(new Error('telegram down'));

    const r = await pipeline.executeShadowBuy({
      trade,
      allTrades,
      notifyFilled,
    });
    // 영속은 이미 완료 — Telegram 실패가 영속 롤백 유발 금지
    expect(r.outcome).toBe('EXECUTED');
    expect(trade.status).toBe('ACTIVE');
    expect(trade.fills).toHaveLength(1);
    const loaded = repo.loadShadowTrades();
    expect(loaded[0].status).toBe('ACTIVE');
  });

  // ─── Test 11: REJECTED 종결 상태 → STATE_TERMINAL ──────────────────────
  it('Test 11: trade.status=REJECTED → STATE_TERMINAL skip', async () => {
    const trade = makeTrade({ status: 'REJECTED' });
    const allTrades = [trade];

    const r = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r.outcome).toBe('STATE_TERMINAL');
    expect(r.statusAfter).toBe('REJECTED');
    expect(trade.fills ?? []).toHaveLength(0);
  });
});

// ─── ENV gate 정확 비교 (ADR-0157) ────────────────────────────────────────────

describe('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — ENV gate 정확 비교 (ADR-0157)', () => {
  let pipeline: typeof import('./shadowExecutionPipeline.js');

  beforeEach(async () => {
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    vi.resetModules();
    pipeline = await import('./shadowExecutionPipeline.js');
  });

  afterEach(() => {
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
  });

  it('default 미설정 → false (활성)', () => {
    expect(pipeline.isShadowExecutionPipelineDisabled()).toBe(false);
  });

  it('=true 정확 비교 → true (비활성)', () => {
    process.env.SHADOW_EXECUTION_PIPELINE_DISABLED = 'true';
    expect(pipeline.isShadowExecutionPipelineDisabled()).toBe(true);
  });

  it('"1" / "TRUE" / "yes" / "" 모두 거부 → false (활성 유지)', () => {
    for (const v of ['1', 'TRUE', 'yes', '', 'True', 'on']) {
      process.env.SHADOW_EXECUTION_PIPELINE_DISABLED = v;
      expect(pipeline.isShadowExecutionPipelineDisabled()).toBe(false);
    }
  });

  it('=false 명시 → false (활성)', () => {
    process.env.SHADOW_EXECUTION_PIPELINE_DISABLED = 'false';
    expect(pipeline.isShadowExecutionPipelineDisabled()).toBe(false);
  });
});

// ─── Summary tracking ─────────────────────────────────────────────────────────

describe('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — summary tracking', () => {
  let tmpDir: string;
  let pipeline: typeof import('./shadowExecutionPipeline.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-exec-summary-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    vi.resetModules();
    pipeline = await import('./shadowExecutionPipeline.js');
    pipeline.__resetShadowExecutionPipelineSummaryForTests();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('recordShadowExecutionOutcome accumulates per outcome', () => {
    pipeline.recordShadowExecutionOutcome('EXECUTED');
    pipeline.recordShadowExecutionOutcome('EXECUTED');
    pipeline.recordShadowExecutionOutcome('ALREADY_FILLED');
    pipeline.recordShadowExecutionOutcome('INVALID_INPUT');
    const s = pipeline.getShadowExecutionPipelineSummary();
    expect(s.total).toBe(4);
    expect(s.executed).toBe(2);
    expect(s.alreadyFilled).toBe(1);
    expect(s.invalid).toBe(1);
    expect(s.executionImpact).toBe('NONE');
  });

  it('formatShadowExecutionPipelineSection — total=0 시 null 반환 (잡음 차단)', () => {
    expect(pipeline.formatShadowExecutionPipelineSection()).toBeNull();
  });

  it('formatShadowExecutionPipelineSection — [PATCH-RUNTIME] 태그 + executionImpact=NONE 항상 노출', () => {
    pipeline.recordShadowExecutionOutcome('EXECUTED');
    pipeline.recordShadowExecutionOutcome('ALREADY_FILLED');
    const out = pipeline.formatShadowExecutionPipelineSection()!;
    expect(out).toContain('[PATCH-RUNTIME]');
    expect(out).toContain('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001');
    expect(out).toContain('executionImpact=NONE');
    expect(out).toContain('liveOrderPlaced=false');
    expect(out).toContain('executed=1');
    expect(out).toContain('alreadyFilled=1');
  });

  it('formatShadowExecutionPipelineSection — 비정상 결과 카운트도 표시', () => {
    pipeline.recordShadowExecutionOutcome('EXECUTED');
    pipeline.recordShadowExecutionOutcome('PERSIST_FAILED');
    pipeline.recordShadowExecutionOutcome('INVALID_INPUT');
    const out = pipeline.formatShadowExecutionPipelineSection()!;
    expect(out).toContain('persistFailed=1');
    expect(out).toContain('invalid=1');
  });
});

// ─── 정적 grep 안전 invariants ────────────────────────────────────────────────

describe('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — 안전 invariant 정적 grep 가드', () => {
  function readSrc(rel: string): string {
    const p = path.resolve(import.meta.dirname, rel);
    return fs.readFileSync(p, 'utf-8');
  }

  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
  }

  it('SSOT 모듈 자체에 KIS 주문 함수 5종 import 0건', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
  });

  it('SSOT 모듈 자체에 autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).not.toMatch(/from ['"][^'"]*autoTradeEngine/);
    expect(src).not.toMatch(/from ['"][^'"]*orderExecutor/);
    expect(src).not.toMatch(/from ['"][^'"]*trancheExecutor/);
  });

  it('SSOT 모듈 자체에 외부 fetch / axios / node-fetch import 0건', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).not.toMatch(/from ['"]axios['"]/);
    expect(src).not.toMatch(/from ['"]node-fetch['"]/);
    expect(src).not.toMatch(/^[ \t]*fetch\(/m);
  });

  it('ENV 정확 비교 (ADR-0157) — `=== \'true\'` 패턴만 사용', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).toMatch(/=== 'true'/);
    // 잘못된 헐거운 비교 차단
    expect(src).not.toMatch(/!== 'false'/);
    expect(src).not.toMatch(/Boolean\(process\.env\.SHADOW_EXECUTION_PIPELINE_DISABLED\)/);
  });

  it('SSOT 모듈에 literal type 강제 (executionImpact: \'NONE\' / liveOrderPlaced: false)', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).toMatch(/executionImpact: 'NONE'/);
    expect(src).toMatch(/liveOrderPlaced: false/);
  });

  it('Gate threshold / GATE_RELAX / STRONG_BUY_OVERRIDE 0건 (사용자 명시 절대 변경 금지)', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).not.toMatch(/setGateThreshold/);
    expect(src).not.toMatch(/GATE_RELAX/);
    expect(src).not.toMatch(/STRONG_BUY_OVERRIDE/);
    expect(src).not.toMatch(/requiredScore\s*=/);
  });

  it('appendFill / saveShadowTrades / appendShadowLog SSOT 위임 의무 (drift 차단)', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).toMatch(/import\s*\{[^}]*appendFill[^}]*\}\s*from ['"][^'"]*shadowTradeRepo[^'"]*['"]/);
    expect(src).toMatch(/import\s*\{[^}]*saveShadowTrades[^}]*\}\s*from ['"][^'"]*shadowTradeRepo[^'"]*['"]/);
    expect(src).toMatch(/import\s*\{[^}]*appendShadowLog[^}]*\}\s*from ['"][^'"]*shadowTradeRepo[^'"]*['"]/);
  });

  it('LIVE 매매 본체 0줄 변경 — placeKisMarketBuyOrder / fillMonitor 호출 절대 금지', () => {
    const src = stripComments(readSrc('./shadowExecutionPipeline.ts'));
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/fillMonitor\./);
    expect(src).not.toMatch(/from ['"][^'"]*fillMonitor/);
  });

  it('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 추적 주석 명시', () => {
    const src = readSrc('./shadowExecutionPipeline.ts');
    expect(src).toMatch(/Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001/);
  });
});

// ─── 사용자 보고 시나리오 통합 검증 ──────────────────────────────────────────

describe('Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — 사용자 5/13 보고 시나리오', () => {
  let tmpDir: string;
  let pipeline: typeof import('./shadowExecutionPipeline.js');
  let repo: typeof import('../persistence/shadowTradeRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-exec-scenario-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    vi.resetModules();
    pipeline = await import('./shadowExecutionPipeline.js');
    repo = await import('../persistence/shadowTradeRepo.js');
    pipeline.__resetShadowExecutionPipelineSummaryForTests();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.SHADOW_EXECUTION_PIPELINE_DISABLED;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('한선엔지니어링 13:13/13:15/13:18 동일 종목 재승인 — 첫 호출 EXECUTED, 후속 ALL ALREADY_FILLED', async () => {
    // 13:13 첫 승인
    const trade = {
      id: 'live_1736742780000_452280',
      stockCode: '452280',
      stockName: '한선엔지니어링',
      signalTime: '2026-05-13T13:13:00+09:00',
      signalPrice: 10000,
      shadowEntryPrice: 10000,
      quantity: 5,
      originalQuantity: 5,
      stopLoss: 9300,
      targetPrice: 11500,
      status: 'PENDING' as const,
      mode: 'SHADOW' as const,
    };
    const allTrades = [trade];
    const r1 = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r1.outcome).toBe('EXECUTED');

    // 13:15 — 다음 cron 사이클, 메모리에서 같은 trade reference 유지된 경우
    const r2 = await pipeline.executeShadowBuy({ trade, allTrades });
    expect(r2.outcome).toBe('ALREADY_FILLED');

    // 13:18 — process restart 시뮬: 디스크에서 다시 load
    const reloaded = repo.loadShadowTrades();
    expect(reloaded).toHaveLength(1);
    const r3 = await pipeline.executeShadowBuy({
      trade: reloaded[0],
      allTrades: reloaded,
    });
    expect(r3.outcome).toBe('ALREADY_FILLED');

    // 영속 invariant — 정확히 1개의 BUY fill 만 존재
    const finalLoaded = repo.loadShadowTrades();
    const buyFills = (finalLoaded[0].fills ?? []).filter((f) => f.type === 'BUY');
    expect(buyFills).toHaveLength(1);
  });
});
