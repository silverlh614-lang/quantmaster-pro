/**
 * marketDataRefresh.ts — 서버사이드 RegimeVariables 시장데이터 자동 갱신
 *
 * Yahoo Finance에서 4개 지수를 fetch해 classifyRegime()이 필요로 하는
 * 시장 지표를 계산하고 MacroState에 MERGE 저장한다.
 *
 * 커버하는 필드:
 *  ② 거시:   usdKrw, usdKrw20dChange, usdKrwDayChange
 *  ③ 수급:   foreignNetBuy5d, passiveActiveBoth (FSS 레코드에서)
 *  ④ 지수:   kospiAbove20MA, kospiAbove60MA, kospi20dReturn, kospiDayReturn
 *  ⑦ 글로벌: spx20dReturn, dxy5dChange
 *
 * 커버하지 않는 필드 (별도 데이터 소스 필요):
 *  ① 변동성: vkospiDayChange, vkospi5dTrend  — regimeBridge가 vkospiRising 대용
 *  ⑤ 사이클: leadingSectorRS, sectorCycleStage — 섹터 데이터 별도 필요
 *  ⑥ 신용:   marginBalance5dChange, shortSellingRatio — KRX 데이터 별도 필요
 */

import { loadMacroState, saveMacroState } from '../persistence/macroStateRepo.js';
import { loadFssRecords } from '../persistence/fssRepo.js';
import { fetchCloses } from '../lib/yahooFinance.js';

/** 이동평균 계산 */
function sma(prices: number[], n: number): number {
  const slice = prices.slice(-n);
  if (slice.length < n) return prices[prices.length - 1] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** N일 수익률 (%) */
function nDayReturn(prices: number[], n: number): number {
  if (prices.length < n + 1) return 0;
  const past    = prices[prices.length - 1 - n];
  const current = prices[prices.length - 1];
  return ((current - past) / past) * 100;
}

/** FSS 레코드 → foreignNetBuy5d(억원) + passiveActiveBoth */
function computeFssVars(): { foreignNetBuy5d: number; passiveActiveBoth: boolean } {
  const records = loadFssRecords()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5);
  if (records.length === 0) return { foreignNetBuy5d: 0, passiveActiveBoth: false };
  const foreignNetBuy5d  = records.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0);
  const passiveActiveBoth = records.every(r => r.passiveNetBuy > 0 && r.activeNetBuy > 0);
  return { foreignNetBuy5d, passiveActiveBoth };
}

/**
 * 시장 지표를 Yahoo Finance + FSS에서 계산해 MacroState에 MERGE 저장.
 * 실패한 개별 지표는 기존 값 유지.
 */
export async function refreshMarketRegimeVars(): Promise<Record<string, number | boolean | null>> {
  const existing = loadMacroState();
  if (!existing) {
    console.warn('[MarketRefresh] MacroState 없음 — MHS를 먼저 POST /macro/state로 초기화하세요');
    return {};
  }

  const computed: Record<string, number | boolean | null> = {};

  // ── ④ KOSPI (^KS11) 60일 — MA, 수익률 ──────────────────────────────────────
  const kospi = await fetchCloses('^KS11', '65d');
  if (kospi && kospi.length >= 22) {
    const last     = kospi[kospi.length - 1];
    const ma20     = sma(kospi, 20);
    const ma60     = kospi.length >= 62 ? sma(kospi, 60) : null;
    computed.kospiAbove20MA  = last > ma20;
    if (ma60 !== null) computed.kospiAbove60MA = last > ma60;
    computed.kospi20dReturn  = nDayReturn(kospi, 20);
    computed.kospiDayReturn  = kospi.length >= 2
      ? ((last - kospi[kospi.length - 2]) / kospi[kospi.length - 2]) * 100
      : 0;
    console.log(`[MarketRefresh] KOSPI: 현재=${last.toFixed(0)}, MA20=${ma20.toFixed(0)}, 20d=${(computed.kospi20dReturn as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] KOSPI 데이터 부족 또는 실패');
  }

  // ── ② USD/KRW (KRW=X) 20일 ───────────────────────────────────────────────
  const usdkrw = await fetchCloses('KRW=X', '25d');
  if (usdkrw && usdkrw.length >= 3) {
    const last = usdkrw[usdkrw.length - 1];
    computed.usdKrw         = last;
    computed.usdKrwDayChange = usdkrw.length >= 2
      ? ((last - usdkrw[usdkrw.length - 2]) / usdkrw[usdkrw.length - 2]) * 100
      : 0;
    computed.usdKrw20dChange = nDayReturn(usdkrw, Math.min(20, usdkrw.length - 1));
    console.log(`[MarketRefresh] USD/KRW: ${last.toFixed(2)}, 20d=${(computed.usdKrw20dChange as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] USD/KRW 데이터 부족 또는 실패');
  }

  // ── ⑦ S&P500 (^GSPC) 20일 ────────────────────────────────────────────────
  const spx = await fetchCloses('^GSPC', '25d');
  if (spx && spx.length >= 3) {
    computed.spx20dReturn = nDayReturn(spx, Math.min(20, spx.length - 1));
    console.log(`[MarketRefresh] SPX: 20d=${(computed.spx20dReturn as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] SPX 데이터 부족 또는 실패');
  }

  // ── ⑦ DXY (DX-Y.NYB) 5일 ────────────────────────────────────────────────
  const dxy = await fetchCloses('DX-Y.NYB', '10d');
  if (dxy && dxy.length >= 3) {
    computed.dxy5dChange = nDayReturn(dxy, Math.min(5, dxy.length - 1));
    console.log(`[MarketRefresh] DXY: 5d=${(computed.dxy5dChange as number).toFixed(2)}%`);
  } else {
    console.warn('[MarketRefresh] DXY 데이터 부족 또는 실패');
  }

  // ── ③ FSS 수급 (서버 로컬 레코드) ────────────────────────────────────────
  const fssVars = computeFssVars();
  computed.foreignNetBuy5d  = fssVars.foreignNetBuy5d;
  computed.passiveActiveBoth = fssVars.passiveActiveBoth;
  console.log(`[MarketRefresh] 수급: foreignNetBuy5d=${fssVars.foreignNetBuy5d.toFixed(0)}억, passiveActiveBoth=${fssVars.passiveActiveBoth}`);

  // ── MacroState에 MERGE 저장 ───────────────────────────────────────────────
  const updated = { ...existing, ...computed, updatedAt: new Date().toISOString() };
  saveMacroState(updated as typeof existing);
  console.log(`[MarketRefresh] MacroState 갱신 완료 — ${Object.keys(computed).length}개 필드`);
  return computed;
}
