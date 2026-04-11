import React, { useMemo, useCallback } from 'react';
import {
  Gate0Result, ROEType,
  EconomicRegimeData, SupplyChainIntelligence, SectorOrderIntelligence,
  FinancialStressIndex, FomcSentimentAnalysis,
} from '../types/quant';
import { evaluateSectorOverheat, evaluateBearModeSimulator, evaluateMAPCResult } from '../services/quantEngine';
import { useGlobalIntelStore } from '../stores/useGlobalIntelStore';
import { BearKellyPanel } from './BearKellyPanel';
import { SectorOverheatPanel } from './SectorOverheatPanel';
import { BearModeSimulatorPanel } from './BearModeSimulatorPanel';
import { IPSPanel } from './IPSPanel';
import { FSSPanel } from './FSSPanel';
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

  const mapcResult = useMemo(() => {
    if (!gate0Result || !macroEnv) return null;
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

      <RegimeGaugeSection gate0Result={gate0Result} externalRegime={externalRegime} />

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

      <GlobalIntelSection />

    </div>
  );
};
