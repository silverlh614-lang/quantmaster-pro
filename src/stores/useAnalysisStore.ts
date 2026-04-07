import { create } from 'zustand';
import type { StockRecommendation } from '../services/stockService';
type Updater<T> = T | ((prev: T) => T);

interface AnalysisState {
  // Deep Analysis
  deepAnalysisStock: StockRecommendation | null;
  setDeepAnalysisStock: (v: Updater<StockRecommendation | null>) => void;
  selectedDetailStock: StockRecommendation | null;
  setSelectedDetailStock: (stock: StockRecommendation | null) => void;
  analysisView: 'STANDARD' | 'QUANT';
  setAnalysisView: (view: 'STANDARD' | 'QUANT') => void;

  // Weekly RSI
  weeklyRsiValues: number[];
  setWeeklyRsiValues: (values: number[]) => void;

  // Report / Export
  reportSummary: string | null;
  setReportSummary: (summary: string | null) => void;
  isSummarizing: boolean;
  setIsSummarizing: (summarizing: boolean) => void;
  isGeneratingPDF: boolean;
  setIsGeneratingPDF: (generating: boolean) => void;
  isExportingDeepAnalysis: boolean;
  setIsExportingDeepAnalysis: (exporting: boolean) => void;
  isSendingEmail: boolean;
  setIsSendingEmail: (sending: boolean) => void;
}

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  // Deep Analysis
  deepAnalysisStock: null,
  setDeepAnalysisStock: (v) => set((s) => ({ deepAnalysisStock: typeof v === 'function' ? v(s.deepAnalysisStock) : v })),
  selectedDetailStock: null,
  setSelectedDetailStock: (selectedDetailStock) => set({ selectedDetailStock }),
  analysisView: 'STANDARD',
  setAnalysisView: (analysisView) => set({ analysisView }),

  // Weekly RSI
  weeklyRsiValues: [],
  setWeeklyRsiValues: (weeklyRsiValues) => set({ weeklyRsiValues }),

  // Report / Export
  reportSummary: null,
  setReportSummary: (reportSummary) => set({ reportSummary }),
  isSummarizing: false,
  setIsSummarizing: (isSummarizing) => set({ isSummarizing }),
  isGeneratingPDF: false,
  setIsGeneratingPDF: (isGeneratingPDF) => set({ isGeneratingPDF }),
  isExportingDeepAnalysis: false,
  setIsExportingDeepAnalysis: (isExportingDeepAnalysis) => set({ isExportingDeepAnalysis }),
  isSendingEmail: false,
  setIsSendingEmail: (isSendingEmail) => set({ isSendingEmail }),
}));
