import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MacroEnvironment, EconomicRegimeData, SmartMoneyData, ExportMomentumData,
  GeopoliticalRiskData, CreditSpreadData, ExtendedRegimeData,
  GlobalCorrelationMatrix, NewsFrequencyScore, ROEType,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex,
  FomcSentimentAnalysis, BearRegimeResult, VkospiTriggerResult, InverseGate1Result,
  MarketNeutralResult, BearScreenerResult, BearKellyResult, BearSeasonalityResult,
  SectorOverheatInput, SectorOverheatResult,
  BearModeSimulatorInput, BearModeSimulatorResult,
  IpsResult,
  FssResult,
  MarketRegimeClassifierInput,
  MarketRegimeClassifierResult,
} from '../types/quant';
import type { MTFConfluenceInput, MTFConfluenceResult } from '../types/technical';
import type { DynamicStopInput, DynamicStopResult } from '../types/sell';
import type { FeedbackLoopResult } from '../types/portfolio';
import type { MHSRecord } from '../components/signals/MHSHistoryChart';
import type { SectorEnergyInput, SectorEnergyResult } from '../types/sectorEnergy';
import type { FlowPredictionInput, FlowPredictionResult } from '../types/flowPrediction';
import type { SatelliteCascaderInput, SatelliteCascaderResult } from '../types/satellite';
import type { BehavioralMirrorInput, BehavioralMirrorResult } from '../types/behavioralMirror';
import type { SystemInterferenceResult } from '../types/interference';
import { buildRegimeContext } from '../services/quant/regimeContext';

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

  // ── 아이디어 11: 계절성 Bear Calendar ───────────────────────────────────
  bearSeasonalityResult: BearSeasonalityResult | null;
  setBearSeasonalityResult: (data: BearSeasonalityResult | null) => void;

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

  // ── 아이디어 11: IPS 통합 변곡점 확률 엔진 ──────────────────────────────
  ipsResult: IpsResult | null;
  setIpsResult: (data: IpsResult | null) => void;

  // ── 아이디어 4: FSS 외국인 수급 방향 전환 스코어 ───────────────────────
  fssResult: FssResult | null;
  setFssResult: (data: FssResult | null) => void;

  // ── 시장 레짐 자동 분류기 (Market Regime Classifier) ─────────────────
  /** 시장 레짐 분류기 입력값 (퍼시스트) */
  marketRegimeClassifierInput: MarketRegimeClassifierInput;
  setMarketRegimeClassifierInput: (input: MarketRegimeClassifierInput) => void;
  /** 시장 레짐 분류기 계산 결과 */
  marketRegimeClassifierResult: MarketRegimeClassifierResult | null;
  setMarketRegimeClassifierResult: (data: MarketRegimeClassifierResult | null) => void;

  // ROE type
  currentRoeType: ROEType;
  setCurrentRoeType: (type: ROEType) => void;
  /** 최근 분기 ROE 유형 이력 (오래된→최신, 최대 8분기) */
  roeTypeHistory: ROEType[];
  setRoeTypeHistory: (history: ROEType[]) => void;
  /** 총자산회전율 이력 (오래된→최신, 최대 8분기) */
  assetTurnoverHistory: number[];
  setAssetTurnoverHistory: (history: number[]) => void;

  // MHS history
  mhsHistory: MHSRecord[];
  setMhsHistory: (records: MHSRecord[]) => void;
  addMhsRecord: (record: MHSRecord) => void;

  // ── MTF Confluence Score (다중 시간 프레임 합치 스코어) ─────────────────────
  /** MTF 입력값 (퍼시스트) */
  mtfConfluenceInput: MTFConfluenceInput;
  setMtfConfluenceInput: (input: MTFConfluenceInput) => void;
  /** MTF 계산 결과 */
  mtfConfluenceResult: MTFConfluenceResult | null;
  setMtfConfluenceResult: (data: MTFConfluenceResult | null) => void;

  // ── Dynamic Stop (변동성 적응형 동적 손절) ─────────────────────────────────
  /** 동적 손절 입력값 (퍼시스트) */
  dynamicStopInput: DynamicStopInput;
  setDynamicStopInput: (input: DynamicStopInput) => void;
  /** 동적 손절 계산 결과 */
  dynamicStopResult: DynamicStopResult | null;
  setDynamicStopResult: (data: DynamicStopResult | null) => void;

  // ── Feedback Closed Loop (피드백 폐쇄 루프) ────────────────────────────────
  /** 피드백 루프 캘리브레이션 결과 */
  feedbackLoopResult: FeedbackLoopResult | null;
  setFeedbackLoopResult: (data: FeedbackLoopResult | null) => void;

  // ── 섹터 에너지 맵 & 로테이션 마스터 게이트 ─────────────────────────────────
  /** 섹터 에너지 입력값 (퍼시스트) */
  sectorEnergyInputs: SectorEnergyInput[];
  setSectorEnergyInputs: (inputs: SectorEnergyInput[]) => void;
  /** 섹터 에너지 계산 결과 */
  sectorEnergyResult: SectorEnergyResult | null;
  setSectorEnergyResult: (data: SectorEnergyResult | null) => void;

  // ── 반실패 패턴 경고 ──────────────────────────────────────────────────────
  /** 현재 스크리닝 종목에 대한 반실패 경고 문자열 (null = 경고 없음) */
  antiFailureWarning: string | null;
  setAntiFailureWarning: (warning: string | null) => void;

  // ── 수급 예측 선행 모델 (Flow Prediction Engine) ─────────────────────────────
  /** 수급 예측 선행 모델 입력값 (퍼시스트) */
  flowPredictionInput: FlowPredictionInput;
  setFlowPredictionInput: (input: FlowPredictionInput) => void;
  /** 수급 예측 선행 모델 계산 결과 */
  flowPredictionResult: FlowPredictionResult | null;
  setFlowPredictionResult: (data: FlowPredictionResult | null) => void;

  // ── 위성 종목 연쇄 추적 시스템 (Satellite Stock Cascader) ────────────────
  /** 위성 종목 추적 입력값 (퍼시스트) */
  satelliteCascaderInput: SatelliteCascaderInput | null;
  setSatelliteCascaderInput: (input: SatelliteCascaderInput | null) => void;
  /** 위성 종목 추적 계산 결과 */
  satelliteCascaderResult: SatelliteCascaderResult | null;
  setSatelliteCascaderResult: (data: SatelliteCascaderResult | null) => void;

  // ── 투자자 행동 교정 미러 대시보드 (Behavioral Mirror Dashboard) ─────────
  /** 행동 교정 미러 입력값 (퍼시스트) */
  behavioralMirrorInput: BehavioralMirrorInput;
  setBehavioralMirrorInput: (input: BehavioralMirrorInput) => void;
  /** 행동 교정 미러 계산 결과 */
  behavioralMirrorResult: BehavioralMirrorResult | null;
  setBehavioralMirrorResult: (data: BehavioralMirrorResult | null) => void;

  // ── 시스템 상호간섭 파라미터 충돌 감지 (System Interference Checker) ──────
  /** 파라미터 충돌 감지 결과 */
  systemInterferenceResult: SystemInterferenceResult | null;
  setSystemInterferenceResult: (data: SystemInterferenceResult | null) => void;

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
      bearSeasonalityResult: null,
      setBearSeasonalityResult: (bearSeasonalityResult) => set({ bearSeasonalityResult }),
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

      ipsResult: null,
      setIpsResult: (ipsResult) => set({ ipsResult }),

      fssResult: null,
      setFssResult: (fssResult) => set({ fssResult }),

      marketRegimeClassifierInput: {
        vkospi: 20,
        foreignNetBuy4wTrend: 0,
        kospiAbove200MA: true,
        dxyDirection: 'FLAT',
      },
      setMarketRegimeClassifierInput: (marketRegimeClassifierInput) => set({ marketRegimeClassifierInput }),
      marketRegimeClassifierResult: null,
      // RegimeContext SSoT — 분류 결과를 set 할 때 dynamicStopInput.regime 도 자동 동기화.
      // 어떤 호출 경로로 진입하더라도 두 값이 발산할 수 없게 한다.
      setMarketRegimeClassifierResult: (marketRegimeClassifierResult) => set((state) => {
        if (!marketRegimeClassifierResult) return { marketRegimeClassifierResult };
        const ctx = buildRegimeContext(marketRegimeClassifierResult);
        return state.dynamicStopInput.regime === ctx.dynamicStopRegime
          ? { marketRegimeClassifierResult }
          : {
              marketRegimeClassifierResult,
              dynamicStopInput: { ...state.dynamicStopInput, regime: ctx.dynamicStopRegime },
            };
      }),

      currentRoeType: 3,
      setCurrentRoeType: (currentRoeType) => set({ currentRoeType }),
      roeTypeHistory: [3, 3, 3],
      setRoeTypeHistory: (roeTypeHistory) => set({ roeTypeHistory: roeTypeHistory.slice(-8) }),
      assetTurnoverHistory: [],
      setAssetTurnoverHistory: (assetTurnoverHistory) => set({ assetTurnoverHistory: assetTurnoverHistory.slice(-8) }),

      mhsHistory: [],
      setMhsHistory: (mhsHistory) => set({ mhsHistory }),
      addMhsRecord: (record) => set((state) => {
        const existing = state.mhsHistory.findIndex(r => r.date === record.date);
        const updated = [...state.mhsHistory];
        if (existing >= 0) updated[existing] = record;
        else updated.push(record);
        return { mhsHistory: updated.slice(-365) };
      }),

      // ── MTF Confluence
      mtfConfluenceInput: {
        monthlyAboveMa60: true,
        monthlyMa60TrendUp: true,
        weeklyRsi: 55,
        weeklyMacdHistogramPositive: true,
        weeklyBreakoutConfirmed: false,
        dailyGoldenCross: true,
        dailyRsiHealthy: true,
        dailyGateSignal: false,
        h60MomentumUp: true,
        h60VolumeSurge: false,
      },
      setMtfConfluenceInput: (mtfConfluenceInput) => set({ mtfConfluenceInput }),
      mtfConfluenceResult: null,
      setMtfConfluenceResult: (mtfConfluenceResult) => set({ mtfConfluenceResult }),

      // ── Dynamic Stop
      dynamicStopInput: {
        entryPrice: 50000,
        atr14: 1500,
        regime: 'RISK_ON',
        currentPrice: 50000,
      },
      setDynamicStopInput: (dynamicStopInput) => set({ dynamicStopInput }),
      dynamicStopResult: null,
      setDynamicStopResult: (dynamicStopResult) => set({ dynamicStopResult }),

      // ── Feedback Loop
      feedbackLoopResult: null,
      setFeedbackLoopResult: (feedbackLoopResult) => set({ feedbackLoopResult }),

      // ── 섹터 에너지 맵
      sectorEnergyInputs: [
        { name: '반도체',          return4w: 5.0, volumeChangePct: 10.0, foreignConcentration: 60 },
        { name: '이차전지',        return4w: 2.0, volumeChangePct: 5.0,  foreignConcentration: 40 },
        { name: '바이오/헬스케어', return4w: 3.0, volumeChangePct: 8.0,  foreignConcentration: 35 },
        { name: '인터넷/플랫폼',   return4w: 1.0, volumeChangePct: 3.0,  foreignConcentration: 30 },
        { name: '자동차',          return4w: 4.0, volumeChangePct: 6.0,  foreignConcentration: 50 },
        { name: '조선',            return4w: 6.0, volumeChangePct: 12.0, foreignConcentration: 45 },
        { name: '방산',            return4w: 7.0, volumeChangePct: 15.0, foreignConcentration: 55 },
        { name: '금융',            return4w: 0.5, volumeChangePct: 2.0,  foreignConcentration: 25 },
        { name: '유통/소비재',     return4w: -1.0, volumeChangePct: -5.0, foreignConcentration: 15 },
        { name: '건설/부동산',     return4w: -2.0, volumeChangePct: -8.0, foreignConcentration: 10 },
        { name: '에너지/화학',     return4w: 1.5, volumeChangePct: 4.0,  foreignConcentration: 28 },
        { name: '통신/유틸리티',   return4w: -0.5, volumeChangePct: 1.0, foreignConcentration: 20 },
      ],
      setSectorEnergyInputs: (sectorEnergyInputs) => set({ sectorEnergyInputs }),
      sectorEnergyResult: null,
      setSectorEnergyResult: (sectorEnergyResult) => set({ sectorEnergyResult }),

      // ── 반실패 패턴
      antiFailureWarning: null,
      setAntiFailureWarning: (antiFailureWarning) => set({ antiFailureWarning }),

      // ── 수급 예측 선행 모델
      flowPredictionInput: {
        recentVolume5dAvg: 500000,
        avgVolume20d: 1000000,
        bidAskSpreadRatio: 0.002,
        programNonArbitrageNetBuy: 50,
        foreignOwnershipRatio: 12,
        foreignOwnershipThreshold: 15,
        foreignNetBuy5d: 100000,
        institutionalNetBuy5d: 50000,
        fundamentalScore: 70,
        distortionSchedules: [],
      },
      setFlowPredictionInput: (flowPredictionInput) => set({ flowPredictionInput }),
      flowPredictionResult: null,
      setFlowPredictionResult: (flowPredictionResult) => set({ flowPredictionResult }),

      // ── 위성 종목 연쇄 추적 시스템
      satelliteCascaderInput: null,
      setSatelliteCascaderInput: (satelliteCascaderInput) => set({ satelliteCascaderInput }),
      satelliteCascaderResult: null,
      setSatelliteCascaderResult: (satelliteCascaderResult) => set({ satelliteCascaderResult }),

      // ── 투자자 행동 교정 미러 대시보드
      behavioralMirrorInput: {
        currentRegime: 'BULL',
        openPositions: [],
        upcomingEvents: [],
      },
      setBehavioralMirrorInput: (behavioralMirrorInput) => set({ behavioralMirrorInput }),
      behavioralMirrorResult: null,
      setBehavioralMirrorResult: (behavioralMirrorResult) => set({ behavioralMirrorResult }),

      // ── 시스템 상호간섭 파라미터 충돌 감지
      systemInterferenceResult: null,
      setSystemInterferenceResult: (systemInterferenceResult) => set({ systemInterferenceResult }),

      setAllMacroData: (data) => set(data as any),
    }),
    {
      name: 'k-stock-global-intel',
      partialize: (state) => ({
        mhsHistory: state.mhsHistory,
        currentRoeType: state.currentRoeType,
        roeTypeHistory: state.roeTypeHistory,
        assetTurnoverHistory: state.assetTurnoverHistory,
        exportRatio: state.exportRatio,
        bearKellyEntryDate: state.bearKellyEntryDate,
        sectorOverheatInputs: state.sectorOverheatInputs,
        bearModeSimulatorInputs: state.bearModeSimulatorInputs,
        marketRegimeClassifierInput: state.marketRegimeClassifierInput,
        mtfConfluenceInput: state.mtfConfluenceInput,
        dynamicStopInput: state.dynamicStopInput,
        sectorEnergyInputs: state.sectorEnergyInputs,
        flowPredictionInput: state.flowPredictionInput,
        satelliteCascaderInput: state.satelliteCascaderInput,
        behavioralMirrorInput: state.behavioralMirrorInput,
      }),
    }
  )
);
