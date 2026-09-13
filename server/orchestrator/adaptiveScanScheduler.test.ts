import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { decideScan, recordScanResult, getScanFeedbackState, resetScanState, requestImmediateRescan } from './adaptiveScanScheduler.js';

const market = vi.hoisted(() => ({ regime: 'R6_DEFENSE', vkospiDayChange: 0, activePositions: 0 }));
vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: () => ({ regime: market.regime, vkospiDayChange: market.vkospiDayChange }),
}));
vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: () => Array.from({ length: market.activePositions }, () => ({ status: 'ACTIVE', watchlistSource: 'MANUAL' })),
}));
vi.mock('../trading/regime/canonicalRegimeAccess.js', () => ({
  resolveCanonicalRegimeLevel: () => { throw new Error('retired regime classifier must not execute'); },
}));
vi.mock('../trading/regimeBridge.js', () => ({
  getRegimeDiagnostics: () => { throw new Error('retired regime diagnostics must not execute'); },
}));

function kstTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 4, 8, hour - 9, minute, 0)); // 2026-05-08 Friday
}

const buyAllowedNow = kstTime(10, 0);
const trueEmptyOpts = { now: buyAllowedNow, engineMode: 'NORMAL' as const };

describe('recordScanResult — 피드백 루프', () => {
  beforeEach(() => {
    resetScanState();
  });

  it('빈 스캔이 연속되면 consecutiveEmptyScans가 누적된다', () => {
    recordScanResult(0, trueEmptyOpts);
    recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(2);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1); // 5회 미만 → 배율 1
  });

  it('4회 연속 빈 스캔이어도 임계값(5) 미만이면 배율 1', () => {
    for (let i = 0; i < 4; i++) recordScanResult(0, trueEmptyOpts);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(4);
    expect(state.backoffMultiplier).toBe(1);
  });

  it('5회 연속 빈 스캔 → backoffMultiplier가 2로 증가한다', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(5);
    expect(state.backoffMultiplier).toBe(2);
  });

  it('10회 연속 빈 스캔 → backoffMultiplier가 3(최대)으로 증가한다', () => {
    for (let i = 0; i < 10; i++) recordScanResult(0, trueEmptyOpts);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(10);
    expect(state.backoffMultiplier).toBe(3);
  });

  it('15회 연속 빈 스캔이어도 backoffMultiplier는 3을 초과하지 않는다', () => {
    for (let i = 0; i < 15; i++) recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().backoffMultiplier).toBe(3);
  });

  it('신호가 발견되면 consecutiveEmptyScans가 0으로 리셋된다', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(5);

    recordScanResult(2); // 신호 2건 발견
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });

  it('빈 스캔 후 신호 발견 후 다시 빈 스캔 → 카운터가 0부터 재시작', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    recordScanResult(1); // 리셋
    recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });

  it('resetScanState()로 전체 상태 초기화', () => {
    recordScanResult(0, trueEmptyOpts);
    recordScanResult(0, trueEmptyOpts);
    recordScanResult(0, trueEmptyOpts);
    resetScanState();
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });
});

describe('recordScanResult — ADR-452b empty scan taxonomy wiring', () => {
  beforeEach(() => {
    resetScanState();
  });

  // 출력/행동 드리프트 정정 (canonical = emptyScanTaxonomy.getKstIntradaySession/isBuySessionKst):
  //   ADR-0552(점심 휴장 폐지) + volumeClock ALWAYS-ON 정합으로 isBuySessionKst 는 평일 09:00~15:20
  //   전부 buyable 로 정의된다. 09:15(OPENING_GUARD)·11:45(LUNCH_GUARD) 는 더이상 session-blocked 가
  //   아니라 *감점만 있는 매수 허용 구간* → classifyEmptyScan = TRUE_EMPTY(incrementEmptyScan=true).
  //   따라서 streak 가 1 로 증가한다. 진짜 session-blocked 는 15:20+(CLOSING_PREP, 아래 15:25)·주말뿐.
  //   원본은 점심·시초가가 차단이던 구(舊) 윈도 기준으로 DOA.
  it('09:15 KST + signalCount=0 + NORMAL은 OPENING_GUARD(매수 허용)로 TRUE_EMPTY streak를 증가시킨다', () => {
    recordScanResult(0, { now: kstTime(9, 15), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
  });

  it('11:45 KST + signalCount=0 + NORMAL은 LUNCH_GUARD(매수 허용)로 TRUE_EMPTY streak를 증가시킨다', () => {
    recordScanResult(0, { now: kstTime(11, 45), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
  });

  it('15:25 KST + signalCount=0 + NORMAL은 session-blocked로 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(15, 25), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });

  it('10:00 KST + signalCount=0 + NORMAL은 TRUE_EMPTY로 streak를 증가시킨다', () => {
    recordScanResult(0, { now: kstTime(10, 0), engineMode: 'NORMAL' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
  });

  it('10:00 KST + signalCount=0 + SELL_ONLY는 mode-blocked로 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(10, 0), engineMode: 'SELL_ONLY' });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
  });

  it('positionFull=true이면 기존처럼 streak를 증가시키지 않는다', () => {
    recordScanResult(0, { now: kstTime(10, 0), engineMode: 'NORMAL', positionFull: true });
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
  });
});



describe('regime-free observation cadence', () => {
  beforeEach(() => {
    resetScanState();
    market.regime = 'R6_DEFENSE';
    market.vkospiDayChange = 0;
    market.activePositions = 0;
    vi.useFakeTimers();
    vi.setSystemTime(buyAllowedNow);
    vi.stubEnv('MAX_CONVICTION_POSITIONS', '10');
    vi.stubEnv('TRADE_WINDOW_LEGACY_HOURS', 'false');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(['R1_TURBO', 'R6_DEFENSE'])('keeps the existing morning cadence regardless of stale %s metadata', (regime) => {
    market.regime = regime;
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 2, priority: 'FULL' });
    vi.setSystemTime(new Date(buyAllowedNow.getTime() + 90_000));
    expect(decideScan()).toMatchObject({ shouldScan: false, intervalMinutes: 2 });
    vi.setSystemTime(new Date(buyAllowedNow.getTime() + 120_000));
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 2 });
  });

  it('preserves position-based cadence adjustment against the existing four-position fallback', () => {
    market.activePositions = 3;
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 4 });
  });

  it('preserves raw VKOSPI spike observation and its cooldown', () => {
    expect(decideScan().shouldScan).toBe(true);
    market.vkospiDayChange = 7;
    vi.setSystemTime(new Date(buyAllowedNow.getTime() + 1_000));
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 0, priority: 'FULL' });
    vi.setSystemTime(new Date(buyAllowedNow.getTime() + 2_000));
    expect(decideScan().shouldScan).toBe(false);
  });

  it('preserves immediate rescan requests without querying a regime', () => {
    decideScan();
    vi.setSystemTime(new Date(buyAllowedNow.getTime() + 1_000));
    requestImmediateRescan('position resolved');
    expect(decideScan()).toMatchObject({ shouldScan: true, priority: 'FULL' });
  });

  it('retains empty-scan backoff without old Gate/region policy alerts', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0, trueEmptyOpts);
    expect(getScanFeedbackState().backoffMultiplier).toBe(2);
    vi.setSystemTime(new Date(buyAllowedNow.getTime() + 240_000));
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 4, priority: 'FULL' });
  });
});
