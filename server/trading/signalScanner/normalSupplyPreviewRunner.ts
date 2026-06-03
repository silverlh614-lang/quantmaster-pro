// @responsibility Collect normal-mode supply preview without opening any order path.
import {
  getEmergencyStop,
  getManualBlockNewBuy,
  getManualManageOnly,
} from '../../state.js';
import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { loadWatchlist } from '../../persistence/watchlistRepo.js';
import { loadLatestIntradayProgramFlowSnapshot } from '../../replay/intradayProgramFlowSnapshotRepo.js';
import { selectCandidates } from './candidateSelect.js';
import {
  createDefaultInvestorFlowRouter,
  injectPerSymbolSupplyContext,
  normalizeSupplySymbol,
} from './injectPerSymbolSupplyContext.js';
// Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Branch B: 기존 2 필드 carry (programNetBuyAmount/
// programSource) 를 SSOT 위임으로 격상 → 4 필드 (programArbitrageNetBuy/programFetchedAt
// 추가) 모두 carry. 호출자 측 inline 객체 합성 → SSOT 단일 호출로 drift 차단.
import { buildMarketProgramFlowCarryPayload } from './marketProgramCarryWiringPolicy.js';
import {
  resolveMarketProgramFlow,
  type MarketProgramFlowResult,
} from './marketProgramFlowProvider.js';
// ADR-0557 묶음3 (V3b 소비자 read-site 교체) — 비-스캔(telegram) 경로 진입부 factory 호출(B).
// runner 진입부에서 watchlist 후보 심볼로 collectUnifiedSnapshot 1회 호출해 supply.marketProgram
// 정본을 얻는다. flag(USE_UNIFIED_SOURCE_SNAPSHOT) OFF 시 이 호출을 아예 실행하지 않으므로
// 신규 fetch/quota 순증 0 (byte-equivalent). 정본은 어디에도 보관되지 않고 인자로 흐를 뿐(헌법 §0).
import { collectUnifiedSnapshot } from '../symbolDataCollector.js';
// Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — Producer 측 후보별 stockProgramFlow
// 첨부 SSOT. consumer (`normalSupplyPreview.ts:851`) 가 `candidate.stockProgramFlow` 를
// read-ready 하지만 producer 가 첨부 0건이던 결함 차단. ENV
// `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 동작 100% 복원.
import {
  buildPerStockProgramFlowCarryMap,
  isPerStockProgramFlowCarryWiringDisabled,
  type PerStockProgramFlowCarryPayload,
} from './perStockProgramFlowCarryWiringPolicy.js';
// Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — Producer 측 후보별 sectorClassification
// 첨부 SSOT. WatchlistEntry.sector (Korean displayName) → SectorKey 12-표준 carry. ENV
// `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 동작 100% 복원.
// 사용자 우선순위 #3 — 섹터 분류 carry wiring. sectorEnergyMaster.ts SSOT 본체 무수정
// (read-only consumer + getSectorByAlias 위임). literal type 컴파일 타임 강제 —
// executionImpact='NONE' / providerIssue=false / marketSignal=false TypeScript 차단.
import {
  buildSectorClassificationCarryMap,
  isSectorClassificationCarryWiringDisabled,
  type SectorClassificationCarryPayload,
} from './sectorClassificationCarryWiringPolicy.js';
import {
  deriveNormalSupplyPreviewEngineMode,
  persistNormalSupplyPreview,
  type NormalSupplyPreview,
} from './normalSupplyPreview.js';

