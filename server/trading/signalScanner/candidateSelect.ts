/**
 * @responsibility 워치리스트를 SWING/CATALYST/MOMENTUM 섹션으로 분류 — buyList·intradayBuyList 구성
 */
import { loadIntradayWatchlist } from '../../persistence/intradayWatchlistRepo.js';
import { computeFocusCodes, assignSection } from '../../screener/watchlistManager.js';
import type { RunAutoSignalScanOptions } from './index.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';

interface PreflightContext {
  watchlist: WatchlistEntry[];
}

export async function selectCandidates(
  context: PreflightContext,
  options?: RunAutoSignalScanOptions,
): Promise<any> {
  const { watchlist } = context;

  if (watchlist.length === 0) {
    return {
      mainList: [],
      buyList: [],
      intradayList: [],
      swingList: [],
      catalystList: [],
      momentumList: [],
      lengths: {
        buyListLength: 0,
        intradayBuyListLength: 0,
        swingListLength: 0,
        catalystListLength: 0,
        momentumListLength: 0,
      },
    };
  }

  const liveFocusCodes = computeFocusCodes(watchlist);
  const forceCodes = new Set(options?.forceBuyCodes ?? []);

  for (const w of watchlist) {
    w.section = assignSection(w, liveFocusCodes);
  }

  const AUTO_SHADOW_FROM_MOMENTUM = process.env.AUTO_SHADOW_FROM_MOMENTUM !== 'false';
  const buyList = watchlist.filter(
    (w) =>
      w.section === 'SWING' ||
      w.section === 'CATALYST' ||
      (AUTO_SHADOW_FROM_MOMENTUM && w.section === 'MOMENTUM') ||
      forceCodes.has(w.code),
  );
  const swingList = watchlist.filter((w) => w.section === 'SWING');
  const catalystList = watchlist.filter((w) => w.section === 'CATALYST');
  const momentumList = watchlist.filter((w) => w.section === 'MOMENTUM');

  if (momentumList.length > 0) {
    const scope = AUTO_SHADOW_FROM_MOMENTUM ? 'Shadow 학습' : '관찰 전용';
    console.log(
      `[AutoTrade] MOMENTUM ${scope} ${momentumList.length}개: ` +
        momentumList
          .slice(0, 10)
          .map((w) => `${w.name}(${w.code}) gate=${(w as any).gateScore ?? 0}`)
          .join(', ') +
        (momentumList.length > 10 ? ` ...외 ${momentumList.length - 10}개` : ''),
    );
  }

  const intradayList = loadIntradayWatchlist().filter((w) => (w as any).intradayReady === true);

  return {
    mainList: buyList, // 테스트 하위 호환성 유지용
    buyList,
    intradayList,
    swingList,
    catalystList,
    momentumList,
    lengths: {
      buyListLength: buyList.length,
      intradayBuyListLength: intradayList.length,
      swingListLength: swingList.length,
      catalystListLength: catalystList.length,
      momentumListLength: momentumList.length,
    },
  };
}