/**
 * @responsibility ADR-0553 facade 주문 집행 게이트 회귀 — 2축(실행 mode × 계좌 kisIsReal) + byte-equivalence.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveFacadeOrderExecutionAllowed } from './orders.js';

describe('ADR-0553 — resolveFacadeOrderExecutionAllowed (2축: 실행 mode × 계좌 kisIsReal)', () => {
  it('mode !== LIVE → 항상 차단 (SHADOW/PAPER/OFF/VTS), flag·계좌 무관', () => {
    for (const mode of ['SHADOW', 'PAPER', 'OFF', 'MANUAL', 'VTS']) {
      for (const kisIsReal of [true, false]) {
        for (const vtsPaperTradingEnabled of [true, false]) {
          expect(resolveFacadeOrderExecutionAllowed({ mode, kisIsReal, vtsPaperTradingEnabled })).toBe(false);
        }
      }
    }
  });

  it('flag OFF → 기존 동작 byte-identical (kisIsReal && LIVE)', () => {
    for (const mode of ['LIVE', 'SHADOW', 'PAPER']) {
      for (const kisIsReal of [true, false]) {
        const got = resolveFacadeOrderExecutionAllowed({ mode, kisIsReal, vtsPaperTradingEnabled: false });
        const legacy = kisIsReal && mode === 'LIVE';
        expect(got).toBe(legacy);
      }
    }
  });

  it('flag ON + LIVE → 계좌 무관 집행 (모의/실은 kisIsReal 라우팅에 위임) — 매도 대칭', () => {
    expect(resolveFacadeOrderExecutionAllowed({ mode: 'LIVE', kisIsReal: false, vtsPaperTradingEnabled: true })).toBe(true);
    expect(resolveFacadeOrderExecutionAllowed({ mode: 'LIVE', kisIsReal: true, vtsPaperTradingEnabled: true })).toBe(true);
  });

  it('flag ON 이라도 mode !== LIVE 면 차단 (실행 OFF 우선)', () => {
    expect(resolveFacadeOrderExecutionAllowed({ mode: 'SHADOW', kisIsReal: false, vtsPaperTradingEnabled: true })).toBe(false);
  });
});

describe('ADR-0553 정적 가드 — orders.ts drift 차단', () => {
  const ordersSrc = fs.readFileSync(path.resolve(__dirname, 'orders.ts'), 'utf-8');

  it('주문 게이트가 VTS_PAPER_TRADING_ENABLED flag 를 경유한다', () => {
    expect(ordersSrc).toMatch(/VTS_PAPER_TRADING_ENABLED/);
    expect(ordersSrc).toMatch(/resolveFacadeOrderExecutionAllowed/);
  });

  it('flag OFF byte-identical fallback (return input.kisIsReal) 보존', () => {
    expect(ordersSrc).toMatch(/return input\.kisIsReal/);
  });
});
