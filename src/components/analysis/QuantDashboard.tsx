import React, { useState } from 'react';
import { EvaluationResult, EconomicRegimeData, ROEType } from '../../types/quant';
import { MarketOverview } from '../../services/stockService';
import { TMAPanel } from '../signals/TMAPanel';
import { SRRPanel } from '../signals/SRRPanel';
import { MAPCPanel } from '../signals/MAPCPanel';
import { ROETransitionPanel } from '../signals/ROETransitionPanel';
import { ContradictionDetectorPanel } from '../signals/ContradictionDetectorPanel';
import { TimingSyncPanel } from '../signals/TimingSyncPanel';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';
import { detectROETransition } from '../../services/quant/roeEngine';
import { MacroIntelligenceDashboard } from '../signals/MacroIntelligenceDashboard';

// Sub-components
import { DashboardHeader } from './QuantDashboard/DashboardHeader';
import { MainStatsRow } from './QuantDashboard/MainStatsRow';
import { SignalVerdictSection } from './QuantDashboard/SignalVerdictSection';
import { ShadowTradingBar } from './QuantDashboard/ShadowTradingBar';
import { GatePyramid } from './QuantDashboard/GatePyramid';
import { ConditionChecklist } from './QuantDashboard/ConditionChecklist';
import { AdvancedQuantSections } from './QuantDashboard/AdvancedQuantSections';
import { EnemyChecklistSection } from './QuantDashboard/EnemyChecklistSection';
import { SeasonalityAttributionSection } from './QuantDashboard/SeasonalityAttributionSection';
import { PortfolioCorrelation } from './QuantDashboard/PortfolioCorrelation';
import { RiskAlertSection } from './QuantDashboard/RiskAlertSection';
import { DashboardFooter } from './QuantDashboard/DashboardFooter';

interface Props {
  result: EvaluationResult;
  economicRegime?: EconomicRegimeData;
  currentRoeType?: ROEType;
  marketOverview?: MarketOverview | null;
  stockCode?: string;
  stockName?: string;
  currentPrice?: number;
  onShadowTrade?: (stockCode: string, stockName: string, currentPrice: number) => void;
}

type DashboardTab = 'QUANT' | 'MACRO';

export const QuantDashboard: React.FC<Props> = ({
  result,
  economicRegime,
  currentRoeType = 3,
  marketOverview,
  stockCode,
  stockName,
  currentPrice,
  onShadowTrade,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('QUANT');

  // ROE 전이 감지 (스토어 이력 기반 실시간 재계산)
  const roeTypeHistory = useGlobalIntelStore(s => s.roeTypeHistory);
  const assetTurnoverHistory = useGlobalIntelStore(s => s.assetTurnoverHistory);
  const setRoeTypeHistory = useGlobalIntelStore(s => s.setRoeTypeHistory);
  const setAssetTurnoverHistory = useGlobalIntelStore(s => s.setAssetTurnoverHistory);
  const roeTransitionLive = detectROETransition(roeTypeHistory, assetTurnoverHistory);

  return (
    <div className="p-4 sm:p-8 bg-theme-bg text-theme-text font-sans min-h-screen">
      <DashboardHeader result={result} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* MACRO INTELLIGENCE Tab (항상 마운트, 탭 전환 시 hidden으로 상태 보존) */}
      <div className={activeTab !== 'MACRO' ? 'hidden' : ''}>
        <MacroIntelligenceDashboard
          gate0Result={result.gate0Result}
          currentRoeType={currentRoeType}
          marketOverview={marketOverview as any}
          externalRegime={economicRegime}
        />
      </div>

      {/* QUANT ANALYSIS Tab */}
      <div className={activeTab !== 'QUANT' ? 'hidden' : ''}>
        <MainStatsRow result={result} />
        <SignalVerdictSection result={result} />
        <ShadowTradingBar
          result={result}
          stockCode={stockCode}
          stockName={stockName}
          currentPrice={currentPrice}
          onShadowTrade={onShadowTrade}
        />
        <GatePyramid result={result} />
        <ConditionChecklist result={result} />
        <AdvancedQuantSections result={result} />

        {/* MAPC 포지션 자동 조절기 (IDEA 9) */}
        {result.mapc && (
          <div className="mb-8">
            <MAPCPanel mapcResult={result.mapc} stockName={stockName} />
          </div>
        )}

        {/* TMA 추세 모멘텀 가속도 측정기 (IDEA 7) */}
        {result.tma && (
          <div className="mb-8">
            <TMAPanel tmaResult={result.tma} stockName={stockName} />
          </div>
        )}

        {/* SRR 섹터 내 상대강도 역전 감지 (IDEA 8) */}
        {result.srr && (
          <div className="mb-8">
            <SRRPanel srrResult={result.srr} stockName={stockName} />
          </div>
        )}

        {/* ROE 유형 전이 감지기 (IDEA 3) */}
        <div className="mb-8">
          <ROETransitionPanel
            roeTransition={result.roeTransition ?? roeTransitionLive}
            roeTypeHistory={roeTypeHistory}
            assetTurnoverHistory={assetTurnoverHistory}
            stockName={stockName}
            onRoeTypeHistoryChange={setRoeTypeHistory}
            onAssetTurnoverHistoryChange={setAssetTurnoverHistory}
          />
        </div>

        {/* 조건 간 상충 감지기 */}
        {result.contradictionDetection && (
          <div className="mb-8">
            <ContradictionDetectorPanel result={result.contradictionDetection} />
          </div>
        )}

        {/* 조건 통과 시점 동기화 스코어 */}
        {result.timingSync && (
          <div className="mb-8">
            <TimingSyncPanel result={result.timingSync} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          <EnemyChecklistSection result={result} />
          <SeasonalityAttributionSection result={result} />
        </div>

        <PortfolioCorrelation result={result} />
        <RiskAlertSection result={result} />
        <DashboardFooter />
      </div>
    </div>
  );
};
