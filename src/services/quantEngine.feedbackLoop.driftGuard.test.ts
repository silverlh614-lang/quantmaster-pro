/**
 * @responsibility feedbackLoopEngine drift 가드 wiring 회귀 테스트 (ADR-0046 PR-Y1)
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import {
  evaluateFeedbackLoop,
  buildDriftAlertPayload,
  CALIBRATION_MIN_TRADES,
} from './quant/feedbackLoopEngine';
import {
  __resetF2WDriftStateForTests,
  recordWeightSnapshot,
  pauseF2W,
  isF2WPausedUntil,
  F2W_DRIFT_CONSTANTS,
} from './quant/f2wDriftDetector';
import * as evolutionEngine from './quant/evolutionEngine';
import { attachMockLocalStorage } from './quant/__test-utils__/localStorageMock';
import type { TradeRecord } from '../types/portfolio';

beforeAll(() => { attachMockLocalStorage(); });

const ORIGINAL_DISABLED = process.env.LEARNING_F2W_DRIFT_DISABLED;
beforeEach(() => {
  __resetF2WDriftStateForTests();
  delete process.env.LEARNING_F2W_DRIFT_DISABLED;
  vi.restoreAllMocks();
});
afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.LEARNING_F2W_DRIFT_DISABLED;
  else process.env.LEARNING_F2W_DRIFT_DISABLED = ORIGINAL_DISABLED;
});

const DAY_MS = 24 * 60 * 60 * 1000;

// ── 테스트 도우미 ────────────────────────────────────────────────────────────

/** N건 동일 조건 점수 거래 생성 (winRate 100% 거래로 가중치 +10% 유발) */
function makeWinningTrades(conditionId: number, count: number): TradeRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t-win-${i}`,
    stockCode: '005930',
    stockName: '삼성전자',
    sector: '반도체',
    buyDate: '2026-04-01T00:00:00.000Z',
    buyPrice: 70000,
    quantity: 10,
    positionSize: 5,
    sellDate: '2026-04-10T00:00:00.000Z',
    sellPrice: 75000,
    sellReason: 'TARGET_HIT',
    systemSignal: 'STRONG_BUY',
    recommendation: '풀 포지션',
    gate1Score: 9,
    gate2Score: 9,
    gate3Score: 9,
    finalScore: 90,
    conditionScores: { [conditionId]: 8 } as TradeRecord['conditionScores'],
    followedSystem: true,
    returnPct: 7.14,
    holdingDays: 9,
    status: 'CLOSED',
    schemaVersion: 2,
  } satisfies TradeRecord));
}

/** drift 유발 — 24일 σ=0.05 + 6일 σ=0.4 → ratio ≈ 3.3 */
function seedDriftHistory(now: Date) {
  for (let i = 0; i < 24; i++) {
    const t = new Date(now.getTime() - (30 - i) * DAY_MS);
    recordWeightSnapshot({ 1: 1.0, 2: 1.05, 3: 0.95 }, t);
  }
  for (let i = 0; i < 6; i++) {
    const t = new Date(now.getTime() - (6 - i) * DAY_MS);
    recordWeightSnapshot({ 1: 1.5, 2: 0.5, 3: 1.5 }, t);
  }
}

// ─── core wiring ──────────────────────────────────────────────────────────────

describe('feedbackLoopEngine drift 가드', () => {
  it('첫 호출 (히스토리 부재) → drift=false, saveEvolutionWeights 호출됨', () => {
    const trades = makeWinningTrades(1, CALIBRATION_MIN_TRADES);
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');

    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });

    expect(result.calibrationActive).toBe(true);
    expect(result.boostedCount).toBeGreaterThan(0);
    // drift 미감지 (첫 호출은 30일 표본 부족)
    expect(result.pauseStatus).toBeUndefined();
    expect(saveSpy).toHaveBeenCalled();
  });

  it('shadow=true 호출 → drift 감지 우회 + saveEvolutionWeights 미호출 (ADR-0027 grace)', () => {
    const trades = makeWinningTrades(1, CALIBRATION_MIN_TRADES);
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');
    // 사전에 drift 유발 히스토리 + pause flag 설정
    const now = new Date('2026-04-26T00:00:00.000Z');
    seedDriftHistory(now);
    pauseF2W('preexisting drift', 2.5, now);

    const result = evaluateFeedbackLoop(trades, { 1: 1.0 }, { shadow: true });

    // shadow 호출은 saveEvolutionWeights 미호출이 기본
    expect(saveSpy).not.toHaveBeenCalled();
    // shadow 모드에선 pauseStatus 기록 안 함 (drift 가드 우회)
    expect(result.pauseStatus).toBeUndefined();
  });

  it('LIVE 호출 + 사전 pause 활성 → saveEvolutionWeights 차단', () => {
    const trades = makeWinningTrades(1, CALIBRATION_MIN_TRADES);
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');
    const now = new Date();
    pauseF2W('preexisting', 2.3, now);

    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });

    // LIVE 호출은 pause 활성 시 차단
    expect(saveSpy).not.toHaveBeenCalled();
    expect(result.pauseStatus?.paused).toBe(true);
    expect(result.summary).toContain('drift 감지로 가중치 동결');
  });

  it('LEARNING_F2W_DRIFT_DISABLED=true → drift 가드 우회', () => {
    process.env.LEARNING_F2W_DRIFT_DISABLED = 'true';
    const trades = makeWinningTrades(1, CALIBRATION_MIN_TRADES);
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');
    // pause flag 설정해도 disabled 환경에서 drift 자체가 false → 새 pause 생성 안 함
    // 다만 기존 pause 활성은 isF2WPausedUntil 가 잡아냄 — 이건 의도된 동작
    // (env 는 drift *판정* 만 비활성, *기존 pause 해제* 는 명시적 clearF2WPause)
    // 따라서 새 학습 사이클은 drift 비활성이므로 pause 미설정
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });
    expect(saveSpy).toHaveBeenCalled();
    expect(result.pauseStatus).toBeUndefined();
    expect(isF2WPausedUntil()).toBeNull();
  });

  it('히스토리 누적 — 매 호출마다 1건 추가', () => {
    const trades = makeWinningTrades(1, CALIBRATION_MIN_TRADES);
    evaluateFeedbackLoop(trades, { 1: 1.0 });
    evaluateFeedbackLoop(trades, { 1: 1.05 });
    evaluateFeedbackLoop(trades, { 1: 1.1 });
    const raw = (globalThis.localStorage as Storage).getItem(F2W_DRIFT_CONSTANTS.HISTORY_KEY);
    expect(raw).not.toBeNull();
    const history = JSON.parse(raw!) as unknown[];
    expect(history.length).toBe(3);
  });
});

// ─── drift 신규 감지 시나리오 ────────────────────────────────────────────────

describe('feedbackLoopEngine 신규 drift 감지', () => {
  it('LIVE 호출 시 신규 drift → pause 생성 + saveEvolutionWeights 차단', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    seedDriftHistory(now);
    expect(isF2WPausedUntil(now)).toBeNull();

    const trades = makeWinningTrades(1, CALIBRATION_MIN_TRADES);
    const saveSpy = vi.spyOn(evolutionEngine, 'saveEvolutionWeights');

    // 본 호출이 새 snapshot 추가 + drift 판정
    // 새 snapshot 의 σ 가 기존 24+6 패턴에 합류해 σ7d 평균이 더 커짐
    const result = evaluateFeedbackLoop(trades, { 1: 1.0 });

    expect(result.pauseStatus?.paused).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

// ─── buildDriftAlertPayload ────────────────────────────────────────────────────

describe('buildDriftAlertPayload', () => {
  it('pauseStatus 필드를 알림 페이로드로 변환', () => {
    const payload = buildDriftAlertPayload(
      { 1: 1.5, 2: 0.5, 3: 1.0 },
      {
        paused: true,
        until: '2026-05-03T00:00:00.000Z',
        reason: 'σ7d ≥ σ30d × 2',
        ratio: 2.5,
        sigma7d: 0.4,
        sigma30dAvg: 0.16,
      },
    );
    expect(payload.sigma7d).toBe(0.4);
    expect(payload.sigma30dAvg).toBe(0.16);
    expect(payload.ratio).toBe(2.5);
    expect(payload.pausedUntil).toBe('2026-05-03T00:00:00.000Z');
    expect(payload.reason).toBe('σ7d ≥ σ30d × 2');
    expect(payload.topConditions).toHaveLength(3);
    // 편차 내림차순 첫 항목 확인
    expect(payload.topConditions[0].deviation).toBeGreaterThan(0);
  });

  it('필드 누락 시 안전 fallback', () => {
    const payload = buildDriftAlertPayload(
      {},
      { paused: true },
    );
    expect(payload.sigma7d).toBe(0);
    expect(payload.ratio).toBe(0);
    expect(payload.reason).toBe('F2W drift detected');
    expect(payload.topConditions).toEqual([]);
  });
});
