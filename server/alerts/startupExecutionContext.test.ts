/**
 * @responsibility ADR-0553 자동매매 시동 안전 가드 + 시동 배너(real/모의 구분) 회귀 테스트.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  resolveAutoTradeStartupGuard,
  buildStartupExecutionContextSnapshot,
  formatStartupExecutionContextMessage,
} from './startupExecutionContext.js';

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('ADR-0553 — resolveAutoTradeStartupGuard (2축 시동 가드)', () => {
  it('mode !== LIVE → ALLOW_NO_EXECUTION (SHADOW/VTS/OFF/미설정)', () => {
    for (const mode of ['SHADOW', 'VTS', 'OFF', undefined]) {
      const r = resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: mode }));
      expect(r.allowed).toBe(true);
      expect(r.decision).toBe('ALLOW_NO_EXECUTION');
    }
  });

  it('LIVE + 실계좌 + ACK 없음 → 기동 거부 (실수 실거래 방지 하드가드)', () => {
    const r = resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: 'LIVE', KIS_IS_REAL: 'true' }));
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe('REFUSE_REAL_MONEY_UNACKED');
  });

  it('LIVE + 실계좌 + ACK → ALLOW_REAL_MONEY', () => {
    const r = resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: 'LIVE', KIS_IS_REAL: 'true', KIS_REAL_MONEY_ACK: 'true' }));
    expect(r.allowed).toBe(true);
    expect(r.decision).toBe('ALLOW_REAL_MONEY');
  });

  it('LIVE + 모의 + VTS flag 없음 → 기동 거부 (매수만 나가는 비대칭 방지)', () => {
    const r = resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: 'LIVE', KIS_IS_REAL: 'false' }));
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe('REFUSE_PAPER_FLAG_DISABLED');
  });

  it('LIVE + 모의 + VTS flag → ALLOW_PAPER_VTS (모의 매매 활성)', () => {
    const r = resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: 'LIVE', KIS_IS_REAL: 'false', VTS_PAPER_TRADING_ENABLED: 'true' }));
    expect(r.allowed).toBe(true);
    expect(r.decision).toBe('ALLOW_PAPER_VTS');
  });

  it('byte-equivalent: 신규 flag 모두 미설정 시 LIVE+모의 는 기존(index.ts:25)처럼 거부', () => {
    // 기존 트리거: AUTO_TRADE_MODE==='LIVE' && KIS_IS_REAL!=='true' → throw.
    expect(resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: 'LIVE', KIS_IS_REAL: undefined })).allowed).toBe(false);
    expect(resolveAutoTradeStartupGuard(env({ AUTO_TRADE_MODE: 'LIVE', KIS_IS_REAL: 'false' })).allowed).toBe(false);
  });
});

describe('ADR-0553 — buildStartupExecutionContextSnapshot 배너 정합', () => {
  it('LIVE + 모의 + VTS flag + autoTrade → PAPER_VTS, 주문 ON (OFF 오표시 방지)', () => {
    const s = buildStartupExecutionContextSnapshot(env({
      AUTO_TRADE_MODE: 'LIVE', AUTO_TRADE_ENABLED: 'true', KIS_IS_REAL: 'false', VTS_PAPER_TRADING_ENABLED: 'true',
    }));
    expect(s.accountType).toBe('PAPER_VTS');
    expect(s.paperExecutionActive).toBe(true);
    expect(s.liveExecutionAllowed).toBe(false);
    expect(s.orderExecutionLabel).toBe('ON');
    expect(formatStartupExecutionContextMessage(s)).toContain('모의계좌');
  });

  it('LIVE + 실계좌 + autoTrade → REAL_MONEY, 주문 ON', () => {
    const s = buildStartupExecutionContextSnapshot(env({
      AUTO_TRADE_MODE: 'LIVE', AUTO_TRADE_ENABLED: 'true', KIS_IS_REAL: 'true',
    }));
    expect(s.accountType).toBe('REAL_MONEY');
    expect(s.liveExecutionAllowed).toBe(true);
    expect(s.orderExecutionLabel).toBe('ON');
    expect(formatStartupExecutionContextMessage(s)).toContain('실제 돈');
  });

  it('SHADOW → 주문 OFF, accountType NONE', () => {
    const s = buildStartupExecutionContextSnapshot(env({ AUTO_TRADE_MODE: 'SHADOW' }));
    expect(s.orderExecutionLabel).toBe('OFF');
    expect(s.accountType).toBe('NONE');
  });
});

describe('ADR-0553 정적 가드 — index.ts 시동 가드 격상', () => {
  const indexSrc = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf-8');

  it('index.ts 가 resolveAutoTradeStartupGuard 를 사용한다 (인라인 throw 격상)', () => {
    expect(indexSrc).toMatch(/resolveAutoTradeStartupGuard/);
  });
});
