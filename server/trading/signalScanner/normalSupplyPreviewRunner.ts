// @responsibility Collect normal-mode supply preview without opening any order path.
import {
  getEmergencyStop,
  getManualBlockNewBuy,
  getManualManageOnly,
} from '../../state.js';
import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import { selectCandidates } from './candidateSelect.js';
import {
  createDefaultInvestorFlowRouter,
  injectPerSymbolSupplyContext,
} from './injectPerSymbolSupplyContext.js';
// Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch B: 기존 2 필드 carry (programNetBuyAmount/
// programSource) 를 SSOT 위임으로 격상 → 4 필드 (programArbitrageNetBuy/programFetchedAt
// 추가) 모두 carry. 호출자 측 inline 객체 합성 → SSOT 단일 호출로 drift 차단.
import { buildMarketProgramFlowCarryPayload } from './marketProgramCarryWiringPolicy.js';
import {
  deriveNormalSupplyPreviewEngineMode,
  persistNormalSupplyPreview,
  type NormalSupplyPreview,
} from './normalSupplyPreview.js';

export async function collectNormalSupplyPreviewFromWatchlist(params: {
  reason?: string;
  forceBuyCodes?: string[];
} = {}): Promise<NormalSupplyPreview> {
  // Patch-MARKET-PROGRAM-CARRY-WIRING-001 — type cast 격상: 기존 2 필드만 cast 하던 것을
  // 4 필드 모두 cast 로 격상. macroStateRepo SSOT (programNetBuyAmount/programArbitrageNetBuy/
  // programFetchedAt/programSource) 와 정합. read-only consumer (macroStateRepo 본체 무수정).
  const macroState = loadMacroState() as {
    regime?: string;
    fomcPhase?: string;
    vixGatingActive?: boolean;
    programNetBuyAmount?: number;
    programArbitrageNetBuy?: number | null;
    programFetchedAt?: string;
    programSource?: 'KIS_API' | 'NONE';
  } | null;
  const watchlist = loadWatchlist();
  const selected = await selectCandidates({ watchlist }, { forceBuyCodes: params.forceBuyCodes });
  const injected = await injectPerSymbolSupplyContext({
    candidates: selected.buyList,
    investorFlowRouter: createDefaultInvestorFlowRouter(),
  });
  const engineMode = getEmergencyStop()
    ? 'HARD_BLOCK'
    : deriveNormalSupplyPreviewEngineMode({
        sellOnly: getManualBlockNewBuy() || getManualManageOnly(),
        macroGateState: {
          regime: macroState?.regime,
          sellOnlyMode: getManualBlockNewBuy() || getManualManageOnly(),
          bearDefenseMode: macroState?.regime === 'R6_DEFENSE',
          vixGatingActive: macroState?.vixGatingActive === true,
          fomcPhase: macroState?.fomcPhase,
        },
      });

  return persistNormalSupplyPreview({
    engineMode,
    source: 'COMMAND',
    reason: params.reason ?? 'telegram operator normal supply preview',
    candidates: injected.candidates,
    supplyInjection: injected.stats,
    // Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch B carry 격상: 기존 2 필드 inline
    // 객체 → SSOT 위임 (4 필드 모두 carry). ENV `MARKET_PROGRAM_CARRY_WIRING_DISABLED=true`
    // 시 SSOT 가 undefined 반환 → 호출자 자연 fallback (현행 2 필드 carry 와 약간 다른 의미
    // 이지만 default OFF 이므로 즉시 활성. ENV ON 시 marketProgramFlow 인자 미전달 처리되어
    // legacy 2 필드 carry 와 동일하게 normalSupplyPreview 가 extractMarketProgramFlowFromCandidates
    // 또는 latestIntradayProgramFlowSnapshot fallback 으로 대체).
    marketProgramFlow: buildMarketProgramFlowCarryPayload(macroState),
  });
}
