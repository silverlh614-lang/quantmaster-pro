import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MacroEnvironment, EconomicRegimeData, SmartMoneyData, ExportMomentumData,
  GeopoliticalRiskData, CreditSpreadData, ExtendedRegimeData,
  GlobalCorrelationMatrix, NewsFrequencyScore, ROEType,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex,
  FomcSentimentAnalysis, BearRegimeResult, VkospiTriggerResult, InverseGate1Result,
  MarketNeutralResult, BearScreenerResult, BearKellyResult,
  SectorOverheatInput, SectorOverheatResult,
  BearModeSimulatorInput, BearModeSimulatorResult,
  BearSeasonalCalendarResult,
} from '../types/quant';
import type { MHSRecord } from '../components/MHSHistoryChart';

interface GlobalIntelState {
  // Core macro
  macroEnv: MacroEnvironment | null;
  setMacroEnv: (data: MacroEnvironment | null) => void;
  exportRatio: number;
  setExportRatio: (ratio: number) => void;

  // Economic regime
  economicRegimeData: EconomicRegimeData | null;
  setEconomicRegimeData: (data: EconomicRegimeData | null) => void;
  extendedRegimeData: ExtendedRegimeData | null;
  setExtendedRegimeData: (data: ExtendedRegimeData | null) => void;

  // Advanced macro layers
  smartMoneyData: SmartMoneyData | null;
  setSmartMoneyData: (data: SmartMoneyData | null) => void;
  exportMomentumData: ExportMomentumData | null;
  setExportMomentumData: (data: ExportMomentumData | null) => void;
  geoRiskData: GeopoliticalRiskData | null;
  setGeoRiskData: (data: GeopoliticalRiskData | null) => void;
  creditSpreadData: CreditSpreadData | null;
  setCreditSpreadData: (data: CreditSpreadData | null) => void;
  globalCorrelation: GlobalCorrelationMatrix | null;
  setGlobalCorrelation: (data: GlobalCorrelationMatrix | null) => void;
  newsFrequencyScores: NewsFrequencyScore[];
  setNewsFrequencyScores: (data: NewsFrequencyScore[]) => void;

  // Layers I-L
  supplyChainData: SupplyChainIntelligence | null;
  setSupplyChainData: (data: SupplyChainIntelligence | null) => void;
  sectorOrderData: SectorOrderIntelligence | null;
  setSectorOrderData: (data: SectorOrderIntelligence | null) => void;
  financialStressData: FinancialStressIndex | null;
  setFinancialStressData: (data: FinancialStressIndex | null) => void;
  fomcSentimentData: FomcSentimentAnalysis | null;
  setFomcSentimentData: (data: FomcSentimentAnalysis | null) => void;

  // ── 아이디어 1: Gate -1 Bear Regime Detector ────────────────────────────
  bearRegimeResult: BearRegimeResult | null;
  setBearRegimeResult: (data: BearRegimeResult | null) => void;

  // ── 아이디어 2: Inverse Gate 1 인버스 ETF 스코어링 시스템 ────────────────
  inverseGate1Result: InverseGate1Result | null;
  setInverseGate1Result: (data: InverseGate1Result | null) => void;

  // ── 아이디어 3: Bear Screener — 하락 수혜주 자동 탐색 ───────────────────
  bearScreenerResult: BearScreenerResult | null;
  setBearScreenerResult: (data: BearScreenerResult | null) => void;

  // ── 아이디어 4: VKOSPI 트리거 시스템 ────────────────────────────────────
  vkospiTriggerResult: VkospiTriggerResult | null;
  setVkospiTriggerResult: (data: VkospiTriggerResult | null) => void;

  // ── 아이디어 9: Market Neutral 모드 ─────────────────────────────────────
  marketNeutralResult: MarketNeutralResult | null;
  setMarketNeutralResult: (data: MarketNeutralResult | null) => void;

