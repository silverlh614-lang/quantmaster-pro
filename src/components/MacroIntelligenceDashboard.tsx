import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Gate0Result, EconomicRegimeData, EconomicRegime, ROEType,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex, FomcSentimentAnalysis,
} from '../types/quant';
import {
  getEconomicRegime,
} from '../services/stockService';
import { evaluateSectorOverheat, evaluateBearModeSimulator, evaluateMAPCResult } from '../services/quantEngine';
import { useGlobalIntelStore } from '../stores/useGlobalIntelStore';
import { BearKellyPanel } from './BearKellyPanel';
import { SectorOverheatPanel } from './SectorOverheatPanel';
import { BearModeSimulatorPanel } from './BearModeSimulatorPanel';
import { IPSPanel } from './IPSPanel';
import { FSSPanel } from './FSSPanel';
import { MIPDashboard } from './MIPDashboard';
import { MAPCPanel } from './MAPCPanel';
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
  externalSupplyChain,
  externalSectorOrders,
  externalFsi,
  externalFomcSentiment,
}) => {
  const [economicRegime, setEconomicRegime] = useState<EconomicRegimeData | null>(externalRegime ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (externalRegime) setEconomicRegime(externalRegime);
  }, [externalRegime]);

  const loadRegime = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEconomicRegime();
      setEconomicRegime(data);
    } catch (e: any) {
      setError(e?.message ?? '경기 레짐 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  const currentRegime: EconomicRegime = economicRegime?.regime ?? 'EXPANSION';

  // ── Bear Kelly + Sector Overheat + Simulator (전역 스토어에서 읽기) ──────
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

  // ── MAPC: 매크로 포지션 자동 조절 (gate0Result + macroEnv → mapcResult) ───
  const mapcResult = useMemo(() => {
    if (!gate0Result || !macroEnv) return null;
    // MacroIntelligenceDashboard는 종목 무관 → 기본 켈리 15% 가정 (중간값)
    return evaluateMAPCResult(gate0Result, macroEnv, 15);
  }, [gate0Result, macroEnv]);

  const handleSectorOverheatInputsChange = useCallback(
    (inputs: typeof sectorOverheatInputs) => {
      setSectorOverheatInputs(inputs);
      setSectorOverheatResult(evaluateSectorOverheat(inputs));
    },
    [setSectorOverheatInputs, setSectorOverheatResult],
  );

  const handleBearModeSimulatorInputsChange = useCallback(
    (inputs: typeof bearModeSimulatorInputs) => {
      setBearModeSimulatorInputs(inputs);
      setBearModeSimulatorResult(evaluateBearModeSimulator(inputs));
    },
    [setBearModeSimulatorInputs, setBearModeSimulatorResult],
  );

  return (
    <div className="space-y-10">

      <RegimeGaugeSection
        gate0Result={gate0Result}
        economicRegime={economicRegime}
        loading={loading}
        error={error}
        onLoadRegime={loadRegime}
      />

      <BearRegimeSection />


      {/* ── 아이디어 6: Bear Mode Kelly Criterion ── */}
      <BearKellyPanel
        bearKellyResult={bearKellyResult}
        entryDate={bearKellyEntryDate}
        onSetEntryDate={setBearKellyEntryDate}
      />

      {/* ── 아이디어 7: 섹터 과열 감지 + 인버스 ETF 자동 매칭 ── */}
      <SectorOverheatPanel
        inputs={sectorOverheatInputs}
        onInputsChange={handleSectorOverheatInputsChange}
        result={sectorOverheatResult}
      />

      {/* ── 아이디어 8: Bear Mode 손익 시뮬레이터 ── */}
      <BearModeSimulatorPanel
        inputs={bearModeSimulatorInputs}
        onInputsChange={handleBearModeSimulatorInputsChange}
        result={bearModeSimulatorResult}
      />

      {/* ── 아이디어 9: MAPC 매크로 임계값 연동 포지션 자동 조절기 ── */}
      <MAPCPanel mapcResult={mapcResult} />

      {/* ── 아이디어 11: IPS 통합 변곡점 확률 엔진 ── */}
      <IPSPanel ipsResult={ipsResult} />

      {/* ── 아이디어 4: FSS 외국인 수급 방향 전환 스코어 ── */}
      <FSSPanel fssResult={fssResult} />

      {/* ── 아이디어 5: MIPD 다차원 변곡점 예측 대시보드 ── */}
      <MIPDashboard
        gate0={gate0Result}
        ipsResult={ipsResult}
        fssResult={fssResult}
      />

      <MarketOverviewSection marketOverview={marketOverview} economicRegime={economicRegime} />

      {/* ---- Smart Money / Export / GeoRisk / CreditSpread ---- */}
      <SmartMoneySection />
      <ExportMomentumSection />
      <GeoRiskSection />
      <CreditSpreadSection />

      <ContrarianSection gate0Result={gate0Result} />

      <FusionMatrixSection currentRegime={currentRegime} currentRoeType={currentRoeType} />

      <GlobalIntelSection
        externalSupplyChain={externalSupplyChain}
        externalSectorOrders={externalSectorOrders}
        externalFsi={externalFsi}
        externalFomcSentiment={externalFomcSentiment}
      />

    </div>
  );
};
