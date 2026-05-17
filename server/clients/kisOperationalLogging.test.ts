/**
 * @responsibility KIS 운영 로그 노이즈 억제 회귀 테스트
 *
 * 단발성 RealData 5xx 복구와 investorFlow provider-router 선택 summary 는
 * Trading Engine / Shadow Learning 의미가 아닌 화면 로그 정책이어야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../utils/logger.js';
import { __queryTestOnly } from './kisClient/query.js';
import { __testOnly, resetKisCircuits } from './kisClient.js';

describe('KIS investorFlow selected operational logging', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T03:17:00.000Z'));
    __queryTestOnly.resetInvestorFlowSelectedLogState();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    __queryTestOnly.resetInvestorFlowSelectedLogState();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('동일 investorFlow selected 상태가 10회 반복되어도 info 는 최초 1회만 출력한다', () => {
    for (let i = 0; i < 10; i += 1) {
      __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    }

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toContain('executionImpact=NONE');
    expect(infoSpy.mock.calls[0]?.[0]).toContain('providerIssue=false');
    expect(infoSpy.mock.calls[0]?.[0]).toContain('marketSignal=false');
    expect(infoSpy.mock.calls[0]?.[0]).toContain('logClass=TELEMETRY');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('confidence 가 DEGRADED 로 바뀌면 상태 변경으로 보고 info 를 다시 출력한다', () => {
    __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    __queryTestOnly.logInvestorFlowSelected(30, 'DEGRADED');

    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(String(infoSpy.mock.calls[1]?.[0])).toContain('confidence=DEGRADED');
  });

  it('동일 상태 반복은 5분 summary 주기에 debug 집계 로그로 전환한다', () => {
    __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    for (let i = 0; i < 18; i += 1) {
      vi.advanceTimersByTime(10_000);
      __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');
    }
    expect(debugSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2 * 60 * 1000);
    __queryTestOnly.logInvestorFlowSelected(30, 'VERIFIED');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(String(debugSpy.mock.calls[0]?.[0])).toContain('investorFlow selected unchanged');
    expect(String(debugSpy.mock.calls[0]?.[0])).toContain('repeated=19');
  });
});

describe('KIS circuit recovery operational logging', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T03:17:00.000Z'));
    resetKisCircuits();
    __testOnly.resetRecoveryLogRateLimit();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetKisCircuits();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('minor circuit recovery(previousHard=1, previousSoft=0)는 warn/error 없이 debug telemetry 로 출력한다', () => {
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(String(debugSpy.mock.calls[0]?.[0])).toBe('[KIS] circuit recovery minor');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('FHKST03010100 recovery 로그는 동일 endpoint 기준 5분 내 반복 출력을 제한한다', () => {
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');

    expect(debugSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordSuccess('FHKST03010100');

    expect(debugSpy).toHaveBeenCalledTimes(2);
  });

  it('hard threshold 이상 복구는 info recovery 로 분류하지만 warn/error 로 격상하지 않는다', () => {
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordFailure('FHKST03010100', 500);
    __testOnly.recordFailure('FHKST03010100', 500);
    warnSpy.mockClear();

    __testOnly.recordSuccess('FHKST03010100');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]?.[0])).toBe('[KIS] circuit recovery');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
