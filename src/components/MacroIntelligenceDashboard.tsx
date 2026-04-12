import React, { useMemo, useCallback } from 'react';
import {
  Gate0Result, ROEType,
  EconomicRegimeData, SupplyChainIntelligence, SectorOrderIntelligence,
  FinancialStressIndex, FomcSentimentAnalysis,
} from '../types/quant';
import { evaluateSectorOverheat } from '../services/quant/sectorEngine';
import { evaluateBearModeSimulator } from '../services/quant/bearEngine';
import { evaluateMAPCResult } from '../services/quant/gateEngine';
import { evaluateMarketRegimeClassifier } from '../services/quant/marketRegimeClassifier';
import { evaluateMTFConfluence } from '../services/quant/mtfEngine';
import { evaluateDynamicStop } from '../services/quant/dynamicStopEngine';
import { evaluateFeedbackLoop } from '../services/quant/feedbackLoopEngine';
import { evaluateSectorEnergy } from '../services/quant/sectorEnergyEngine';
import { evaluateFlowPrediction } from '../services/quant/flowPredictionEngine';
import { useGlobalIntelStore } from '../stores/useGlobalIntelStore';
import { useTradeStore } from '../stores/useTradeStore';
import { getEvolutionWeightsFromPerformance } from '../services/quant/evolutionEngine';
import { BearKellyPanel } from './BearKellyPanel';
import { SectorOverheatPanel } from './SectorOverheatPanel';
import { BearModeSimulatorPanel } from './BearModeSimulatorPanel';
import { IPSPanel } from './IPSPanel';
import { FSSPanel } from './FSSPanel';
import { MAPCPanel } from './MAPCPanel';
import { MarketRegimeClassifierPanel } from './MarketRegimeClassifierPanel';
import { PositionLifecyclePanel } from './PositionLifecyclePanel';
import { MTFConfluencePanel } from './MTFConfluencePanel';
import { DynamicStopPanel } from './DynamicStopPanel';
import { FeedbackLoopPanel } from './FeedbackLoopPanel';
import { SectorEnergyPanel } from './SectorEnergyPanel';
import { DartIntelPanel } from './DartIntelPanel';
import { AntiFailurePanel } from './AntiFailurePanel';
import { FlowPredictionPanel } from './FlowPredictionPanel';
import { RegimeGaugeSection } from './macro/RegimeGaugeSection';
import { BearRegimeSection } from './macro/BearRegimeSection';
import { MarketOverviewSection } from './macro/MarketOverviewSection';
import { SmartMoneySection } from './macro/SmartMoneySection';
import { ExportMomentumSection } from './macro/ExportMomentumSection';
import { GeoRiskSection } from './macro/GeoRiskSection';
import { CreditSpreadSection } from './macro/CreditSpreadSection';
import { ContrarianSection } from './macro/ContrarianSection';
import { FusionMatrixSection } from './macro/FusionMatrixSection';
import { GlobalIntelSection } from './macro/GlobalIntelSection';

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  gate0Result?: Gate0Result;
  currentRoeType?: ROEType;
  marketOverview?: {
    sectorRotation?: Array<{ sector: string; momentum: number; flow: string }>;
    globalEtfMonitoring?: Array<{ name: string; flow: string; change: number }>;
    exchangeRates?: Array<{ name: string; value: number; change: number }>;
  };
  // External data accepted for API compatibility; regime is forwarded to RegimeGaugeSection
  externalRegime?: EconomicRegimeData;
  externalSupplyChain?: SupplyChainIntelligence;
  externalSectorOrders?: SectorOrderIntelligence;
  externalFsi?: FinancialStressIndex;
  externalFomcSentiment?: FomcSentimentAnalysis;
}

