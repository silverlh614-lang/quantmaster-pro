// @responsibility ADR-0104 FOMC DAY 청산 라벨 분리 회귀 — placeKisSellOrder reason + fomcDayLiquidation wiring
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { originalReasonLabel } from './fillMonitor.js';

/**
 * ADR-0104 — FOMC DAY 자동 청산이 SHADOW 손절(🔴)이 아닌 별도 라벨(📅 FOMC
 * 자동청산)로 표기되어야 함. 사용자 보고 (4/29): "수익인 종목도 손실 표현됨".
 *
 * 본 테스트는 정적 패턴 검증 + originalReasonLabel 단위 테스트.
 */
function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

describe('ADR-0104 — placeKisSellOrder reason union 확장', () => {
  it('kisClient.ts placeKisSellOrder reason 시그니처에 FOMC_DAY_LIQUIDATION 포함', () => {
    const src = readFile('server/clients/kisClient/orders.ts');
    expect(src).toContain('placeKisSellOrder');
    // reason union 4값 모두 포함
    expect(src).toContain("'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA' | 'FOMC_DAY_LIQUIDATION'");
  });

  it('kisClient.ts emoji 분기에 📅 + FOMC_DAY_LIQUIDATION fallback', () => {
    const src = readFile('server/clients/kisClient/orders.ts');
    // emoji 분기 본문이 4-way 분기 (3 분기 + fallback) 패턴 사용
    expect(src).toContain("reason === 'STOP_LOSS' ? '🔴'");
    expect(src).toContain("reason === 'TAKE_PROFIT' ? '🟢'");
    expect(src).toContain("reason === 'EUPHORIA' ? '🌡️'");
    expect(src).toContain('📅'); // FOMC 자동청산 emoji
  });

  it('kisClient.ts label 분기에 "FOMC 자동청산" fallback', () => {
    const src = readFile('server/clients/kisClient/orders.ts');
    expect(src).toContain("'손절'");
    expect(src).toContain("'익절'");
    expect(src).toContain("'과열부분매도'");
    expect(src).toContain("'FOMC 자동청산'");
  });
});

describe('ADR-0104 — fillMonitor PendingSellOrder.originalReason union', () => {
  it('PendingSellOrder.originalReason 4값 union 정합', () => {
    const src = readFile('server/trading/fillMonitor.ts');
    expect(src).toContain(
      "originalReason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA' | 'FOMC_DAY_LIQUIDATION'",
    );
  });

  it('originalReasonLabel 헬퍼 export', () => {
    const src = readFile('server/trading/fillMonitor.ts');
    expect(src).toContain('export function originalReasonLabel');
  });

  it('체결 확인 메시지가 originalReasonLabel 사용 (raw enum 노출 차단)', () => {
    const src = readFile('server/trading/fillMonitor.ts');
    // [매도 체결 확인] 메시지 인근에 originalReasonLabel 호출
    const idx = src.indexOf('[매도 체결 확인]');
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 500);
    expect(block).toContain('originalReasonLabel(order.originalReason)');
  });
});

describe('ADR-0104 — originalReasonLabel 단위 분기', () => {
  it('STOP_LOSS → "손절"', () => {
    expect(originalReasonLabel('STOP_LOSS')).toBe('손절');
  });
  it('TAKE_PROFIT → "익절"', () => {
    expect(originalReasonLabel('TAKE_PROFIT')).toBe('익절');
  });
  it('EUPHORIA → "과열부분매도"', () => {
    expect(originalReasonLabel('EUPHORIA')).toBe('과열부분매도');
  });
  it('FOMC_DAY_LIQUIDATION → "FOMC 자동청산"', () => {
    expect(originalReasonLabel('FOMC_DAY_LIQUIDATION')).toBe('FOMC 자동청산');
  });
});

