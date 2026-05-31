// @responsibility analysis 영역 DeepAnalysisModal 컴포넌트
import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, Download, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QuantDashboard } from './QuantDashboard';
import { CandleChart } from './CandleChart';
import { DeferredMount } from '../common/DeferredMount';
import { AnalysisViewToggle, AnalysisViewButtons } from './AnalysisViewToggle';
import { evaluateStock } from '../../services/quant/gateEngine';
import { useGlobalIntelStore, useMarketStore, useRecommendationStore, useSettingsStore } from '../../stores';
import { useAnalysisStore } from '../../stores';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useShadowTradeStore } from '../../stores/useShadowTradeStore';
import { buildShadowTrade } from '../../services/autoTrading';
import { syncStockPrice } from '../../services/stockService';
import { fetchKisInvestorSupply, fetchKisShortSelling } from '../../api/kisMarketDataClient';
import { fetchNaverPeak, fetchNaverSupply } from '../../services/stock/naverDailyChart';
import type { MarketOverview, StockRecommendation } from '../../services/stockService';
import type { EconomicRegimeData, EvaluationResult, ExtendedRegimeData, ROEType } from '../../types/core';
import { debugLog, debugWarn } from '../../utils/debug';

// Sub-components
import { ModalHeader } from './DeepAnalysisModal/ModalHeader';
import { StickySummaryBar } from './DeepAnalysisModal/StickySummaryBar';
import { MarketPositionSection } from './DeepAnalysisModal/MarketPositionSection';
import { AIIntelligenceSection } from './DeepAnalysisModal/AIIntelligenceSection';
import { GateFilterSection } from './DeepAnalysisModal/GateFilterSection';
import { SellChecklistSection } from './DeepAnalysisModal/SellChecklistSection';
import { SectorAnalysisSection } from './DeepAnalysisModal/SectorAnalysisSection';
import { TechnicalAnalysisColumn } from './DeepAnalysisModal/TechnicalAnalysisColumn';
import { FundamentalsColumn } from './DeepAnalysisModal/FundamentalsColumn';
import { SentimentSection } from './DeepAnalysisModal/SentimentSection';
import { RiskChecklistSection } from './DeepAnalysisModal/RiskChecklistSection';
import { ModalFooter } from './DeepAnalysisModal/ModalFooter';
import { MasterRadarChart } from './DeepAnalysisModal/MasterRadarChart';
import { KeyChecklistOverview } from './DeepAnalysisModal/KeyChecklistOverview';
import { ScoreAlignmentGrid } from './DeepAnalysisModal/ScoreAlignmentGrid';
import { buildDeepAnalysisEvaluateInput } from './DeepAnalysisModal/buildEvaluateInput';
import type { DeepAnalysisEvaluateContext } from './DeepAnalysisModal/buildEvaluateInput';
import { buildMockShadowSignal } from './DeepAnalysisModal/buildMockShadowSignal';

const KIS_BALANCE_DEFAULT = 100_000_000;

type DeepAnalysisView = 'STANDARD' | 'QUANT';

type DeepAnalysisGlobalIntelContext = Omit<DeepAnalysisEvaluateContext, 'marketOverview' | 'weeklyRsiValues'> & {
  currentRoeType: ROEType;
  economicRegimeData: EconomicRegimeData | null;
  extendedRegimeData: ExtendedRegimeData | null;
};

interface DeepAnalysisModalProps {
  stock: StockRecommendation | null;
  onClose: () => void;
  analysisReportRef: React.RefObject<HTMLDivElement | null>;
  weeklyRsiValues: number[];
  onExportPDF: () => Promise<void>;
  isExporting: boolean;
}

