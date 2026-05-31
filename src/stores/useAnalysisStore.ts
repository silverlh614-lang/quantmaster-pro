// @responsibility useAnalysisStore Zustand store
import { create } from 'zustand';
import type { StockRecommendation } from '../services/stockService';
type Updater<T> = T | ((prev: T) => T);

interface AnalysisState {
  // Deep Analysis
  deepAnalysisStock: StockRecommendation | null;
  setDeepAnalysisStock: (v: Updater<StockRecommendation | null>) => void;
  selectedDetailStock: StockRecommendation | null;
  setSelectedDetailStock: (stock: StockRecommendation | null) => void;
  /** 상세 모달 좌우 스와이프 탐색용 — 현재 화면의 정렬된 후보 리스트(페이지가 동기화). */
  detailNavList: StockRecommendation[];
  setDetailNavList: (list: StockRecommendation[]) => void;
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
  detailNavList: [],
  setDetailNavList: (detailNavList) => set({ detailNavList }),
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