  // ── 아이디어 6: Bear Mode Kelly Criterion ────────────────────────────────
  bearKellyResult: BearKellyResult | null;
  setBearKellyResult: (data: BearKellyResult | null) => void;
  /** 인버스 ETF 포지션 진입일 (ISO 날짜 문자열, null이면 미진입) */
  bearKellyEntryDate: string | null;
  setBearKellyEntryDate: (date: string | null) => void;

  // ── 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭 ────────────────────
  /** 섹터별 과열 감지 입력값 (퍼시스트) */
  sectorOverheatInputs: SectorOverheatInput[];
  setSectorOverheatInputs: (inputs: SectorOverheatInput[]) => void;
  /** 섹터 과열 감지 계산 결과 */
  sectorOverheatResult: SectorOverheatResult | null;
  setSectorOverheatResult: (data: SectorOverheatResult | null) => void;

  // ── 아이디어 8: Bear Mode 손익 시뮬레이터 ────────────────────────────────
  /** Bear Mode 시뮬레이터 시나리오 입력값 (퍼시스트) */
  bearModeSimulatorInputs: BearModeSimulatorInput[];
  setBearModeSimulatorInputs: (inputs: BearModeSimulatorInput[]) => void;
  /** Bear Mode 시뮬레이터 계산 결과 */
  bearModeSimulatorResult: BearModeSimulatorResult | null;
  setBearModeSimulatorResult: (data: BearModeSimulatorResult | null) => void;

  // ── 아이디어 11: 계절성 Bear Calendar ──────────────────────────────────────
  /** 계절성 Bear Calendar 계산 결과 */
  bearSeasonalCalendarResult: BearSeasonalCalendarResult | null;
  setBearSeasonalCalendarResult: (data: BearSeasonalCalendarResult | null) => void;
  /** FOMC_WATCH 시즌 활성화용 다음 FOMC 날짜 (ISO 날짜 문자열, 없으면 null, 퍼시스트) */
  nextFomcDate: string | null;
  setNextFomcDate: (date: string | null) => void;

  // ROE type
  currentRoeType: ROEType;
  setCurrentRoeType: (type: ROEType) => void;

  // MHS history
  mhsHistory: MHSRecord[];
  setMhsHistory: (records: MHSRecord[]) => void;
  addMhsRecord: (record: MHSRecord) => void;

  // Bulk setter for initial load
  setAllMacroData: (data: Partial<GlobalIntelState>) => void;
}

