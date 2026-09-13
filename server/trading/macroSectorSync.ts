// @responsibility Refresh observed market volatility without trading policy changes.
import { loadMacroState, saveMacroState } from '../persistence/macroStateRepo.js';
import { fetchCloses } from './marketDataRefresh.js';

export async function refreshMarketVolatility(): Promise<void> {
  const closes = await fetchCloses('^VIX', '1d');
  const vix = closes?.[closes.length - 1];
  if (vix === undefined || !Number.isFinite(vix) || vix <= 0) {
    console.warn('[MarketVolatility] VIX 실측값 없음 — 기존 자료 보존');
    return;
  }
  const macro = loadMacroState();
  if (!macro) {
    console.warn('[MarketVolatility] 시장자료 상태를 읽을 수 없음 — 기존 자료 보존');
    return;
  }
  saveMacroState({ ...macro, vix, updatedAt: new Date().toISOString() });
}