function DeepAnalysisActionButtons({
  analysisView,
  setAnalysisView,
  onExportPDF,
  isExporting,
  onClose,
}: {
  analysisView: DeepAnalysisView;
  setAnalysisView: (v: DeepAnalysisView) => void;
  onExportPDF: () => Promise<void>;
  isExporting: boolean;
  onClose: () => void;
}) {
  return (
    <div className="static w-full justify-end px-4 pt-3 sm:absolute sm:top-4 sm:right-4 sm:w-auto sm:justify-start sm:px-0 sm:pt-0 z-[160] flex items-center gap-2 no-print">
      <AnalysisViewButtons analysisView={analysisView} setAnalysisView={setAnalysisView} />
      <button
        onClick={onExportPDF}
        disabled={isExporting}
        className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-blue-500 transition-all group active:scale-90 border border-white/[0.07] backdrop-blur-md shadow-lg"
        title="PDF 리포트 저장"
      >
        {isExporting ? (
          <RefreshCw className="w-4 h-4 text-white/50 animate-spin" />
        ) : (
          <Download className="w-4 h-4 text-white/50 group-hover:text-white transition-colors" />
        )}
      </button>
      <button
        onClick={() => onClose()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-all group active:scale-90 border border-white/[0.07] backdrop-blur-md shadow-lg"
        title="닫기"
      >
        <span className="text-[10px] font-semibold tracking-tight text-white/40 group-hover:text-white transition-colors">닫기</span>
        <X className="w-4 h-4 text-white/50 group-hover:text-white transition-colors" />
      </button>
    </div>
  );
}

function DeepAnalysisAiSummary({ reason }: { reason: string }) {
  return (
    <div className="mb-5 p-4 sm:p-5 rounded-2xl bg-orange-500/5 border border-orange-500/10 flex gap-3 items-start">
      <Sparkles className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="block text-[10px] font-black text-white/40 tracking-tight mb-1.5">판정 근거 요약</span>
        <p className="text-white/90 text-sm sm:text-[15px] leading-relaxed font-bold tracking-tight break-words">
          {reason}
        </p>
      </div>
    </div>
  );
}

function DeepAnalysisQuantView({
  stock,
  marketOverview,
  globalIntelStore,
  weeklyRsiValues,
  onShadowTrade,
}: {
  stock: StockRecommendation;
  marketOverview: MarketOverview | null;
  globalIntelStore: DeepAnalysisGlobalIntelContext;
  weeklyRsiValues: number[];
  onShadowTrade: (code: string, name: string, price: number) => void;
}) {
  const {
    macroEnv,
    exportRatio,
    currentRoeType,
    economicRegimeData,
    extendedRegimeData,
    smartMoneyData,
    exportMomentumData,
    geoRiskData,
    creditSpreadData,
    globalCorrelation,
    newsFrequencyScores,
    supplyChainData,
    financialStressData,
  } = globalIntelStore;

  return (
    <QuantDashboard
      result={evaluateStock(buildDeepAnalysisEvaluateInput(stock, {
        marketOverview,
        macroEnv,
        exportRatio,
        smartMoneyData,
        exportMomentumData,
        geoRiskData,
        creditSpreadData,
        extendedRegimeData,
        economicRegimeData,
        supplyChainData,
        financialStressData,
        newsFrequencyScores,
        globalCorrelation,
        weeklyRsiValues,
      }))}
      economicRegime={extendedRegimeData ?? economicRegimeData ?? undefined}
      currentRoeType={currentRoeType}
      marketOverview={marketOverview}
      stockCode={stock?.code}
      stockName={stock?.name}
      currentPrice={stock?.currentPrice}
      onShadowTrade={onShadowTrade}
    />
  );
}

function DeepAnalysisStandardView({
  stock,
  deepAnalysisGateSignals,
}: {
  stock: StockRecommendation;
  deepAnalysisGateSignals: Array<{ time: string; type: 'STRONG_BUY' | 'BUY'; label: string }>;
}) {
  return (
    <>
      <ModalHeader stock={stock} />

      <ScoreAlignmentGrid stock={stock} />

      {/* 판정 근거 요약 — 한 줄 요약으로 밀도 향상 */}
      <DeepAnalysisAiSummary reason={stock.reason} />

      {/* Candle Chart — 무거운 차트는 오픈 애니메이션 직후 지연 마운트(열림 부드럽게) */}
      <DeferredMount
        delay={260}
        placeholder={<div className="mb-6 h-[380px] animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]" />}
      >
        <div className="mb-6">
          <CandleChart
            stockCode={stock.code}
            stockName={stock.name}
            gateSignals={deepAnalysisGateSignals}
            height={380}
          />
        </div>
      </DeferredMount>

      {/* Radar Chart & Checklist Overview — 지연 마운트 */}
      <DeferredMount
        delay={340}
        placeholder={(
          <div className="mb-8 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="h-72 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]" />
            <div className="h-72 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]" />
          </div>
        )}
      >
        <div className="mb-8 grid grid-cols-1 gap-5 xl:grid-cols-2">
          <MasterRadarChart stock={stock} />
          <KeyChecklistOverview stock={stock} />
        </div>
      </DeferredMount>

      <MarketPositionSection stock={stock} />

      <AIIntelligenceSection stock={stock} />

      {stock.gateEvaluation && <GateFilterSection stock={stock} />}

      {stock.sellSignals && stock.sellSignals.length > 0 && <SellChecklistSection stock={stock} />}

      {stock.sectorAnalysis && <SectorAnalysisSection stock={stock} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <TechnicalAnalysisColumn stock={stock} />
        </div>
        <div className="lg:col-span-5 space-y-6">
          <FundamentalsColumn stock={stock} />
        </div>
        <SentimentSection stock={stock} />
        <RiskChecklistSection stock={stock} />
      </div>
    </>
  );
}

function DeepAnalysisBody({
  analysisView,
  stock,
  marketOverview,
  globalIntelStore,
  weeklyRsiValues,
  handleShadowTrade,
  deepAnalysisGateSignals,
}: {
  analysisView: DeepAnalysisView;
  stock: StockRecommendation;
  marketOverview: MarketOverview | null;
  globalIntelStore: DeepAnalysisGlobalIntelContext;
  weeklyRsiValues: number[];
  handleShadowTrade: (code: string, name: string, price: number) => void;
  deepAnalysisGateSignals: Array<{ time: string; type: 'STRONG_BUY' | 'BUY'; label: string }>;
}) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* 모바일 전용 — 스크롤해도 종목·최종점수·신호가 상단 고정(맥락 유지) */}
      <StickySummaryBar stock={stock} />
      <div className="p-5 md:p-7">
        {analysisView === 'QUANT' ? (
          <DeepAnalysisQuantView
            stock={stock}
            marketOverview={marketOverview}
            globalIntelStore={globalIntelStore}
            weeklyRsiValues={weeklyRsiValues}
            onShadowTrade={handleShadowTrade}
          />
        ) : (
          <DeepAnalysisStandardView
            stock={stock}
            deepAnalysisGateSignals={deepAnalysisGateSignals}
          />
        )}
      </div>
    </div>
  );
}

