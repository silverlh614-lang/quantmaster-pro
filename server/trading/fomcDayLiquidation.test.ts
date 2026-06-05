// @responsibility fomcDayLiquidation.ts 회귀 테스트 — FOMC 청산 제거(FOMC_LIQUIDATION_REMOVED) 후 stub 계약
/**
 * fomcDayLiquidation.test.ts
 *
 * 출력/정책 drift 근거 (intent proof — 맹목 갱신 아님):
 *   1. 패치 이력: docs/ai/10-patch-history-index.md `Patch-FOMC-DEAD-CODE-REMOVAL-001 · FOMC, dead-code`.
 *   2. production @responsibility: fomcDayLiquidation.ts L1
 *      "FOMC DAY 청산 모듈 — 제거됨 (FOMC_LIQUIDATION_REMOVED). Stub only."
 *   3. liquidateAllForFomc 본체(L28~41) → 항상 { executed:false, guardReason:'DISABLED',
 *      totalActive:0, results:[], dryRun:false } 만 반환 (청산 루프·KIS·telegram 호출 부재).
 *   4. runFomcDayMorningAlert / runFomcDayPreLiquidationAlert → no-op (L73~82).
 *   5. cron 진입점 제거: orchestratorJobs.ts:96 "FOMC DAY 자동 청산 cron 제거됨".
 *
 * 따라서 구 ADR-0061 5중 가드 / 활성 포지션 청산 / dryRun / reserveSell 실패 흡수 /
 * 사전 경보 단언은 제거된 동작이므로, 현행 stub 계약을 검증하도록 정정한다.
 *
 * 단 formatLiquidationResultMessage 는 여전히 live 함수이므로(L52~68) 실제 출력
 * (이모지 헤더 없음, "실패 종목 수동 청산 필요" tail) 기준으로 behavioral 검증한다.
 *
 * 외부 의존성은 stub 이 호출하지 않으므로 mock 으로 격리만 한다 (KIS/telegram/persistence 0 호출 보장).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── vi.mock 선언 (호이스팅) — stub 이 의존성을 호출하지 않음을 검증하기 위한 격리 ──

vi.mock('../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(),
}));

vi.mock('./exitEngine/helpers/reserveSell.js', () => ({
  reserveSell: vi.fn(),
  placeReservedSellOrder: vi.fn(),
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendPrivateAlert: vi.fn().mockResolvedValue(undefined),
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../state.js', () => ({
  getEmergencyStop: vi.fn(() => false),
}));

vi.mock('./fillMonitor.js', () => ({
  addSellOrder: vi.fn(),
}));

vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(() => null),
}));

vi.mock('./regimeBridge.js', () => ({
  getLiveRegime: vi.fn(() => 'R2_BULL'),
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn(() => []),
  getRemainingQty: vi.fn((t: { quantity?: number }) => t?.quantity ?? 0),
  appendShadowLog: vi.fn(),
  syncPositionCache: vi.fn(),
  buildExitAttribution: vi.fn(),
}));

// 실 모듈 import — vi.mock 이후
import {
  liquidateAllForFomc,
  formatLiquidationResultMessage,
  runFomcDayMorningAlert,
  runFomcDayPreLiquidationAlert,
} from './fomcDayLiquidation.js';
import { placeKisSellOrder } from '../clients/kisClient.js';
import { placeReservedSellOrder as reserveSell } from './exitEngine/helpers/reserveSell.js';
import { sendPrivateAlert } from '../alerts/telegramClient.js';
import { addSellOrder } from './fillMonitor.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';

const SAMPLE_DATE_KST = new Date('2026-04-29T05:30:00Z'); // KST 14:30 (구 FOMC DAY)

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── liquidateAllForFomc — 제거됨 (stub) ───────────────────────────────────────

describe('liquidateAllForFomc — FOMC_LIQUIDATION_REMOVED stub', () => {
  it('항상 skipped 결과 반환 (executed=false, guardReason=DISABLED, 빈 배열)', async () => {
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.executed).toBe(false);
    expect(r.guardReason).toBe('DISABLED');
    expect(r.totalActive).toBe(0);
    expect(r.results).toEqual([]);
    expect(r.successCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.dryRun).toBe(false);
  });

  it('dryRunOverride 를 주어도 동일 stub 결과 (옵션 무시)', async () => {
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST, { dryRunOverride: true });
    expect(r.executed).toBe(false);
    expect(r.dryRun).toBe(false);
    expect(r.results).toEqual([]);
  });

  it('실 청산 부수효과 0 — KIS/reserveSell/addSellOrder/telegram/shadowTrades 미호출', async () => {
    await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
    expect(reserveSell).not.toHaveBeenCalled();
    expect(addSellOrder).not.toHaveBeenCalled();
    expect(sendPrivateAlert).not.toHaveBeenCalled();
    expect(loadShadowTrades).not.toHaveBeenCalled();
  });
});

// ── formatLiquidationResultMessage — 여전히 live (behavioral) ──────────────────

describe('formatLiquidationResultMessage — 분기 (dryRun / 정상 / 실패)', () => {
  it('dryRun=true → "[FOMC DAY 청산 — dryRun]" + "실행 안 됨" (이모지 없음)', () => {
    const msg = formatLiquidationResultMessage({
      totalActive: 3,
      results: [],
      successCount: 0,
      failedCount: 0,
      dryRun: true,
    });
    expect(msg).toContain('[FOMC DAY 청산 — dryRun]');
    expect(msg).toContain('대상: 3건');
    expect(msg).toContain('실행 안 됨');
  });

  it('정상 완료 (실패 0건) → "[FOMC DAY 청산 완료]" + 수동 청산 안내 미포함', () => {
    const msg = formatLiquidationResultMessage({
      totalActive: 2,
      results: [],
      successCount: 2,
      failedCount: 0,
      dryRun: false,
    });
    expect(msg).toContain('[FOMC DAY 청산 완료]');
    expect(msg).toContain('성공: 2건 / 실패: 0건 (총 2건)');
    expect(msg).not.toContain('수동 청산 필요');
  });

  it('일부 실패 (failedCount>0) → "일부 실패" 헤더 + "실패 종목 수동 청산 필요" 추가', () => {
    const msg = formatLiquidationResultMessage({
      totalActive: 3,
      results: [],
      successCount: 1,
      failedCount: 2,
      dryRun: false,
    });
    expect(msg).toContain('[FOMC DAY 청산 — 일부 실패]');
    expect(msg).toContain('성공: 1건 / 실패: 2건 (총 3건)');
    expect(msg).toContain('실패 종목 수동 청산 필요');
  });
});

// ── 사전 경보 함수 — 제거됨 (no-op stub) ──────────────────────────────────────

describe('runFomcDayMorningAlert / runFomcDayPreLiquidationAlert — no-op stub', () => {
  it('runFomcDayMorningAlert: DAY 시각이어도 telegram 미발송 (stub)', async () => {
    await runFomcDayMorningAlert(SAMPLE_DATE_KST);
    expect(sendPrivateAlert).not.toHaveBeenCalled();
    expect(loadShadowTrades).not.toHaveBeenCalled();
  });

  it('runFomcDayPreLiquidationAlert: 활성 포지션 조회/알림 부재 (stub)', async () => {
    await runFomcDayPreLiquidationAlert(SAMPLE_DATE_KST);
    expect(sendPrivateAlert).not.toHaveBeenCalled();
    expect(loadShadowTrades).not.toHaveBeenCalled();
  });

  it('두 경보 모두 throw 없이 resolve (호출 안전)', async () => {
    await expect(runFomcDayMorningAlert(SAMPLE_DATE_KST)).resolves.toBeUndefined();
    await expect(runFomcDayPreLiquidationAlert(SAMPLE_DATE_KST)).resolves.toBeUndefined();
  });
});
