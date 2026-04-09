import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MacroEnvironment, EconomicRegimeData, SmartMoneyData, ExportMomentumData,
  GeopoliticalRiskData, CreditSpreadData, ExtendedRegimeData,
  GlobalCorrelationMatrix, NewsFrequencyScore, ROEType,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex,
  FomcSentimentAnalysis, BearRegimeResult, VkospiTriggerResult, InverseGate1Result,
  MarketNeutralResult,
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

  // ── 아이디어 4: VKOSPI 트리거 시스템 ────────────────────────────────────
  vkospiTriggerResult: VkospiTriggerResult | null;
  setVkospiTriggerResult: (data: VkospiTriggerResult | null) => void;

  // ── 아이디어 9: Market Neutral 모드 ─────────────────────────────────────
  marketNeutralResult: MarketNeutralResult | null;
  setMarketNeutralResult: (data: MarketNeutralResult | null) => void;

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
      vkospiTriggerResult: null,
      setVkospiTriggerResult: (vkospiTriggerResult) => set({ vkospiTriggerResult }),
      marketNeutralResult: null,
      setMarketNeutralResult: (marketNeutralResult) => set({ marketNeutralResult }),

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
      }),
    }
  )
);
