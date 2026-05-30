/**
 * @responsibility PersistScanResultsOptions input contract for scan summary persistence.
 * ADR-0001 scan diagnostics core split.
 */

import type {
  PerSymbolSupplyInjectionStats,
  CandidateSnapshot,
  CandidatePoolInputCandidate,
  CandidatePoolResult,
  MacroGateState,
  ScanEvaluationResult,
  ShadowCandidateScanTrigger,
  FrozenQuoteResult,
  SectorEnergyQualityDiagnostic,
  StreakSkipReason,
} from '../persistScanResultsDependencies.js';

export interface PersistScanResultsOptions {
  sellOnly?: boolean;
  buyListLength: number;
  intradayBuyListLength: number;
  swingListLength: number;
  catalystListLength: number;
  momentumListLength: number;
  perSymbolSupplyInjection?: PerSymbolSupplyInjectionStats;
  /**
   * WIRE_SELECTED_CANDIDATE_ACTUAL_ROW — 이번 스캔 후보 전체의 6-digit 키 aggregate
   * investor-flow map (injectPerSymbolSupplyContext.investorFlowBySymbol). gate1 forensic
   * collector 의 `supplyRouterResult.bySymbol` 에 merge 되어 per-candidate actual row 가
   * snapshot retention/freshness 에 비의존적으로 결정론적 carry 된다. DIAGNOSTIC_ONLY —
   * usableForGate/Live=false, executionImpact='NONE'.
   */
  investorFlowBySymbolCarry?: Record<string, Record<string, unknown>>;
  candidateSnapshots?: CandidateSnapshot[];
  candidatePool?: CandidatePoolResult;
  candidatePoolSourceCandidates?: CandidatePoolInputCandidate[];
  watchlistRefreshedAt?: string;
  watchlistSource?: string;
  macroGateState?: MacroGateState;
  scanEvaluation?: ScanEvaluationResult;
  /**
   * ADR-0528 a1/a2 — 호출자(signalScanner/index.ts) scan-start 에서 1회 산출한 KST asOf ISO.
   * `scanEvaluation` 미전달 시 buildScanEvaluationResult 의 asOf 로 사용 → scanEvaluation.scanId 가
   * 호출자 context.sourceSnapshotId(= buildScanEvaluationId(scanAsOf)) 와 byte-identical 보장.
   * 부재 시 기존 kstNow.toISOString() 자연 fallback (회귀 안전).
   */
  scanAsOf?: string;
  candidateScanTrigger?: ShadowCandidateScanTrigger;
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
  validSectorCount?: number;
  sectorEnergyReasons?: string[];
  /**
   * ADR-0401 — R3 Sanity state machine 의 marketDataFreshness 입력 (옵셔널).
   * 부재 시 'FRESH' 가정 (정상 운영 시 기본 — guards 무영향).
   */
  marketDataFreshness?: 'FRESH' | 'STALE' | 'EXPIRED';
  /**
   * ADR-0401 — volumeClock 진입 허용 여부 (옵셔널).
   * 부재 시 true 가정 (preflight non-abort 경로 도달 = 정상 시간대 추론).
   */
  volumeClockAllowsEntry?: boolean;
  /**
   * ADR-0412 — Frozen Quote Detector 결과 (옵셔널).
   * 호출자 (signalScanner/index.ts) 가 후보 평가 후 합성하여 전달.
   * 부재 시 ScanSummary.frozenQuote 미영속 + R3 guard `frozenQuoteDataQuality=undefined`.
   */
  frozenQuote?: FrozenQuoteResult;
  /**
   * ADR-0423 — SectorEnergy 데이터 진실성 진단 (옵셔널, 후방호환).
   * 호출자 (signalScanner/index.ts 또는 sectorEnergyProvider build site) 가 합성하여 전달.
   * 부재 시 ScanSummary.sectorEnergyQualityDiagnostic 미영속 — 기존 sectorEnergyQuality 라벨만 영속.
   */
  sectorEnergyQualityDiagnostic?: SectorEnergyQualityDiagnostic;
  /**
   * ADR-0412 — R3 streak +1 skip 결정 (옵셔널).
   * 호출자가 `evaluateStreakIncrementAllowed` 결과 그대로 전달.
   * `skipped=true` 시 R3 state machine 분기에서 streak 갱신 호출 자체 skip
   * (영속 무영향 + 24h decay 보존).
   */
  r3StreakSkipped?: { skipped: boolean; reason?: StreakSkipReason };
  /**
   * ADR-0505 — Gate1 Minimum Signal Forensic Audit 입력 (옵셔널, 후방호환).
   *
   * 호출자 (signalScanner/index.ts 또는 entryFilterDecomposition) 가 후보 평가
   * 시 buildMinimumSignalScoreTrace 결과 + 부수 메타 (candidate entry trace /
   * supplyProviderHealth / kisFlow / sectorEnergyImpact) 를 모아 전달.
   *
   * 부재 시 ScanSummary.gate1MinimumSignalForensicAdr0505 미영속 — 기존 ADR-0466
   * positiveScoreStarvation 보고만 유지 (회귀 안전).
   *
   * 본 PR 단계는 dead-code wiring — 호출자 측 입력 collector 는 후속 PR (Phase 1
   * 정합). ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` 1줄 우회.
   */
  gate1ForensicInputs?: ReadonlyArray<{
    trace: import('../../minimumSignalScoreTrace.js').MinimumSignalScoreTrace;
    candidate?: import('../../entryFilterDecomposition.js').CandidateEntryTrace;
    supplyProviderHealth?: Partial<
      import('../../entryFilterDecomposition.js').SupplyProviderHealthTrace
    >;
    supplyConfluence?: import('../../entryFilterDecomposition.js').SupplyConfluenceState;
    kisFlow?: {
      symbol?: string | null;
      foreignNetBuy?: number | null;
      institutionalNetBuy?: number | null;
      programNetBuy?: number | null;
      semanticAvailable?: boolean;
    };
    quoteSymbol?: string | null;
    sectorEnergyImpact?: import(
      '../../../../clients/sectorEnergyExecutionImpact.js'
    ).SectorEnergyExecutionImpactResult;
  }>;
}
