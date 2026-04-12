/**
 * macroSync.ts — 레짐 파이프라인 동기화
 *
 * Gate 0 평가 완료 후 서버 MacroState에 동기화.
 * 프론트엔드가 Gemini에서 얻은 vkospi, vix, usdKrw와 Gate 0 MHS를 서버에 전달.
 */

import type { Gate0Result } from '../../types/core';
import type { MacroEnvironment } from '../../types/macro';

/**
 * Gate 0 평가 완료 후 서버 MacroState에 동기화.
 *
 * 프론트엔드가 Gemini에서 얻은 vkospi, vix, usdKrw와 Gate 0 MHS를 서버에 전달.
 * 서버 /macro/refresh(cron)는 KOSPI MA·SPX·DXY·FSS를 별도로 채운다.
 * 두 경로가 MERGE 저장되므로 어느 쪽이 먼저 실행되어도 덮어쓰지 않는다.
 *
 * @param macro Gemini가 반환한 MacroEnvironment
 * @param g0    evaluateGate0() 결과
 */
export async function syncGate0ToServer(
  macro: MacroEnvironment,
  g0: Gate0Result,
): Promise<void> {
  const mhsTrend: 'IMPROVING' | 'STABLE' | 'DETERIORATING' =
    macro.mhsTrend ?? 'STABLE';

  const payload: Record<string, unknown> = {
    mhs:    g0.macroHealthScore,
    // Gemini 정량 필드
    vkospi: macro.vkospi,
    vix:    macro.vix,
    usdKrw: macro.usdKrw,
    oeciCliKorea:     macro.oeciCliKorea,
    exportGrowth3mAvg: macro.exportGrowth3mAvg,
    mhsTrend,
    vkospiRising:         macro.vkospiRising,
    foreignFuturesSellDays: macro.foreignFuturesSellDays,
    dxyBullish:           macro.dxyBullish,
    kospiBelow120ma:      macro.kospiBelow120ma,
    samsungIriDelta:      macro.samsungIriDelta,
    // VKOSPI 파생 — 클라이언트 Yahoo Finance → 서버 MacroState 전송
    vkospiDayChange:      macro.vkospiDayChange,
    vkospi5dTrend:        macro.vkospi5dTrend,
  };

  try {
    await fetch('/api/auto-trade/macro/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[MacroSync] 서버 동기화 실패 (비치명적):', err);
  }
}
