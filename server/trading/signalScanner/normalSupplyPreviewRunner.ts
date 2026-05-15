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
import {
  deriveNormalSupplyPreviewEngineMode,
  persistNormalSupplyPreview,
  type NormalSupplyPreview,
} from './normalSupplyPreview.js';

export async function collectNormalSupplyPreviewFromWatchlist(params: {
  reason?: string;
  forceBuyCodes?: string[];
} = {}): Promise<NormalSupplyPreview> {
  const macroState = loadMacroState() as {
    regime?: string;
    fomcPhase?: string;
    vixGatingActive?: boolean;
    programNetBuyAmount?: number;
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
    marketProgramFlow: macroState
      ? {
          marketProgramNetBuy: macroState.programNetBuyAmount,
          sourceProvider: macroState.programSource ?? 'NONE',
          providerIssue: macroState.programSource === 'NONE',
        }
      : undefined,
  });
}
