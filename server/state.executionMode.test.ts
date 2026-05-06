// @responsibility ADR-0393 P1 Stage A ExecutionMode SSOT 회귀 테스트
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getExecutionMode,
  setExecutionMode,
  readEnvExecutionMode,
  __resetExecutionModeForTests,
  getTradingMode,
  type ExecutionMode,
} from './state.js';

const ORIGINAL_EXECUTION_MODE = process.env.EXECUTION_MODE;
const ORIGINAL_AUTO_TRADE_MODE = process.env.AUTO_TRADE_MODE;

beforeEach(() => {
  __resetExecutionModeForTests();
  delete process.env.EXECUTION_MODE;
  delete process.env.AUTO_TRADE_MODE;
});

afterEach(() => {
  __resetExecutionModeForTests();
  if (ORIGINAL_EXECUTION_MODE === undefined) delete process.env.EXECUTION_MODE;
  else process.env.EXECUTION_MODE = ORIGINAL_EXECUTION_MODE;
  if (ORIGINAL_AUTO_TRADE_MODE === undefined) delete process.env.AUTO_TRADE_MODE;
  else process.env.AUTO_TRADE_MODE = ORIGINAL_AUTO_TRADE_MODE;
});

describe('readEnvExecutionMode (ADR-0393 §P1-1)', () => {
  it('EXECUTION_MODE=LIVE → LIVE', () => {
    process.env.EXECUTION_MODE = 'LIVE';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('LIVE');
  });

  it('EXECUTION_MODE=PAPER → PAPER', () => {
    process.env.EXECUTION_MODE = 'PAPER';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('PAPER');
  });

  it('EXECUTION_MODE=OFF → OFF', () => {
    process.env.EXECUTION_MODE = 'OFF';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('OFF');
  });

  it('EXECUTION_MODE 대소문자 무관 — "live" → LIVE', () => {
    process.env.EXECUTION_MODE = 'live';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('LIVE');
  });

  it('EXECUTION_MODE 미설정 + AUTO_TRADE_MODE=LIVE → LIVE (호환 매핑)', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('LIVE');
  });

  it('AUTO_TRADE_MODE=PAPER → PAPER', () => {
    process.env.AUTO_TRADE_MODE = 'PAPER';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('PAPER');
  });

  it('AUTO_TRADE_MODE=VTS → PAPER (legacy KIS VTS 매핑)', () => {
    process.env.AUTO_TRADE_MODE = 'VTS';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('PAPER');
  });

  it('AUTO_TRADE_MODE=SHADOW → OFF (실행 안 함, 학습만)', () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('OFF');
  });

  it('AUTO_TRADE_MODE=MANUAL → OFF (legacy MANUAL 통합)', () => {
    process.env.AUTO_TRADE_MODE = 'MANUAL';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('OFF');
  });

  it('AUTO_TRADE_MODE=잘못된값 → OFF (안전 fallback)', () => {
    process.env.AUTO_TRADE_MODE = 'XYZ';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('OFF');
  });

  it('두 env 모두 미설정 → OFF (default)', () => {
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('OFF');
  });

  it('EXECUTION_MODE 우선 — EXECUTION_MODE=PAPER + AUTO_TRADE_MODE=LIVE → PAPER', () => {
    process.env.EXECUTION_MODE = 'PAPER';
    process.env.AUTO_TRADE_MODE = 'LIVE';
    expect(readEnvExecutionMode()).toBe<ExecutionMode>('PAPER');
  });
});

describe('getExecutionMode + setExecutionMode (ADR-0393 §P1-1)', () => {
  it('초기 → readEnvExecutionMode 호출 (env 의존)', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    expect(getExecutionMode()).toBe<ExecutionMode>('LIVE');
  });

  it('setExecutionMode RUNTIME override — env 무관 강등', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    setExecutionMode('OFF');
    expect(getExecutionMode()).toBe<ExecutionMode>('OFF');
  });

  it('__resetExecutionModeForTests — RUNTIME override 초기화', () => {
    setExecutionMode('LIVE');
    __resetExecutionModeForTests();
    expect(getExecutionMode()).toBe<ExecutionMode>('OFF'); // env 미설정 → OFF
  });
});

describe('getTradingMode deprecated wrapper (ADR-0393 §P1-1)', () => {
  it('ExecutionMode LIVE → TradingMode LIVE', () => {
    setExecutionMode('LIVE');
    expect(getTradingMode()).toBe('LIVE');
  });

  it('ExecutionMode PAPER → TradingMode PAPER', () => {
    setExecutionMode('PAPER');
    expect(getTradingMode()).toBe('PAPER');
  });

  it('ExecutionMode OFF → TradingMode SHADOW (legacy 호환)', () => {
    setExecutionMode('OFF');
    // ADR-0393 정책: deprecated wrapper 는 OFF 를 SHADOW 로 매핑.
    // 단 본 P1 Stage A 에서는 getTradingMode 자체가 RUNTIME_MODE (legacy) ?? readEnvMode 사용.
    // RUNTIME_MODE 와 RUNTIME_EXECUTION_MODE 분리 — P1-Wiring 후속 PR 에서 통합.
    // 현재 동작: env 미설정 시 readEnvMode 가 'SHADOW' 반환 (정책 정합).
    expect(getTradingMode()).toBe('SHADOW');
  });

  it('AUTO_TRADE_MODE=SHADOW → getTradingMode SHADOW (byte-equivalent)', () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    expect(getTradingMode()).toBe('SHADOW');
  });

  it('AUTO_TRADE_MODE=LIVE → getTradingMode LIVE (byte-equivalent)', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    expect(getTradingMode()).toBe('LIVE');
  });
});
