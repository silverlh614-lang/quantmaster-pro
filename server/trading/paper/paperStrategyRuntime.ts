// @responsibility Isolate strategy persistence failures from baseline sampling.
import type { PaperExperiment, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperKrxListingStatus, PaperStrategyLedger, PaperStrategyScanResult, PaperStrategyTrade, PaperTradeMeasurementRow } from '../../../src/types/paperStrategy.js';
import { loadPaperStrategyLedger, savePaperStrategyLedger } from '../../persistence/paperStrategyRepo.js';
import { getKrxMasterMetadata, getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import { capturePaperCostModel, trimArchivedEntryBars } from './paperExperimentPolicy.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan, evaluatePaperHoldingPrices } from './paperStrategyPolicy.js';
import { getArchivedPaperBarCheck } from './paperResearchRuntime.js';
import { buildPaperStrategySelection } from './paperStrategySelection.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { capturePaperTradeMeasurements } from './paperTradeMeasurements.js';
import { assertPaperTradeMeasurement } from './paperTradeMeasurementValidation.js';
import { savePaperTradeMeasurementBatch, recordPaperTradeMeasurementFailure, readPaperTradeMeasurementHistory } from '../../persistence/paperTradeMeasurementRepo.js';
import { capturePaperMorningSource, capturePaperMorningTracking, linkPaperMorningRecommendations } from './paperMorningRuntime.js';
import { queuePaperProgramResearch, readPaperProgramProposals, readPaperProgramResearch } from './paperProgramResearch.js';
import { captureVirtualAccount } from './paperAccountRuntime.js';

export interface PaperStrategyState { ledger: PaperStrategyLedger | null; error?: string }
let lastFailure: string | undefined;
/** KOSPI and KOSDAQ together list well over this; a smaller master is a failed download, not mass delisting. */
const KRX_LISTING_MINIMUM = 2000;

export function loadPaperStrategyState(): PaperStrategyState {
  try {
    return { ledger: loadPaperStrategyLedger() };
  } catch (error) {
    return { ledger: null, error: `전략 기록을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function advancePaperStrategy(
  state: PaperStrategyState, experiments: PaperExperiment[], snapshot: PaperSnapshot,
): PaperStrategyScanResult {
  try {
    if (!state.ledger) throw new Error(state.error ?? '전략 기록 없음');
    const ledger = snapshot.quoteOnly ? evaluatePaperHoldingPrices(state.ledger, snapshot)
      : evaluatePaperStrategyScan(state.ledger, snapshot, (symbol) =>
        capturePaperCostModel(getStockByCode(symbol)?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'),
      selectPaperAdaptiveState(state.ledger.adaptive, experiments, snapshot.asOf, snapshot.observations, readPaperProgramProposals(), state.ledger.trades));
    const archived = getArchivedPaperBarCheck();
    if (archived) ledger.trades = ledger.trades.map((trade) => {
      const entryObservation = trimArchivedEntryBars(trade.entryObservation, trade.tradingDate, archived);
      return entryObservation === trade.entryObservation ? trade : { ...trade, entryObservation };
    });
    linkPaperMorningRecommendations(ledger, snapshot);
    const previousMeasurements = ledger.trades.map(trade => trade.measurement);
    let rows: PaperTradeMeasurementRow[] = [], measurementError: unknown;
    try {
      rows = capturePaperTradeMeasurements(ledger, snapshot);
      for (const trade of ledger.trades) if (trade.measurement) assertPaperTradeMeasurement(trade, snapshot.asOf);
    } catch (error) {
      // SDS-ignore: recordPaperTradeMeasurementFailure logs and persists this after the core commit.
      measurementError = error;
      ledger.trades.forEach((trade, index) => {
        if (previousMeasurements[index]) trade.measurement = previousMeasurements[index];
        else delete trade.measurement;
      });
    }
    savePaperStrategyLedger(ledger);
    captureVirtualAccount(ledger, snapshot);
    capturePaperMorningTracking(ledger, snapshot);
    if (!snapshot.quoteOnly) capturePaperMorningSource(ledger, snapshot);
    if (measurementError) recordPaperTradeMeasurementFailure(snapshot.id, snapshot.asOf, 0, measurementError, ledger.trades);
    else if (rows.length) {
      try { savePaperTradeMeasurementBatch(rows, ledger.trades); }
      catch (error) {
        // SDS-ignore: this helper logs and persists the failure without cancelling committed trades.
        recordPaperTradeMeasurementFailure(snapshot.id, snapshot.asOf, rows.length, error, ledger.trades);
      }
    }
    lastFailure = undefined;
    if (!snapshot.quoteOnly && ledger.adaptive) void queuePaperProgramResearch(ledger.adaptive, { asOf: snapshot.asOf, marketOpen: snapshot.marketOpen });
    return ledger.lastRun!;
  } catch (error) {
    lastFailure = `전략 처리 실패 · 기준 실험은 계속됩니다: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[PaperStrategy]', lastFailure);
    return { snapshotId: snapshot.id, asOf: snapshot.asOf, openedCount: 0, closedCount: 0, waitingCount: 0, holdingCount: 0, error: lastFailure };
  }
}

function readKrxListing(): PaperKrxListingStatus | null {
  try {
    const master = getKrxMasterMetadata();
    const at = master.last_full_master_refresh_at;
    const refreshedAt = master.raw_krx_master_total && typeof at === 'number' && Number.isFinite(at) ? new Date(at).toISOString() : null;
    return { refreshedAt, total: master.raw_krx_master_total, partial: master.is_partial, stale: master.stale,
      usable: !master.is_partial && !master.stale && master.raw_krx_master_total >= KRX_LISTING_MINIMUM };
  } catch (error) {
    console.warn('[PaperStrategy] KRX 종목 목록 확인 실패 · 상장폐지 판정 생략:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Only a complete, fresh KRX listing may call a stock delisted; anything else leaves the judgement out. */
const krxListingCheck = (listing: PaperKrxListingStatus | null) => listing?.usable
  ? (symbol: string) => getStockByCode(symbol) !== null : undefined;

export function readPaperStrategyView(includeAllRecords = false, experiments?: PaperExperiment[], state = loadPaperStrategyState()) {
  const ledger: PaperStrategyLedger = state.ledger ?? { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null };
  const krxListing = readKrxListing();
  const view = buildPaperStrategyView(ledger, state.error ?? lastFailure, krxListingCheck(krxListing));
  view.krxListing = krxListing;
  if (view.adaptive) view.adaptive = { ...view.adaptive, programResearch: readPaperProgramResearch(view.adaptive) };
  view.measurementHistory = readPaperTradeMeasurementHistory(ledger);
  if (includeAllRecords) view.trades = [...ledger.trades].reverse();
  if (experiments && state.ledger) view.selection = buildPaperStrategySelection(ledger.trades, experiments);
  return view;
}

/** Full records for one screen page; unknown IDs are omitted rather than invented. */
export function readPaperStrategyTrades(ids: readonly string[], state = loadPaperStrategyState()): PaperStrategyTrade[] {
  if (!state.ledger) throw new Error(state.error ?? '전략 기록 없음');
  const trades = new Map(state.ledger.trades.map(trade => [trade.id, trade]));
  return ids.flatMap(id => trades.get(id) ?? []);
}
