// @responsibility Patch-SUPPLY-HEALTH-EMPTY-ROUTER-DISPATCH-FIX-001 회귀 가드 — V2 router 진입 gate 의 3-value 매칭 정합 + ENV rollback.
import fs from 'fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { isAcceptedEmptyRaw as IsAcceptedEmptyRawT, isEmptyRouterDispatchFixDisabled as IsDisabledT } from './supplyHealth.cmd.js';

const SOURCE = fs.readFileSync('server/telegram/commands/system/supplyHealth.cmd.ts', 'utf-8');
const PATCH004_SOURCE = fs.readFileSync('server/clients/kisClient/programMarketRouterPatch004.ts', 'utf-8');

let cachedIsAcceptedEmptyRaw: typeof IsAcceptedEmptyRawT;
let cachedIsDisabled: typeof IsDisabledT;

// Pre-load module once — supplyHealth.cmd.ts is a large module (heavy transform on first import).
beforeAll(async () => {
  const mod = await import('./supplyHealth.cmd.js');
  cachedIsAcceptedEmptyRaw = mod.isAcceptedEmptyRaw;
  cachedIsDisabled = mod.isEmptyRouterDispatchFixDisabled;
}, 30000);

describe('Patch-SUPPLY-HEALTH-EMPTY-ROUTER-DISPATCH-FIX-001 — isAcceptedEmptyRaw 3-value 매칭', () => {
  let resetEnv: (() => void) | null = null;

  beforeEach(() => {
    const original = process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED;
    delete process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED;
    resetEnv = () => {
      if (original === undefined) delete process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED;
      else process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = original;
    };
  });

  afterEach(() => {
    if (resetEnv) resetEnv();
  });

  describe('runtime — default (Fix ON)', () => {
    it('ACCEPTED_EMPTY 매칭 (Patch-006/007 진입 gate 진입)', async () => {
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=ACCEPTED_EMPTY trId=FHPPG04600101')).toBe(true);
    });

    it('OUTPUT_EMPTY 매칭 (사용자 5/15 운영 보고 — 정확히 본 PR 이 차단하는 결함)', async () => {
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=OUTPUT_EMPTY trId=FHPPG04600101')).toBe(true);
    });

    it('FIELD_MISSING 매칭 (Patch-004 V1 router 의 3-value 정합)', async () => {
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=FIELD_MISSING trId=FHPPG04600101')).toBe(true);
    });

    it('rawDiag prefix 부재 시 false (다른 진단 line 에 우연히 zeroReason= 등장 차단)', async () => {
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('rawDiag=STOCK_PROGRAM zeroReason=OUTPUT_EMPTY')).toBe(false);
      expect(isAcceptedEmptyRaw('zeroReason=OUTPUT_EMPTY')).toBe(false);
    });

    it('NON_ZERO / RAW_ZERO / FETCH_FAIL 같은 다른 zeroReason 미매칭 (V2 router 진입 차단)', async () => {
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=NON_ZERO')).toBe(false);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=RAW_ZERO')).toBe(false);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=FETCH_FAIL')).toBe(false);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=PROVIDER_ERROR')).toBe(false);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=PARAM_ERROR')).toBe(false);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=SESSION_UNAVAILABLE')).toBe(false);
    });

    it('빈 문자열 / 다른 prefix → false', async () => {
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('')).toBe(false);
      expect(isAcceptedEmptyRaw('something else')).toBe(false);
    });
  });

  describe('runtime — ENV rollback (Fix DISABLED)', () => {
    it('ENV =true 시 legacy 1-value 매칭 (ACCEPTED_EMPTY 만 true)', async () => {
      process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = 'true';
      const isAcceptedEmptyRaw = cachedIsAcceptedEmptyRaw;
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=ACCEPTED_EMPTY')).toBe(true);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=OUTPUT_EMPTY')).toBe(false);
      expect(isAcceptedEmptyRaw('rawDiag=MARKET_PROGRAM zeroReason=FIELD_MISSING')).toBe(false);
    });

    it('ADR-0157 정확 비교 — TRUE/1/yes 거부', async () => {
      const isEmptyRouterDispatchFixDisabled = cachedIsDisabled;

      process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = 'TRUE';
      expect(isEmptyRouterDispatchFixDisabled()).toBe(false);

      process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = '1';
      expect(isEmptyRouterDispatchFixDisabled()).toBe(false);

      process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = 'yes';
      expect(isEmptyRouterDispatchFixDisabled()).toBe(false);

      process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = '';
      expect(isEmptyRouterDispatchFixDisabled()).toBe(false);

      process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED = 'true';
      expect(isEmptyRouterDispatchFixDisabled()).toBe(true);
    });
  });

  describe('static — Patch-004 V1 router 본체와 정합', () => {
    it('Patch-004 V1 router 가 ACCEPTED_EMPTY | OUTPUT_EMPTY | FIELD_MISSING 3-value fallback 시도 (정합 SSOT 보존 검증)', () => {
      // Patch-004 본체 변경 시 본 PR 진입 gate 도 동시 갱신 의무 — drift 차단.
      expect(PATCH004_SOURCE).toContain("rawZeroReason === 'ACCEPTED_EMPTY'");
      expect(PATCH004_SOURCE).toContain("rawZeroReason === 'OUTPUT_EMPTY'");
      expect(PATCH004_SOURCE).toContain("rawZeroReason === 'FIELD_MISSING'");
    });

    it('isAcceptedEmptyRaw 가 3-value 모두 검사 (drift 가드)', () => {
      expect(SOURCE).toContain("zeroReason=ACCEPTED_EMPTY");
      expect(SOURCE).toContain("zeroReason=OUTPUT_EMPTY");
      expect(SOURCE).toContain("zeroReason=FIELD_MISSING");
    });

    it('isEmptyRouterDispatchFixDisabled SSOT export (호출자 측 inline ENV 검사 차단)', () => {
      expect(SOURCE).toContain('export function isEmptyRouterDispatchFixDisabled');
      expect(SOURCE).toMatch(/process\.env\.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED\s*===\s*'true'/);
    });

    it('isAcceptedEmptyRaw export (회귀 unit test 가능 + drift 차단)', () => {
      expect(SOURCE).toContain('export function isAcceptedEmptyRaw');
    });

    it('Patch 추적 주석 명시', () => {
      expect(SOURCE).toContain('Patch-SUPPLY-HEALTH-EMPTY-ROUTER-DISPATCH-FIX-001');
    });

    it('호출자 측 inline ENV 검사 0건 (SSOT 위임 의무)', () => {
      // diagnoseMarketProgram 안에서 process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED 직접 read 0건.
      const occurrences = SOURCE.split('process.env.SUPPLY_HEALTH_EMPTY_ROUTER_DISPATCH_FIX_DISABLED').length - 1;
      expect(occurrences).toBe(1); // SSOT 헬퍼 본체 1회만
    });
  });
});