export function DeepAnalysisModal({ stock, onClose, analysisReportRef, weeklyRsiValues, onExportPDF, isExporting }: DeepAnalysisModalProps) {
  if (!stock) {
    debugWarn('DeepAnalysisModal: stock is null - modal will not render');
  } else {
    debugLog('DeepAnalysisModal OPEN', { name: stock.name, code: stock.code });
  }

  const { setDeepAnalysisStock } = useAnalysisStore();

  // Auto-sync price when modal opens with a new stock
  useEffect(() => {
    if (!stock) return;
    let cancelled = false;
    (async () => {
      try {
        const priced = await syncStockPrice(stock);
        // 모달 단위 단일 종목(bulk 미경유, 쿼터 최소). KIS 수급·공매도 + Naver 52주 peak 병렬. 실패→null.
        const [kisSupply, kisShort, naverPeak, naverSupply] = await Promise.all([
          fetchKisInvestorSupply(stock.code).catch(() => null),
          fetchKisShortSelling(stock.code).catch(() => null),
          fetchNaverPeak(stock.code).catch(() => null),
          fetchNaverSupply(stock.code).catch(() => null),
        ]);
        if (cancelled) return;
        // 수급: Naver(frgn.naver, 장외 가용) 우선 → KIS fallback. 둘 다 실데이터(dataSource 표기).
        const supply = naverSupply ?? kisSupply;
        const merged: StockRecommendation = {
          ...priced,
          // 52주 peak 은 Naver 우선(장외에도 가용). 실패 시 priced.peakPrice(KIS w52_hgpr 등) 유지.
          ...(naverPeak && naverPeak > 0 ? { peakPrice: naverPeak } : {}),
          // Naver/KIS 순매수 + 기존 Naver foreignerOwnRatio 보존(dataSource 로 실데이터 표기)
          supplyData: supply ? { ...priced.supplyData, ...supply } : priced.supplyData,
          shortSelling: kisShort ?? priced.shortSelling,
        };
        const changed =
          merged.currentPrice !== stock.currentPrice ||
          merged.peakPrice !== stock.peakPrice ||
          Boolean(supply) ||
          Boolean(kisShort);
        if (changed) {
          debugLog('DeepAnalysisModal: detail synced', {
            name: stock.name, price: merged.currentPrice, peak: merged.peakPrice,
            kisSupply: Boolean(kisSupply), kisShort: Boolean(kisShort),
          });
          setDeepAnalysisStock(merged);
        }
      } catch (err) {
        debugWarn('DeepAnalysisModal: detail sync failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [stock?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const globalIntelStore = useGlobalIntelStore();
  const { marketOverview } = useMarketStore();
  const { watchlist, setWatchlist } = useRecommendationStore();
  const { setView } = useSettingsStore();
  const { addShadowTrade } = useShadowTradeStore();
  // 모바일은 아래에서 올라오는 바텀시트, 데스크톱은 기존 중앙 모달 — 진입 애니메이션을 분기.
  const isMobile = useIsMobile();
  const sheetMotion = isMobile
    ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
    : { initial: { scale: 0.95, opacity: 0, y: 30 }, animate: { scale: 1, opacity: 1, y: 0 }, exit: { scale: 0.95, opacity: 0, y: 30 } };

  const deepAnalysisGateSignals = useMemo(() => {
    if (!stock) return [];
    if (stock.type === 'STRONG_BUY' || stock.type === 'BUY') {
      return [{ time: new Date().toISOString().split('T')[0], type: stock.type === 'STRONG_BUY' ? 'STRONG_BUY' as const : 'BUY' as const, label: stock.type }];
    }
    return [];
  }, [stock?.code, stock?.type]);

  const handleShadowTrade = useCallback((code: string, name: string, price: number) => {
    if (!stock) return;
    const mockSignal = buildMockShadowSignal(stock) as EvaluationResult;
    const trade = buildShadowTrade(mockSignal, code, name, price, KIS_BALANCE_DEFAULT);
    addShadowTrade(trade);
    setView('AUTO_TRADE');
  }, [stock, addShadowTrade, setView]);

  return (
    <AnimatePresence>
      {stock && (
        <motion.div
          key="deep-analysis-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/90 backdrop-blur-md"
        >
          <motion.div
            key="deep-analysis-content"
            ref={analysisReportRef}
            initial={sheetMotion.initial}
            animate={sheetMotion.animate}
            exit={sheetMotion.exit}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="glass-3d rounded-t-3xl sm:rounded-3xl w-full max-w-[1400px] max-h-[92vh] sm:max-h-[94vh] border border-white/[0.07] shadow-xl overflow-hidden relative flex flex-col print-section"
            onClick={e => e.stopPropagation()}
          >
            {/* 모바일 바텀시트 grabber — 시트임을 알리는 시각 affordance (닫기는 X 버튼 전용) */}
            <div className="sm:hidden mx-auto mt-2.5 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/20 no-print" />
            <AnalysisViewToggle>
            {(analysisView, setAnalysisView) => (<>
            <DeepAnalysisActionButtons
              analysisView={analysisView}
              setAnalysisView={setAnalysisView}
              onExportPDF={onExportPDF}
              isExporting={isExporting}
              onClose={onClose}
            />

            <DeepAnalysisBody
              analysisView={analysisView}
              stock={stock}
              marketOverview={marketOverview}
              globalIntelStore={globalIntelStore}
              weeklyRsiValues={weeklyRsiValues}
              handleShadowTrade={handleShadowTrade}
              deepAnalysisGateSignals={deepAnalysisGateSignals}
            />
            </>)}
            </AnalysisViewToggle>

            <ModalFooter
              stock={stock}
              onClose={onClose}
              watchlist={watchlist}
              setWatchlist={setWatchlist}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
