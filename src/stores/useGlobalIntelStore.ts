import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MacroEnvironment, EconomicRegimeData, SmartMoneyData, ExportMomentumData,
  GeopoliticalRiskData, CreditSpreadData, ExtendedRegimeData,
  GlobalCorrelationMatrix, NewsFrequencyScore, ROEType,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex,
  FomcSentimentAnalysis,
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