export const MacroIntelligenceDashboard: React.FC<Props> = ({
  gate0Result,
  currentRoeType = 3,
  marketOverview,
  externalRegime,
}) => {
  const bearKellyResult = useGlobalIntelStore(s => s.bearKellyResult);
  const bearKellyEntryDate = useGlobalIntelStore(s => s.bearKellyEntryDate);
  const setBearKellyEntryDate = useGlobalIntelStore(s => s.setBearKellyEntryDate);
  const sectorOverheatInputs = useGlobalIntelStore(s => s.sectorOverheatInputs);
  const setSectorOverheatInputs = useGlobalIntelStore(s => s.setSectorOverheatInputs);
  const sectorOverheatResult = useGlobalIntelStore(s => s.sectorOverheatResult);
  const setSectorOverheatResult = useGlobalIntelStore(s => s.setSectorOverheatResult);
  const bearModeSimulatorInputs = useGlobalIntelStore(s => s.bearModeSimulatorInputs);
  const setBearModeSimulatorInputs = useGlobalIntelStore(s => s.setBearModeSimulatorInputs);
  const bearModeSimulatorResult = useGlobalIntelStore(s => s.bearModeSimulatorResult);
  const setBearModeSimulatorResult = useGlobalIntelStore(s => s.setBearModeSimulatorResult);
  const ipsResult = useGlobalIntelStore(s => s.ipsResult);
  const fssResult = useGlobalIntelStore(s => s.fssResult);
  const macroEnv = useGlobalIntelStore(s => s.macroEnv);
  const marketRegimeClassifierInput = useGlobalIntelStore(s => s.marketRegimeClassifierInput);
  const setMarketRegimeClassifierInput = useGlobalIntelStore(s => s.setMarketRegimeClassifierInput);
  const marketRegimeClassifierResult = useGlobalIntelStore(s => s.marketRegimeClassifierResult);
  const setMarketRegimeClassifierResult = useGlobalIntelStore(s => s.setMarketRegimeClassifierResult);

  // ── MTF Confluence ──────────────────────────────────────────────────────────
  const mtfConfluenceInput = useGlobalIntelStore(s => s.mtfConfluenceInput);
  const setMtfConfluenceInput = useGlobalIntelStore(s => s.setMtfConfluenceInput);
  const mtfConfluenceResult = useGlobalIntelStore(s => s.mtfConfluenceResult);
  const setMtfConfluenceResult = useGlobalIntelStore(s => s.setMtfConfluenceResult);

  // ── Dynamic Stop ────────────────────────────────────────────────────────────
  const dynamicStopInput = useGlobalIntelStore(s => s.dynamicStopInput);
  const setDynamicStopInput = useGlobalIntelStore(s => s.setDynamicStopInput);
  const dynamicStopResult = useGlobalIntelStore(s => s.dynamicStopResult);
  const setDynamicStopResult = useGlobalIntelStore(s => s.setDynamicStopResult);

  // ── Feedback Loop ────────────────────────────────────────────────────────────
  const feedbackLoopResult = useGlobalIntelStore(s => s.feedbackLoopResult);
  const setFeedbackLoopResult = useGlobalIntelStore(s => s.setFeedbackLoopResult);
  const tradeRecords = useTradeStore(s => s.tradeRecords);

  // ── 섹터 에너지 맵 ───────────────────────────────────────────────────────────
  const sectorEnergyInputs = useGlobalIntelStore(s => s.sectorEnergyInputs);
  const setSectorEnergyInputs = useGlobalIntelStore(s => s.setSectorEnergyInputs);
  const sectorEnergyResult = useGlobalIntelStore(s => s.sectorEnergyResult);
  const setSectorEnergyResult = useGlobalIntelStore(s => s.setSectorEnergyResult);

  // ── 수급 예측 선행 모델 ──────────────────────────────────────────────────────
  const flowPredictionInput = useGlobalIntelStore(s => s.flowPredictionInput);
  const setFlowPredictionInput = useGlobalIntelStore(s => s.setFlowPredictionInput);
  const flowPredictionResult = useGlobalIntelStore(s => s.flowPredictionResult);
  const setFlowPredictionResult = useGlobalIntelStore(s => s.setFlowPredictionResult);

  const mapcResult = useMemo(() => {
    if (!gate0Result || !macroEnv) return null;
    return evaluateMAPCResult(gate0Result, macroEnv, 15);
  }, [gate0Result, macroEnv]);

  // Compute feedback loop from closed trades
  const computedFeedbackLoop = useMemo(() => {
    const closed = tradeRecords.filter(t => t.status === 'CLOSED');
    const weights = getEvolutionWeightsFromPerformance();
    return evaluateFeedbackLoop(closed, weights);
  }, [tradeRecords]);

  // Sync feedback loop result to store whenever it changes
  React.useEffect(() => {
    setFeedbackLoopResult(computedFeedbackLoop);
  }, [computedFeedbackLoop, setFeedbackLoopResult]);

  const handleSectorOverheatInputsChange = useCallback(
    (inputs: typeof sectorOverheatInputs) => {
      setSectorOverheatInputs(inputs);
      setSectorOverheatResult(evaluateSectorOverheat(inputs));
    },
    [setSectorOverheatInputs, setSectorOverheatResult],
  );

  const handleMarketRegimeClassifierInputsChange = useCallback(
    (inputs: typeof marketRegimeClassifierInput) => {
      setMarketRegimeClassifierInput(inputs);
      setMarketRegimeClassifierResult(evaluateMarketRegimeClassifier(inputs));
    },
    [setMarketRegimeClassifierInput, setMarketRegimeClassifierResult],
  );

  const handleBearModeSimulatorInputsChange = useCallback(
    (inputs: typeof bearModeSimulatorInputs) => {
      setBearModeSimulatorInputs(inputs);
      setBearModeSimulatorResult(evaluateBearModeSimulator(inputs));
    },
    [setBearModeSimulatorInputs, setBearModeSimulatorResult],
  );

  const handleMtfInputsChange = useCallback(
    (inputs: typeof mtfConfluenceInput) => {
      setMtfConfluenceInput(inputs);
      setMtfConfluenceResult(evaluateMTFConfluence(inputs));
    },
    [setMtfConfluenceInput, setMtfConfluenceResult],
  );

  const handleDynamicStopInputsChange = useCallback(
    (inputs: typeof dynamicStopInput) => {
      setDynamicStopInput(inputs);
      setDynamicStopResult(evaluateDynamicStop(inputs));
    },
    [setDynamicStopInput, setDynamicStopResult],
  );

  const handleSectorEnergyInputsChange = useCallback(
    (inputs: typeof sectorEnergyInputs) => {
      setSectorEnergyInputs(inputs);
      setSectorEnergyResult(evaluateSectorEnergy(inputs));
    },
    [setSectorEnergyInputs, setSectorEnergyResult],
  );

  const handleFlowPredictionInputChange = useCallback(
    (input: typeof flowPredictionInput) => {
      setFlowPredictionInput(input);
      setFlowPredictionResult(evaluateFlowPrediction(input));
    },
    [setFlowPredictionInput, setFlowPredictionResult],
  );

  // Compute sector energy on mount and whenever inputs change
  React.useEffect(() => {
    if (sectorEnergyInputs.length > 0 && !sectorEnergyResult) {
      setSectorEnergyResult(evaluateSectorEnergy(sectorEnergyInputs));
    }
  }, [sectorEnergyInputs, sectorEnergyResult, setSectorEnergyResult]);

  // Compute flow prediction on mount and whenever inputs change
  React.useEffect(() => {
    if (!flowPredictionResult) {
      setFlowPredictionResult(evaluateFlowPrediction(flowPredictionInput));
    }
  }, [flowPredictionInput, flowPredictionResult, setFlowPredictionResult]);

  return (
    <div className="space-y-10">

      <RegimeGaugeSection gate0Result={gate0Result} externalRegime={externalRegime} />

      {/* 시장 레짐 자동 분류기 — Gate 임계값 마스터 컨트롤 엔진 */}
      <MarketRegimeClassifierPanel
        result={marketRegimeClassifierResult}
        inputs={marketRegimeClassifierInput}
        onInputsChange={handleMarketRegimeClassifierInputsChange}
      />

      {/* MTF 합치 스코어 — 4개 시간 프레임 계층 통합 노이즈 필터 */}
      <MTFConfluencePanel
        result={mtfConfluenceResult}
        inputs={mtfConfluenceInput}
        onInputsChange={handleMtfInputsChange}
      />

      {/* 포지션 생애주기 완전 자동화 — 5단계 매도 체계 */}
      <PositionLifecyclePanel />

      {/* 변동성 적응형 동적 손절 — ATR 기반 손절가 자동 조정 */}
      <DynamicStopPanel
        result={dynamicStopResult}
        inputs={dynamicStopInput}
        onInputsChange={handleDynamicStopInputsChange}
      />

      <BearRegimeSection />

      <BearKellyPanel
        bearKellyResult={bearKellyResult}
        entryDate={bearKellyEntryDate}
        onSetEntryDate={setBearKellyEntryDate}
      />

      <SectorOverheatPanel
        inputs={sectorOverheatInputs}
        onInputsChange={handleSectorOverheatInputsChange}
        result={sectorOverheatResult}
      />

      <BearModeSimulatorPanel
        inputs={bearModeSimulatorInputs}
        onInputsChange={handleBearModeSimulatorInputsChange}
        result={bearModeSimulatorResult}
      />

      <MAPCPanel mapcResult={mapcResult} />

      <IPSPanel ipsResult={ipsResult} />

      <FSSPanel fssResult={fssResult} />

      <MarketOverviewSection marketOverview={marketOverview} />

      <SmartMoneySection />
      <ExportMomentumSection />
      <GeoRiskSection />
      <CreditSpreadSection />

      <ContrarianSection gate0Result={gate0Result} />

      <FusionMatrixSection currentRoeType={currentRoeType} />

      {/* 피드백 폐쇄 루프 — 30거래 누적 후 27조건 자동 가중치 교정 */}
      <FeedbackLoopPanel result={feedbackLoopResult} />

      {/* 섹터 에너지 맵 & 로테이션 마스터 게이트 */}
      <SectorEnergyPanel
        result={sectorEnergyResult}
        inputs={sectorEnergyInputs}
        onInputsChange={handleSectorEnergyInputsChange}
      />

      {/* DART 공시 LLM 인텔리전스 필터 */}
      <DartIntelPanel />

      {/* 반실패 학습 패턴 DB */}
      <AntiFailurePanel />

      {/* 수급 예측 선행 모델 — Gate 필터보다 1~3일 앞서 진입 시점 포착 */}
      <FlowPredictionPanel
        result={flowPredictionResult}
        input={flowPredictionInput}
        onInputChange={handleFlowPredictionInputChange}
      />

      <GlobalIntelSection />

    </div>
  );
};