describe('ADR-0104 — fomcDayLiquidation wiring (FOMC 청산 제거 후 stub)', () => {
  /**
   * 출력 drift 근거 (intent proof — 맹목 갱신 아님):
   *   1. 패치 이력: docs/ai/10-patch-history-index.md `Patch-FOMC-DEAD-CODE-REMOVAL-001`.
   *   2. production @responsibility: fomcDayLiquidation.ts L1
   *      "FOMC DAY 청산 모듈 — 제거됨 (FOMC_LIQUIDATION_REMOVED). Stub only."
   *   3. liquidateAllForFomc 본체(L28~41)는 항상 skipped 결과만 반환 — 청산 루프 부재.
   *   4. cron 진입점 제거: orchestratorJobs.ts:96 "FOMC DAY 자동 청산 cron 제거됨".
   * 따라서 구 wiring(placeKisSellOrder / addSellOrder reason='FOMC_DAY_LIQUIDATION') 단언은
   * 제거된 동작이므로 현행 stub 계약(해당 호출 부재)을 검증하도록 정정한다.
   * 단, originalReasonLabel/타입 union 은 보존됐으므로(아래 describe) 라벨 회귀는 그대로 검증.
   */
  it('fomcDayLiquidation.ts 가 청산 호출 stub 화 — placeKisSellOrder 호출 부재', () => {
    const src = readFile('server/trading/fomcDayLiquidation.ts');
    // 제거 마커 존재 확인 (stub 회귀 차단).
    expect(src).toContain('FOMC_LIQUIDATION_REMOVED');
    // 실 청산 호출(await placeKisSellOrder)이 본체에 없어야 함.
    expect(src).not.toContain('await placeKisSellOrder(');
  });

  it('fomcDayLiquidation.ts addSellOrder 등록 부재 (LIVE 폴링 등록도 stub 화)', () => {
    const src = readFile('server/trading/fomcDayLiquidation.ts');
    expect(src).not.toContain('addSellOrder({');
  });

  it('회귀 차단 — fomcDayLiquidation.ts 본체에 reason="STOP_LOSS" 직접 사용 패턴 부재', () => {
    // 사용자 보고 SHADOW 손절 메시지 재발 차단.
    // ExitRuleTag 인 'STOP_LOSS' 는 다른 의미라 검사 대상 아님 (reason 인자만).
    const src = readFile('server/trading/fomcDayLiquidation.ts');
    // placeKisSellOrder + addSellOrder 두 호출 모두 'STOP_LOSS' reason 부재
    const placeIdx = src.indexOf('await placeKisSellOrder(');
    const placeBlock = src.slice(placeIdx, placeIdx + 300);
    expect(placeBlock).not.toMatch(/['"]STOP_LOSS['"]/);

    const addIdx = src.indexOf('addSellOrder({');
    const addBlock = src.slice(addIdx, addIdx + 400);
    expect(addBlock).not.toMatch(/originalReason:\s*['"]STOP_LOSS['"]/);
  });
});

describe('ADR-0104 — 다른 청산 규칙 호환성 보존 (회귀 차단)', () => {
  it('exitEngine 의 hardStopLoss/r6Emergency 등은 여전히 STOP_LOSS 사용 (의도된 손절)', () => {
    // 다른 청산 규칙은 진짜 손절 (가격 도달) 이라 STOP_LOSS reason 보존.
    const hardStopSrc = readFile('server/trading/exitEngine/rules/hardStopLoss.ts');
    expect(hardStopSrc).toContain("'STOP_LOSS'");
  });

  it('exitEngine 의 legacyTakeProfit 은 TAKE_PROFIT 보존', () => {
    const tpSrc = readFile('server/trading/exitEngine/rules/legacyTakeProfit.ts');
    expect(tpSrc).toContain("'TAKE_PROFIT'");
  });

  it('exitEngine 의 euphoriaPartialExit 은 EUPHORIA 보존', () => {
    const euphSrc = readFile('server/trading/exitEngine/rules/euphoriaPartialExit.ts');
    expect(euphSrc).toContain("'EUPHORIA'");
  });
});
