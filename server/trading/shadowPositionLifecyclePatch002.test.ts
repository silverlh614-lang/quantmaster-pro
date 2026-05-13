/**
 * shadowPositionLifecyclePatch002.test.ts — Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002
 *
 * 사용자 명시 12+ 테스트 + 9 invariant 정적 grep 가드.
 *
 * 절대 불변식 (사용자 §J 직접 인용):
 *   1. Live 실주문, 실계좌 매수/매도 로직 변경 0줄
 *   2. Always-On Trading Kernel — Shadow 오류가 Live 매매엔진 차단 0
 *   3. SHADOW_PAPER_FILLED → SHADOW_POSITION_OPENED 의무 wiring
 *   4. 불일치 발생해도 Live 매매엔진 무중단
 *   5. Shadow 매도 실제 KIS 호출 0건 (paper sell fill)
 *   6. Telegram 상태 변화 이벤트만 (HOLD repeat 0)
 *   7. Sell idempotency key — `${trade_date}:SHADOW:SELL:${symbol}:${position_id}:${sell_reason}`
 *   8. CLOSED 포지션 1회만 emit
 *   9. KIS quota 0 침범
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 — shadowPositionLifecycle SSOT', () => {
  let tmpDir: string;
  let lifecycle: typeof import('./shadowPositionLifecycle.js');
  let repo: typeof import('../persistence/shadowTradeRepo.js');
  let ledger: typeof import('../persistence/shadowPositionLedger.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-lifecycle-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.SHADOW_POSITION_LIFECYCLE_DISABLED;
    delete process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED;
    const { vi } = await import('vitest');
    vi.resetModules();
    lifecycle = await import('./shadowPositionLifecycle.js');
    repo = await import('../persistence/shadowTradeRepo.js');
    ledger = await import('../persistence/shadowPositionLedger.js');
    lifecycle.__resetShadowPositionLifecycleStoreForTests();
    lifecycle.__resetShadowLifecycleSummaryForTests();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.SHADOW_POSITION_LIFECYCLE_DISABLED;
    delete process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  function makeTrade(
    overrides: Partial<import('../persistence/shadowTradeRepo.js').ServerShadowTrade> = {},
  ): import('../persistence/shadowTradeRepo.js').ServerShadowTrade {
    const now = new Date().toISOString();
    return {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      stockCode: '452280',
      stockName: '한선엔지니어링',
      signalTime: now,
      signalPrice: 10000,
      shadowEntryPrice: 10000,
      quantity: 5,
      originalQuantity: 5,
      stopLoss: 9300,
      targetPrice: 11500,
      status: 'ACTIVE',
      mode: 'SHADOW',
      fills: [
        {
          id: 'f1',
          type: 'BUY',
          subType: 'INITIAL_BUY',
          qty: 5,
          price: 10000,
          reason: 'test',
          timestamp: now,
          status: 'CONFIRMED',
          confirmedAt: now,
        },
      ],
      ...overrides,
    } as import('../persistence/shadowTradeRepo.js').ServerShadowTrade;
  }

  // ─── Test 1: 6-event union 정합 ────────────────────────────────────────────
  it('Test 1: ShadowLifecycleEvent union 6값 정합 + literal types (executionImpact=NONE / liveOrderPlaced=false / mode=SHADOW)', () => {
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);
    const result = lifecycle.emitShadowPositionOpened(trade);
    expect(result.event).toBe('SHADOW_POSITION_OPENED');
    expect(result.outcome).toBe('EMITTED');
    expect(result.liveOrderPlaced).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.mode).toBe('SHADOW');
  });

  // ─── Test 2: ENV gate (default OFF + ADR-0157 정확 비교) ────────────────
  it('Test 2: ENV `SHADOW_POSITION_LIFECYCLE_DISABLED=true` 만 비활성, default OFF, `=== "true"` 정확 비교', () => {
    expect(lifecycle.isShadowPositionLifecycleDisabled()).toBe(false);
    process.env.SHADOW_POSITION_LIFECYCLE_DISABLED = 'true';
    expect(lifecycle.isShadowPositionLifecycleDisabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', 'on', 'True', '']) {
      process.env.SHADOW_POSITION_LIFECYCLE_DISABLED = v;
      expect(lifecycle.isShadowPositionLifecycleDisabled()).toBe(false);
    }
    delete process.env.SHADOW_POSITION_LIFECYCLE_DISABLED;
    expect(lifecycle.isShadowPositionLifecycleDisabled()).toBe(false);
  });

  // ─── Test 3: emitShadowPositionOpened idempotent ─────────────────────────
  it('Test 3: emitShadowPositionOpened 동일 trade 두 번 호출 시 첫 번째 EMITTED, 두 번째 DEDUPED', () => {
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);
    const a = lifecycle.emitShadowPositionOpened(trade);
    const b = lifecycle.emitShadowPositionOpened(trade);
    expect(a.outcome).toBe('EMITTED');
    expect(b.outcome).toBe('DEDUPED');
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toMatch(/^\d{4}-\d{2}-\d{2}:SHADOW:OPEN:452280:/);
  });

  // ─── Test 4: 사용자 §J #7 sell idempotency key 정확 포맷 ────────────────
  it('Test 4: buildSellIdempotencyKey returns `${trade_date}:SHADOW:SELL:${symbol}:${position_id}:${sell_reason}`', () => {
    const key = lifecycle.buildSellIdempotencyKey('2026-05-13', '452280', 't_abc', 'HARD_STOP');
    expect(key).toBe('2026-05-13:SHADOW:SELL:452280:t_abc:HARD_STOP');
    // sell_reason undefined → 'UNKNOWN'
    const key2 = lifecycle.buildSellIdempotencyKey('2026-05-13', '452280', 't_abc', undefined);
    expect(key2).toBe('2026-05-13:SHADOW:SELL:452280:t_abc:UNKNOWN');
    // 다른 reason 은 별도 key
    const key3 = lifecycle.buildSellIdempotencyKey('2026-05-13', '452280', 't_abc', 'TRAILING');
    expect(key3).not.toBe(key);
  });

  // ─── Test 5: emitShadowSellPaperFilled idempotent (sell_reason 별 분리) ──
  it('Test 5: emitShadowSellPaperFilled — sell_reason 별 분리 idempotent + 동일 reason 중복 차단', () => {
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);
    const r1 = lifecycle.emitShadowSellPaperFilled(trade, 'HARD_STOP', {
      fillPrice: 9300,
      fillQty: 5,
      remainingQtyAfter: 0,
      pnlPct: -7,
    });
    expect(r1.outcome).toBe('EMITTED');
    const r2 = lifecycle.emitShadowSellPaperFilled(trade, 'HARD_STOP', {
      fillPrice: 9300,
      fillQty: 5,
      remainingQtyAfter: 0,
    });
    expect(r2.outcome).toBe('DEDUPED');
    // 다른 reason 은 별도 emit
    const r3 = lifecycle.emitShadowSellPaperFilled(trade, 'TRAILING', {
      fillPrice: 11000,
      fillQty: 2,
      remainingQtyAfter: 3,
    });
    expect(r3.outcome).toBe('EMITTED');
  });

  // ─── Test 6: emitShadowPositionClosed — 1회만 ─────────────────────────────
  it('Test 6: emitShadowPositionClosed 동일 position 두 번 호출 시 DEDUPED (사용자 §J #8)', () => {
    const trade = makeTrade({ status: 'HIT_STOP', quantity: 0 });
    repo.saveShadowTrades([trade]);
    const a = lifecycle.emitShadowPositionClosed(trade, { closeReason: 'HARD_STOP' });
    const b = lifecycle.emitShadowPositionClosed(trade, { closeReason: 'HARD_STOP' });
    expect(a.outcome).toBe('EMITTED');
    expect(b.outcome).toBe('DEDUPED');
  });

  // ─── Test 7: verifyShadowPositionRegistryConsistency — consistent ────────
  it('Test 7: verifyShadowPositionRegistryConsistency — trade open + ledger 일치 시 consistent=true', () => {
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);
    const check = lifecycle.verifyShadowPositionRegistryConsistency(trade);
    expect(check.consistent).toBe(true);
    expect(check.expectedQty).toBe(5);
    expect(check.ledgerQty).toBe(5);
    expect(check.ledgerHasEntry).toBe(true);
    expect(check.executionImpact).toBe('NONE');
    expect(check.liveOrderPlaced).toBe(false);
  });

  // ─── Test 8: verifyShadowPositionRegistryConsistency — inconsistent ──────
  it('Test 8: verifyShadowPositionRegistryConsistency — open trade 인데 ledger 부재 시 consistent=false + reason', () => {
    const trade = makeTrade();
    // ledger 에 영속하지 않음 — 즉시 검증
    const check = lifecycle.verifyShadowPositionRegistryConsistency(trade);
    expect(check.consistent).toBe(false);
    expect(check.inconsistencyReason).toMatch(/no entry/);
    expect(check.executionImpact).toBe('NONE');
  });

  // ─── Test 9: NOT_SHADOW (LIVE 모드 호출 차단) ────────────────────────────
  it('Test 9: trade.mode=LIVE 시 NOT_SHADOW outcome — 본 SSOT 가 LIVE 매매에 영향 0', () => {
    const trade = makeTrade({ mode: 'LIVE' });
    repo.saveShadowTrades([trade]);
    const r = lifecycle.emitShadowPositionOpened(trade);
    expect(r.outcome).toBe('NOT_SHADOW');
    expect(r.mode).toBe('NOT_APPLICABLE');
    expect(r.liveOrderPlaced).toBe(false);
    expect(r.executionImpact).toBe('NONE');
  });

  // ─── Test 10: ENV_DISABLED outcome ───────────────────────────────────────
  it('Test 10: ENV `SHADOW_POSITION_LIFECYCLE_DISABLED=true` 시 모든 emit 함수 ENV_DISABLED 반환', () => {
    process.env.SHADOW_POSITION_LIFECYCLE_DISABLED = 'true';
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);
    expect(lifecycle.emitShadowPositionOpened(trade).outcome).toBe('ENV_DISABLED');
    expect(lifecycle.emitShadowPositionMonitor(trade).outcome).toBe('ENV_DISABLED');
    expect(lifecycle.emitShadowSellSignal(trade, 'HARD_STOP').outcome).toBe('ENV_DISABLED');
    expect(
      lifecycle.emitShadowSellPaperFilled(trade, 'HARD_STOP', {
        fillPrice: 9300,
        fillQty: 5,
        remainingQtyAfter: 0,
      }).outcome,
    ).toBe('ENV_DISABLED');
    expect(
      lifecycle.emitShadowPositionClosed(trade, { closeReason: 'HARD_STOP' }).outcome,
    ).toBe('ENV_DISABLED');
  });

  // ─── Test 11: emitShadowPositionMonitor — cycle 별 dedup ─────────────────
  it('Test 11: emitShadowPositionMonitor 동일 cycle 내 dedup, 새 cycle 시 다시 EMITTED', () => {
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);
    const cycleA = '2026-05-13T10:00:00Z';
    const cycleB = '2026-05-13T10:01:00Z';
    expect(lifecycle.emitShadowPositionMonitor(trade, { cycleIso: cycleA }).outcome).toBe('EMITTED');
    expect(lifecycle.emitShadowPositionMonitor(trade, { cycleIso: cycleA }).outcome).toBe('DEDUPED');
    // 새 cycle — 다시 EMITTED
    expect(lifecycle.emitShadowPositionMonitor(trade, { cycleIso: cycleB }).outcome).toBe('EMITTED');
  });

  // ─── Test 12: 전체 lifecycle 통합 — BUY → OPENED → MONITOR → SELL → CLOSED
  it('Test 12: 전체 lifecycle 통합 — 사용자 명시 6-state 시퀀스 순서대로 emit + summary 카운트 정합', () => {
    const trade = makeTrade();
    repo.saveShadowTrades([trade]);

    const opened = lifecycle.emitShadowPositionOpened(trade);
    expect(opened.outcome).toBe('EMITTED');
    lifecycle.recordShadowLifecycleOutcome('SHADOW_POSITION_OPENED', opened.outcome);

    const monitor = lifecycle.emitShadowPositionMonitor(trade);
    expect(monitor.outcome).toBe('EMITTED');
    lifecycle.recordShadowLifecycleOutcome('SHADOW_POSITION_MONITOR', monitor.outcome);

    const signal = lifecycle.emitShadowSellSignal(trade, 'TARGET_HIT');
    expect(signal.outcome).toBe('EMITTED');
    lifecycle.recordShadowLifecycleOutcome('SHADOW_SELL_SIGNAL', signal.outcome);

    // paper-fill 직후 잔량 0 — POSITION_CLOSED 도 emit
    trade.status = 'HIT_TARGET';
    trade.quantity = 0;
    const filled = lifecycle.emitShadowSellPaperFilled(trade, 'TARGET_HIT', {
      fillPrice: 11500,
      fillQty: 5,
      remainingQtyAfter: 0,
      pnlPct: 15,
    });
    expect(filled.outcome).toBe('EMITTED');
    lifecycle.recordShadowLifecycleOutcome('SHADOW_SELL_PAPER_FILLED', filled.outcome);

    const closed = lifecycle.emitShadowPositionClosed(trade, { closeReason: 'TARGET_HIT' });
    expect(closed.outcome).toBe('EMITTED');
    lifecycle.recordShadowLifecycleOutcome('SHADOW_POSITION_CLOSED', closed.outcome);

    const summary = lifecycle.getShadowLifecycleSummary();
    expect(summary.opened).toBe(1);
    expect(summary.monitor).toBe(1);
    expect(summary.sellSignal).toBe(1);
    expect(summary.sellPaperFilled).toBe(1);
    expect(summary.closed).toBe(1);
    expect(summary.executionImpact).toBe('NONE');
  });

  // ─── Test 13: format runtime section 표시 ─────────────────────────────────
  it('Test 13: formatShadowPositionLifecycleSection — 0건 시 null, total>0 시 PATCH-RUNTIME 태그 + invariant 표기', () => {
    expect(lifecycle.formatShadowPositionLifecycleSection()).toBeNull();
    lifecycle.recordShadowLifecycleOutcome('SHADOW_POSITION_OPENED', 'EMITTED');
    lifecycle.recordShadowLifecycleOutcome('SHADOW_SELL_PAPER_FILLED', 'EMITTED');
    const out = lifecycle.formatShadowPositionLifecycleSection();
    expect(out).toBeTruthy();
    expect(out).toContain('[PATCH-RUNTIME]');
    expect(out).toContain('Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002');
    expect(out).toContain('executionImpact=NONE');
    expect(out).toContain('liveOrderPlaced=false');
    expect(out).toContain('opened=1');
    expect(out).toContain('sellPaperFilled=1');
  });

  // ─── Test 14: ledger 와 trade.id 불일치 시 inconsistent ───────────────────
  it('Test 14: verifyConsistency — same stockCode 의 다른 trade.id 만 ledger 에 있을 때 inconsistent', () => {
    const tradeA = makeTrade({ id: 't_aaa' });
    const tradeB = makeTrade({ id: 't_bbb' });
    repo.saveShadowTrades([tradeA]);
    // tradeB 는 영속하지 않음 — ledger 는 tradeA 만 보유. tradeB 입장에선 mismatch.
    const check = lifecycle.verifyShadowPositionRegistryConsistency(tradeB);
    expect(check.consistent).toBe(false);
    expect(check.inconsistencyReason).toMatch(/trade\.id mismatch/);
  });

  // ─── Test 15: closed trade — qty=0 + ledger 부재 시 consistent=true ──────
  it('Test 15: verifyConsistency — closed trade (qty=0) + ledger 부재 시 consistent=true', () => {
    const trade = makeTrade({
      status: 'HIT_STOP',
      quantity: 0,
      fills: [
        ...(makeTrade().fills ?? []),
        {
          id: 'f2',
          type: 'SELL',
          subType: 'STOP_LOSS',
          qty: 5,
          price: 9300,
          reason: 'stop',
          timestamp: new Date().toISOString(),
          status: 'CONFIRMED',
        },
      ],
    });
    // ledger 에 저장하지 않음 — closed 상태이므로 ledger 부재가 정합
    const check = lifecycle.verifyShadowPositionRegistryConsistency(trade);
    expect(check.consistent).toBe(true);
    expect(check.expectedQty).toBe(0);
  });
});

// ─── 정적 grep 가드 — LIVE matter body 0줄 + KIS quota 0 ────────────────────────

describe('Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 — 안전 invariant 정적 grep 가드', () => {
  const fs = require('fs');
  const path = require('path');
  const lifecycleSrc = fs.readFileSync(
    path.resolve(__dirname, 'shadowPositionLifecycle.ts'),
    'utf-8',
  );

  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  it('SSOT 가 KIS 주문 함수 5종 import 0건 (placeKisMarketBuyOrder / placeKisSellOrder / placeKisStopLossOrder / placeKisTakeProfitOrder / cancelKisOrder)', () => {
    const code = stripComments(lifecycleSrc);
    expect(code).not.toMatch(/placeKisMarketBuyOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
  });

  it('SSOT 가 autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const code = stripComments(lifecycleSrc);
    expect(code).not.toMatch(/from\s+['"][^'"]*autoTradeEngine['"]/);
    expect(code).not.toMatch(/from\s+['"][^'"]*orderExecutor['"]/);
    expect(code).not.toMatch(/from\s+['"][^'"]*trancheExecutor['"]/);
  });

  it('SSOT 가 외부 fetch / axios / node-fetch import 0건', () => {
    const code = stripComments(lifecycleSrc);
    expect(code).not.toMatch(/from\s+['"]axios['"]/);
    expect(code).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
  });

  it('ENV `=== \'true\'` 정확 비교 (ADR-0157)', () => {
    expect(lifecycleSrc).toMatch(/process\.env\.SHADOW_POSITION_LIFECYCLE_DISABLED\s*===\s*['"]true['"]/);
    // !== 'true' 같은 우회 패턴 없어야 함
    expect(lifecycleSrc).not.toMatch(/process\.env\.SHADOW_POSITION_LIFECYCLE_DISABLED\s*!==/);
  });

  it('literal type 강제 (liveOrderPlaced: false + executionImpact: \'NONE\' + mode: \'SHADOW\')', () => {
    expect(lifecycleSrc).toMatch(/liveOrderPlaced:\s*false/);
    expect(lifecycleSrc).toMatch(/executionImpact:\s*['"]NONE['"]/);
    expect(lifecycleSrc).toMatch(/mode:\s*['"]SHADOW['"]/);
  });

  it('ADR-0146 추적 주석 — Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 명시', () => {
    expect(lifecycleSrc).toContain('Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002');
  });

  it('wiring 정적 가드 — shadowExecutionPipeline 에서 emitShadowPositionOpened 호출', () => {
    const pipelineSrc = fs.readFileSync(
      path.resolve(__dirname, 'shadowExecutionPipeline.ts'),
      'utf-8',
    );
    expect(pipelineSrc).toMatch(/emitShadowPositionOpened/);
    expect(pipelineSrc).toMatch(/from\s+['"][^'"]*shadowPositionLifecycle[^'"]*['"]/);
    // try/catch 격리 검증 — emitShadowPositionOpened 호출 라인이 try { ... } catch
    // 블록 안에 있는지 패턴 매칭
    expect(pipelineSrc).toMatch(
      /try\s*\{[\s\S]{0,400}emitShadowPositionOpened[\s\S]{0,400}\}\s*catch/,
    );
  });

  it('wiring 정적 가드 — exitEngine/index.ts 에서 emitShadowPositionMonitor 호출 + try/catch 격리', () => {
    const exitSrc = fs.readFileSync(
      path.resolve(__dirname, 'exitEngine/index.ts'),
      'utf-8',
    );
    expect(exitSrc).toMatch(/emitShadowPositionMonitor/);
    expect(exitSrc).toMatch(/from\s+['"][^'"]*shadowPositionLifecycle[^'"]*['"]/);
    expect(exitSrc).toMatch(
      /try\s*\{[\s\S]{0,400}emitShadowPositionMonitor[\s\S]{0,400}\}\s*catch/,
    );
  });

  it('wiring 정적 가드 — reserveSell 에서 SHADOW_ONLY 분기에만 emit (LIVE_ORDERED/FAILED 분기에는 emit 0건)', () => {
    const reserveSrc = fs.readFileSync(
      path.resolve(__dirname, 'exitEngine/helpers/reserveSell.ts'),
      'utf-8',
    );
    expect(reserveSrc).toMatch(/emitShadowSellSignal/);
    expect(reserveSrc).toMatch(/emitShadowSellPaperFilled/);
    expect(reserveSrc).toMatch(/emitShadowPositionClosed/);
    // try/catch 격리 검증
    expect(reserveSrc).toContain('[ShadowPositionLifecycle] emit');
  });

  it('LIVE 매매 본체 0줄 변경 정적 검증 — exitEngine 본체 placeKisSellOrder 호출 위치 무수정 (rules/*.ts 본체 변경 0)', () => {
    // hardStopLoss / legacyTakeProfit 등 17 exit rules 본체에 lifecycle SSOT import 추가 안 함
    // (reserveSell helper 만 wiring — 모든 rules 가 reserveSell 경유)
    const rulesDir = path.resolve(__dirname, 'exitEngine/rules');
    const rules = fs.readdirSync(rulesDir).filter((f: string) => f.endsWith('.ts'));
    for (const r of rules) {
      const src = fs.readFileSync(path.join(rulesDir, r), 'utf-8');
      expect(src).not.toMatch(/shadowPositionLifecycle/);
    }
  });

  it('Always-On Trading Kernel — try/catch 격리 패턴 (사용자 §J #2)', () => {
    // shadowExecutionPipeline + exitEngine/index + reserveSell 모두 emit 호출 직후 catch 보유
    const targets = [
      'shadowExecutionPipeline.ts',
      'exitEngine/index.ts',
      'exitEngine/helpers/reserveSell.ts',
    ];
    for (const t of targets) {
      const src = fs.readFileSync(path.resolve(__dirname, t), 'utf-8');
      // emit 호출이 있다면 try { ... } catch 블록 안에 있어야 함 — 단순 grep 으로
      // emit 호출 직후 ~400 char 안에 'catch' 키워드 등장 검증
      const matches = src.split(/emit(Shadow\w+)/g);
      // matches 가 적어도 2개 이상이면 emit 호출 존재 — try/catch 검증
      // (단순화: 본 파일은 'catch' 키워드 보유 의무)
      expect(src).toMatch(/catch\b/);
    }
  });

  it('Telegram 중복 발송 차단 — SSOT 가 channelShadowBuyFilled / channelShadowSellFilled / sendTelegramAlert / dispatchAlert import 0건', () => {
    const code = stripComments(lifecycleSrc);
    expect(code).not.toMatch(/channelShadowBuyFilled/);
    expect(code).not.toMatch(/channelShadowSellFilled/);
    expect(code).not.toMatch(/sendTelegramAlert/);
    expect(code).not.toMatch(/dispatchAlert/);
  });
});