export const useGlobalIntelStore = create<GlobalIntelState>()(
  persist(
    (set) => ({
      macroEnv: null,
      setMacroEnv: (macroEnv) => set({ macroEnv }),
      exportRatio: 50,
      setExportRatio: (exportRatio) => set({ exportRatio }),

      economicRegimeData: null,
      setEconomicRegimeData: (economicRegimeData) => set({ economicRegimeData }),
      extendedRegimeData: null,
      setExtendedRegimeData: (extendedRegimeData) => set({ extendedRegimeData }),

      smartMoneyData: null,
      setSmartMoneyData: (smartMoneyData) => set({ smartMoneyData }),
      exportMomentumData: null,
      setExportMomentumData: (exportMomentumData) => set({ exportMomentumData }),
      geoRiskData: null,
      setGeoRiskData: (geoRiskData) => set({ geoRiskData }),
      creditSpreadData: null,
      setCreditSpreadData: (creditSpreadData) => set({ creditSpreadData }),
      globalCorrelation: null,
      setGlobalCorrelation: (globalCorrelation) => set({ globalCorrelation }),
      newsFrequencyScores: [],
      setNewsFrequencyScores: (newsFrequencyScores) => set({ newsFrequencyScores }),

      supplyChainData: null,
      setSupplyChainData: (supplyChainData) => set({ supplyChainData }),
      sectorOrderData: null,
      setSectorOrderData: (sectorOrderData) => set({ sectorOrderData }),
      financialStressData: null,
      setFinancialStressData: (financialStressData) => set({ financialStressData }),
      fomcSentimentData: null,
      setFomcSentimentData: (fomcSentimentData) => set({ fomcSentimentData }),

      bearRegimeResult: null,
      setBearRegimeResult: (bearRegimeResult) => set({ bearRegimeResult }),
      inverseGate1Result: null,
      setInverseGate1Result: (inverseGate1Result) => set({ inverseGate1Result }),
      bearScreenerResult: null,
      setBearScreenerResult: (bearScreenerResult) => set({ bearScreenerResult }),
      vkospiTriggerResult: null,
      setVkospiTriggerResult: (vkospiTriggerResult) => set({ vkospiTriggerResult }),
      marketNeutralResult: null,
      setMarketNeutralResult: (marketNeutralResult) => set({ marketNeutralResult }),

      bearKellyResult: null,
      setBearKellyResult: (bearKellyResult) => set({ bearKellyResult }),
      bearKellyEntryDate: null,
      setBearKellyEntryDate: (bearKellyEntryDate) => set({ bearKellyEntryDate }),

      sectorOverheatInputs: [
        { name: '반도체', sectorRsRank: 10, newsPhase: 'GROWING', weeklyRsi: 65, foreignActiveBuyingWeeks: 3 },
        { name: '이차전지', sectorRsRank: 10, newsPhase: 'GROWING', weeklyRsi: 65, foreignActiveBuyingWeeks: 3 },
        { name: '조선', sectorRsRank: 10, newsPhase: 'GROWING', weeklyRsi: 65, foreignActiveBuyingWeeks: 3 },
      ],
      setSectorOverheatInputs: (sectorOverheatInputs) => set({ sectorOverheatInputs }),
      sectorOverheatResult: null,
      setSectorOverheatResult: (sectorOverheatResult) => set({ sectorOverheatResult }),

      bearModeSimulatorInputs: [
        {
          label: '2024 하락장 시뮬레이션',
          bearStartDate: '2024-07-01',
          gateDetectionDate: '2024-07-05',
          bearEndDate: '2024-08-05',
          longPortfolioReturn: -12.3,
          marketReturn: -10.5,
        },
      ],
      setBearModeSimulatorInputs: (bearModeSimulatorInputs) => set({ bearModeSimulatorInputs }),
      bearModeSimulatorResult: null,
      setBearModeSimulatorResult: (bearModeSimulatorResult) => set({ bearModeSimulatorResult }),

      bearSeasonalCalendarResult: null,
      setBearSeasonalCalendarResult: (bearSeasonalCalendarResult) => set({ bearSeasonalCalendarResult }),
      nextFomcDate: null,
      setNextFomcDate: (nextFomcDate) => set({ nextFomcDate }),

      currentRoeType: 3,
      setCurrentRoeType: (currentRoeType) => set({ currentRoeType }),

      mhsHistory: [],
      setMhsHistory: (mhsHistory) => set({ mhsHistory }),
      addMhsRecord: (record) => set((state) => {
        const existing = state.mhsHistory.findIndex(r => r.date === record.date);
        const updated = [...state.mhsHistory];
        if (existing >= 0) updated[existing] = record;
        else updated.push(record);
        return { mhsHistory: updated.slice(-365) };
      }),

      setAllMacroData: (data) => set(data as any),
    }),
    {
      name: 'k-stock-global-intel',
      partialize: (state) => ({
        mhsHistory: state.mhsHistory,
        currentRoeType: state.currentRoeType,
        exportRatio: state.exportRatio,
        bearKellyEntryDate: state.bearKellyEntryDate,
        sectorOverheatInputs: state.sectorOverheatInputs,
        bearModeSimulatorInputs: state.bearModeSimulatorInputs,
        nextFomcDate: state.nextFomcDate,
      }),
    }
  )
);

