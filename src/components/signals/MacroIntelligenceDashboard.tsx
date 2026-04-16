import React, { useMemo, useCallback } from 'react';
import {
  Gate0Result, ROEType,
  EconomicRegimeData, SupplyChainIntelligence, SectorOrderIntelligence,
  FinancialStressIndex, FomcSentimentAnalysis,
} from '../../types/quant';
import { evaluateSectorOverheat } from '../../services/quant/sectorEngine';
import { evaluateBearModeSimulator } from '../../services/quant/bearEngine';
import { evaluateMAPCResult } from '../../services/quant/macroEngine';
import { evaluateMarketRegimeClassifier } from '../../services/quant/marketRegimeClassifier';
import { evaluateMTFConfluence } from '../../services/quant/mtfEngine';
import { evaluateDynamicStop } from '../../services/quant/dynamicStopEngine';
import { evaluateFeedbackLoop } from '../../services/quant/feedbackLoopEngine';
import { evaluateSectorEnergy } from '../../services/quant/sectorEnergyEngine';
import { evaluateFlowPrediction } from '../../services/quant/flowPredictionEngine';
import { evaluateSatelliteCascader } from '../../services/quant/satelliteCascaderEngine';
import { evaluateBehavioralMirror } from '../../services/quant/behavioralMirrorEngine';
import { checkSystemInterference } from '../../services/quant/systemInterferenceChecker';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';
import { useTradeStore } from '../../stores/useTradeStore';
import { getEvolutionWeightsFromPerformance } from '../../services/quant/evolutionEngine';
import { BearKellyPanel } from '../bear/BearKellyPanel';
import { SectorOverheatPanel } from './SectorOverheatPanel';
import { BearModeSimulatorPanel } from '../bear/BearModeSimulatorPanel';
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
import { SatelliteCascaderPanel } from './SatelliteCascaderPanel';
import { BehavioralMirrorPanel } from './BehavioralMirrorPanel';
import { SystemInterferencePanel } from './SystemInterferencePanel';
import { RegimeGaugeSection } from '../macro/RegimeGaugeSection';
import { BearRegimeSection } from '../macro/BearRegimeSection';
import { MarketOverviewSection } from '../macro/MarketOverviewSection';
import { SmartMoneySection } from '../macro/SmartMoneySection';
import { ExportMomentumSection } from '../macro/ExportMomentumSection';
import { GeoRiskSection } from '../macro/GeoRiskSection';
import { CreditSpreadSection } from '../macro/CreditSpreadSection';
import { ContrarianSection } from '../macro/ContrarianSection';
import { FusionMatrixSection } from '../macro/FusionMatrixSection';
import { GlobalIntelSection } from '../macro/GlobalIntelSection';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';

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

  // ── 위성 종목 연쇄 추적 시스템 ──────────────────────────────────────────────
  const satelliteCascaderInput = useGlobalIntelStore(s => s.satelliteCascaderInput);
  const setSatelliteCascaderInput = useGlobalIntelStore(s => s.setSatelliteCascaderInput);
  const satelliteCascaderResult = useGlobalIntelStore(s => s.satelliteCascaderResult);
  const setSatelliteCascaderResult = useGlobalIntelStore(s => s.setSatelliteCascaderResult);

  // ── 투자자 행동 교정 미러 대시보드 ──────────────────────────────────────
  const behavioralMirrorInput = useGlobalIntelStore(s => s.behavioralMirrorInput);
  const setBehavioralMirrorInput = useGlobalIntelStore(s => s.setBehavioralMirrorInput);
  const behavioralMirrorResult = useGlobalIntelStore(s => s.behavioralMirrorResult);
  const setBehavioralMirrorResult = useGlobalIntelStore(s => s.setBehavioralMirrorResult);

  // ── 시스템 상호간섭 파라미터 충돌 감지 ──────────────────────────────────
  const systemInterferenceResult = useGlobalIntelStore(s => s.systemInterferenceResult);
  const setSystemInterferenceResult = useGlobalIntelStore(s => s.setSystemInterferenceResult);

  const mapcResult = useMemo(() => {
    if (!gate0Result || !macroEnv) return null;
    return evaluateMAPCResult(gate0Result, macroEnv, 15);
  }, [gate0Result, macroEnv]);

  // Compute feedback loop from closed trades
  const computedFeedbackLoop = useMemo(() => {
    const closed = (tradeRecords ?? []).filter(t => t.status === 'CLOSED');
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
      const newResult = evaluateMarketRegimeClassifier(inputs);
      setMarketRegimeClassifierResult(newResult);
      setSystemInterferenceResult(checkSystemInterference(newResult, dynamicStopInput));
    },
    [setMarketRegimeClassifierInput, setMarketRegimeClassifierResult, setSystemInterferenceResult, dynamicStopInput],
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
      setSystemInterferenceResult(checkSystemInterference(marketRegimeClassifierResult, inputs));
    },
    [setDynamicStopInput, setDynamicStopResult, setSystemInterferenceResult, marketRegimeClassifierResult],
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

  const handleSatelliteCascaderInputChange = useCallback(
    (input: typeof satelliteCascaderInput) => {
      setSatelliteCascaderInput(input);
      setSatelliteCascaderResult(input ? evaluateSatelliteCascader(input) : null);
    },
    [setSatelliteCascaderInput, setSatelliteCascaderResult],
  );

  const handleBehavioralMirrorInputChange = useCallback(
    (input: typeof behavioralMirrorInput) => {
      setBehavioralMirrorInput(input);
      const closed = (tradeRecords ?? []).filter(t => t.status === 'CLOSED');
      setBehavioralMirrorResult(evaluateBehavioralMirror(closed, input));
    },
    [setBehavioralMirrorInput, setBehavioralMirrorResult, tradeRecords],
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

  // Recompute satellite cascader whenever input changes
  React.useEffect(() => {
    if (satelliteCascaderInput && !satelliteCascaderResult) {
      setSatelliteCascaderResult(evaluateSatelliteCascader(satelliteCascaderInput));
    }
  }, [satelliteCascaderInput, satelliteCascaderResult, setSatelliteCascaderResult]);

  // Recompute behavioral mirror whenever trade records change
  React.useEffect(() => {
    const closed = (tradeRecords ?? []).filter(t => t.status === 'CLOSED');
    setBehavioralMirrorResult(evaluateBehavioralMirror(closed, behavioralMirrorInput));
  }, [tradeRecords, behavioralMirrorInput, setBehavioralMirrorResult]);

  // Run system interference check on mount and whenever regime or dynamic stop changes
  React.useEffect(() => {
    setSystemInterferenceResult(checkSystemInterference(marketRegimeClassifierResult, dynamicStopInput));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketRegimeClassifierResult, dynamicStopInput]);

  return (
    <div className="space-y-10">

      <SectionErrorBoundary sectionName="레짐 게이지">
        <RegimeGaugeSection gate0Result={gate0Result} externalRegime={externalRegime} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="시장 레짐 자동 분류기">
        <MarketRegimeClassifierPanel
          result={marketRegimeClassifierResult}
          inputs={marketRegimeClassifierInput}
          onInputsChange={handleMarketRegimeClassifierInputsChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="MTF 합치 스코어">
        <MTFConfluencePanel
          result={mtfConfluenceResult}
          inputs={mtfConfluenceInput}
          onInputsChange={handleMtfInputsChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="포지션 생애주기">
        <PositionLifecyclePanel />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="동적 손절">
        <DynamicStopPanel
          result={dynamicStopResult}
          inputs={dynamicStopInput}
          onInputsChange={handleDynamicStopInputsChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="시스템 상호간섭">
        <SystemInterferencePanel result={systemInterferenceResult} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Bear Regime">
        <BearRegimeSection />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Bear Kelly">
        <BearKellyPanel
          bearKellyResult={bearKellyResult}
          entryDate={bearKellyEntryDate}
          onSetEntryDate={setBearKellyEntryDate}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="섹터 과열">
        <SectorOverheatPanel
          inputs={sectorOverheatInputs}
          onInputsChange={handleSectorOverheatInputsChange}
          result={sectorOverheatResult}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Bear Mode 시뮬레이터">
        <BearModeSimulatorPanel
          inputs={bearModeSimulatorInputs}
          onInputsChange={handleBearModeSimulatorInputsChange}
          result={bearModeSimulatorResult}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="MAPC">
        <MAPCPanel mapcResult={mapcResult} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="IPS">
        <IPSPanel ipsResult={ipsResult} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="FSS">
        <FSSPanel fssResult={fssResult} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="시장 개요">
        <MarketOverviewSection marketOverview={marketOverview} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Smart Money">
        <SmartMoneySection />
      </SectionErrorBoundary>
      <SectionErrorBoundary sectionName="수출 모멘텀">
        <ExportMomentumSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary sectionName="지정학 리스크">
        <GeoRiskSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary sectionName="크레딧 스프레드">
        <CreditSpreadSection />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Contrarian">
        <ContrarianSection gate0Result={gate0Result} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Fusion Matrix">
        <FusionMatrixSection currentRoeType={currentRoeType} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="피드백 루프">
        <FeedbackLoopPanel result={feedbackLoopResult} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="섹터 에너지">
        <SectorEnergyPanel
          result={sectorEnergyResult}
          inputs={sectorEnergyInputs}
          onInputsChange={handleSectorEnergyInputsChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="DART 인텔">
        <DartIntelPanel />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="반실패 학습">
        <AntiFailurePanel />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="수급 예측">
        <FlowPredictionPanel
          result={flowPredictionResult}
          input={flowPredictionInput}
          onInputChange={handleFlowPredictionInputChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="위성 종목 연쇄">
        <SatelliteCascaderPanel
          result={satelliteCascaderResult}
          input={satelliteCascaderInput}
          onInputChange={handleSatelliteCascaderInputChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="행동 미러">
        <BehavioralMirrorPanel
          result={behavioralMirrorResult}
          input={behavioralMirrorInput}
          onInputChange={handleBehavioralMirrorInputChange}
        />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="글로벌 인텔">
        <GlobalIntelSection />
      </SectionErrorBoundary>

    </div>
  );
};