export async function collectNormalSupplyPreviewFromWatchlist(params: {
  reason?: string;
  forceBuyCodes?: string[];
  /**
   * ADR-0557 D4 (C — 주입 시그니처): 시장 레벨 program flow 정본(factory 산출)을 호출자가 주입할 수
   * 있는 optional 인자. 기존 타입 MarketProgramFlowResult 재사용(신규 타입/enum 0). present →
   * read-site(:127)가 그것을 정본으로 사용 / absent(undefined) → flag·B 미충족 시 기존 fallback.
   */
  marketProgram?: MarketProgramFlowResult;
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

  // ADR-0557 묶음3 (B — 비-스캔 경로 진입부 factory 호출). 호출자가 정본을 주입(C)하지 않았고
  // USE_UNIFIED_SOURCE_SNAPSHOT flag 가 ON 일 때만, watchlist 후보 심볼로 collectUnifiedSnapshot 을
  // 1회 호출해 snapshot.marketProgram 정본을 얻는다. flag OFF 면 이 분기를 아예 실행하지 않아
  // 신규 fetch/factory 호출 0 → byte-equivalent (read-site :127 가 기존 resolveMarketProgramFlow
  // fallback 유지). flag ON 시 이 factory 1회가 read-site 의 직접 resolveMarketProgramFlow 1회를
  // 대체 — 둘 다 동일 단일 함수(정본)라 quota 순증 0. throw 격리(불변식 #1).
  let injectedMarketProgram: MarketProgramFlowResult | undefined = params.marketProgram;
  if (injectedMarketProgram === undefined && process.env.USE_UNIFIED_SOURCE_SNAPSHOT === 'true') {
    try {
      const buyList: Array<{ code?: unknown }> = Array.isArray(selected.buyList)
        ? (selected.buyList as Array<{ code?: unknown }>)
        : [];
      const candidateSymbols = Array.from(
        new Set(
          buyList
            .map((entry): string => normalizeSupplySymbol(entry.code))
            .filter((symbol): symbol is string => Boolean(symbol)),
        ),
      );
      const snapshot = await collectUnifiedSnapshot(candidateSymbols, {
        scanCycleId: `normal_supply_preview_${Date.now()}`,
      });
      injectedMarketProgram = snapshot.marketProgram;
    } catch {
      // factory/provider 장애는 marketSignal 로 변환하지 않고(불변식 #6) read-site fallback 으로
      // 자연 위임 — 정본 부재 시 기존 resolveMarketProgramFlow 경로 유지(byte-equivalent).
      injectedMarketProgram = undefined;
    }
  }

  const injected = await injectPerSymbolSupplyContext({
    candidates: selected.buyList,
    investorFlowRouter: createDefaultInvestorFlowRouter(),
  });
  // Patch-PER-STOCK-PROGRAM-FLOW-CARRY-WIRING-001 — Producer 측 후보별 stockProgramFlow
  // 첨부. ENV `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED=true` 시 빈 Map 으로 단락
  // → 후보별 첨부 자연 skip (legacy 동작 100% 복원). snapshot 1회 로드 후 symbol-keyed
  // O(1) lookup. CandidateWithSupplyContext 본체 무수정 invariant 정합 — type cast 패턴.
  let perStockProgramFlowMap: Map<string, PerStockProgramFlowCarryPayload> = new Map();
  if (!isPerStockProgramFlowCarryWiringDisabled()) {
    try {
      const snapshot = loadLatestIntradayProgramFlowSnapshot();
      perStockProgramFlowMap = buildPerStockProgramFlowCarryMap(snapshot?.stockRows);
    } catch {
      perStockProgramFlowMap = new Map();
    }
  }
  for (const candidate of injected.candidates) {
    const symbolFromSymbol = normalizeSupplySymbol((candidate as { symbol?: unknown }).symbol);
    const symbolFromCode = normalizeSupplySymbol((candidate as { code?: unknown }).code);
    const symbol = symbolFromSymbol || symbolFromCode;
    if (!symbol) continue;
    const payload = perStockProgramFlowMap.get(symbol);
    if (!payload) continue;
    (candidate as { stockProgramFlow?: PerStockProgramFlowCarryPayload }).stockProgramFlow = payload;
  }
  // Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — Producer 측 후보별 sectorClassification
  // 첨부. WatchlistEntry.sector (한국어 displayName) → SectorKey 12-표준 carry. watchlist 재사용
  // (추가 load 0건). ENV `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED=true` 시 빈 Map 으로
  // 단락 → 후보별 첨부 자연 skip (legacy 동작 100% 복원). sectorEnergyMaster.ts SSOT 본체
  // 무수정 — read-only consumer + getSectorByAlias 위임. CandidateWithSupplyContext 본체
  // 무수정 invariant 정합 — type cast 패턴.
  let sectorClassificationMap: Map<string, SectorClassificationCarryPayload> = new Map();
  if (!isSectorClassificationCarryWiringDisabled()) {
    try {
      sectorClassificationMap = buildSectorClassificationCarryMap(watchlist);
    } catch {
      sectorClassificationMap = new Map();
    }
  }
  for (const candidate of injected.candidates) {
    const symbolFromSymbol = normalizeSupplySymbol((candidate as { symbol?: unknown }).symbol);
    const symbolFromCode = normalizeSupplySymbol((candidate as { code?: unknown }).code);
    const symbol = symbolFromSymbol || symbolFromCode;
    if (!symbol) continue;
    const payload = sectorClassificationMap.get(symbol);
    if (!payload) continue;
    (candidate as { sectorClassification?: SectorClassificationCarryPayload }).sectorClassification = payload;
  }
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

  // ADR-0557 D3 Consumer Contract — (a) 주입(또는 B 산출) 정본 present → 그것을 read (정본 일치
  // 발현, flag ON; provider 재호출 0). (b) absent → 기존 resolveMarketProgramFlow().catch(()=>
  // undefined) fallback (flag OFF byte-equivalent). 정본 값 = 직접호출 값(묶음4 byte-equivalence
  // 증명)이므로 flag ON 결과 불변. dead carry 해소 — factory 의 supply.marketProgram 이 본 소비처에서 read.
  const liveMarketProgramFlow =
    injectedMarketProgram ?? (await resolveMarketProgramFlow().catch(() => undefined));
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
    marketProgramFlow: liveMarketProgramFlow ?? buildMarketProgramFlowCarryPayload(macroState),
    marketProgramCarrySource: macroState,
  });
}
