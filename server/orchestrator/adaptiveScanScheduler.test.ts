import { describe, expect, it, beforeEach } from 'vitest';
import { recordScanResult, getScanFeedbackState, resetScanState } from './adaptiveScanScheduler.js';

describe('recordScanResult — 피드백 루프', () => {
  beforeEach(() => {
    resetScanState();
  });

  it('빈 스캔이 연속되면 consecutiveEmptyScans가 누적된다', () => {
    recordScanResult(0);
    recordScanResult(0);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(2);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1); // 5회 미만 → 배율 1
  });

  it('4회 연속 빈 스캔이어도 임계값(5) 미만이면 배율 1', () => {
    for (let i = 0; i < 4; i++) recordScanResult(0);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(4);
    expect(state.backoffMultiplier).toBe(1);
  });

  it('5회 연속 빈 스캔 → backoffMultiplier가 2로 증가한다', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(5);
    expect(state.backoffMultiplier).toBe(2);
  });

  it('10회 연속 빈 스캔 → backoffMultiplier가 3(최대)으로 증가한다', () => {
    for (let i = 0; i < 10; i++) recordScanResult(0);
    const state = getScanFeedbackState();
    expect(state.consecutiveEmptyScans).toBe(10);
    expect(state.backoffMultiplier).toBe(3);
  });

  it('15회 연속 빈 스캔이어도 backoffMultiplier는 3을 초과하지 않는다', () => {
    for (let i = 0; i < 15; i++) recordScanResult(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(3);
  });

  it('신호가 발견되면 consecutiveEmptyScans가 0으로 리셋된다', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(5);

    recordScanResult(2); // 신호 2건 발견
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });

  it('빈 스캔 후 신호 발견 후 다시 빈 스캔 → 카운터가 0부터 재시작', () => {
    for (let i = 0; i < 5; i++) recordScanResult(0);
    recordScanResult(1); // 리셋
    recordScanResult(0);
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(1);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });

  it('resetScanState()로 전체 상태 초기화', () => {
    recordScanResult(0);
    recordScanResult(0);
    recordScanResult(0);
    resetScanState();
    expect(getScanFeedbackState().consecutiveEmptyScans).toBe(0);
    expect(getScanFeedbackState().backoffMultiplier).toBe(1);
  });
});
