// @responsibility analysis 영역 DeepAnalysisModal 컴포넌트
import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, Download, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QuantDashboard } from './QuantDashboard';
import { CandleChart } from './CandleChart';
import { AnalysisViewToggle, AnalysisViewButtons } from './AnalysisViewToggle';
import { evaluateStock } from '../../services/quant/gateEngine';
import { useGlobalIntelStore, useMarketStore, useRecommendationStore, useSettingsStore } from '../../stores';
import { useAnalysisStore } from '../../stores';
import { useShadowTradeStore } from '../../stores/useShadowTradeStore';
import { buildShadowTrade } from '../../services/autoTrading';
import { syncStockPrice } from '../../services/stockService';
import type { StockRecommendation } from '../../services/stockService';
import type { EvaluationResult } from '../../types/core';
import { debugLog, debugWarn } from '../../utils/debug';

// Sub-components
import { ModalHeader } from './DeepAnalysisModal/ModalHeader';
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
import { buildDeepAnalysisEvaluateInput } from './DeepAnalysisModal/buildEvaluateInput';
import { buildMockShadowSignal } from './DeepAnalysisModal/buildMockShadowSignal';

const KIS_BALANCE_DEFAULT = 100_000_000;

interface DeepAnalysisModalProps {
  stock: StockRecommendation | null;
  onClose: () => void;
  analysisReportRef: React.RefObject<HTMLDivElement | null>;
  weeklyRsiValues: number[];
  onExportPDF: () => Promise<void>;
  isExporting: boolean;
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
        const updated = await syncStockPrice(stock);
        if (!cancelled && updated.currentPrice !== stock.currentPrice) {
          debugLog('DeepAnalysisModal: price synced', { name: stock.name, old: stock.currentPrice, new: updated.currentPrice });
          setDeepAnalysisStock(updated);
        }
      } catch (err) {
        debugWarn('DeepAnalysisModal: price sync failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [stock?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const globalIntelStore = useGlobalIntelStore();
  const {
    macroEnv, exportRatio, currentRoeType,
    economicRegimeData, extendedRegimeData,
    smartMoneyData, exportMomentumData, geoRiskData, creditSpreadData,
    globalCorrelation, newsFrequencyScores, supplyChainData, financialStressData,
  } = globalIntelStore;
  const { marketOverview } = useMarketStore();
  const { watchlist, setWatchlist } = useRecommendationStore();
  const { setView } = useSettingsStore();
  const { addShadowTrade } = useShadowTradeStore();

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

  const canCloseRef = useRef(false);
  useEffect(() => {
    if (!stock) { canCloseRef.current = false; return; }
    const timer = setTimeout(() => { canCloseRef.current = true; }, 300);
    return () => { clearTimeout(timer); canCloseRef.current = false; };
  }, [stock?.code]);

  return (
    <AnimatePresence>
      {stock && (
        <motion.div
          key="deep-analysis-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-3 md:p-5 bg-black/90 backdrop-blur-md"
          onClick={(e: React.MouseEvent) => {
            if (e.target === e.currentTarget && canCloseRef.current) onClose();
          }}
        >
          <motion.div
            key="deep-analysis-content"
            ref={analysisReportRef}
            initial={{ scale: 0.95, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 30 }}
            className="glass-3d rounded-3xl w-full max-w-[1400px] max-h-[94vh] border border-white/10 shadow-2xl overflow-hidden relative flex flex-col print-section"
            onClick={e => e.stopPropagation()}
          >
            <AnalysisViewToggle>
            {(analysisView, setAnalysisView) => (<>
            {/* Action Buttons - Absolute Positioned */}
            <div className="absolute top-4 right-4 z-[160] flex items-center gap-2 no-print">
              <AnalysisViewButtons analysisView={analysisView} setAnalysisView={setAnalysisView} />
              <button
                onClick={onExportPDF}
                disabled={isExporting}
                className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-blue-500 transition-all group active:scale-90 border border-white/10 backdrop-blur-md shadow-lg"
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-all group active:scale-90 border border-white/10 backdrop-blur-md shadow-lg"
                title="닫기"
              >
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40 group-hover:text-white transition-colors">Close</span>
                <X className="w-4 h-4 text-white/50 group-hover:text-white transition-colors" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 md:p-7 custom-scrollbar">
              {analysisView === 'QUANT' ? (
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
                  onShadowTrade={handleShadowTrade}
                />
              ) : (
                <>
                  <ModalHeader stock={stock} />

                  {/* AI 분석결과 요약 — 한 줄 요약으로 밀도 향상 */}
                  <div className="mb-5 p-4 sm:p-5 rounded-2xl bg-orange-500/5 border border-orange-500/10 flex gap-3 items-start">
                    <Sparkles className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="block text-[10px] font-black text-white/40 uppercase tracking-[0.25em] mb-1.5">AI 분석결과 요약</span>
                      <p className="text-white/90 text-sm sm:text-[15px] leading-relaxed font-bold tracking-tight break-words">
                        {stock.reason}
                      </p>
                    </div>
                  </div>

                  {/* Candle Chart with Technical Overlays */}
                  <div className="mb-6">
                    <CandleChart
                      stockCode={stock.code}
                      stockName={stock.name}
                      gateSignals={deepAnalysisGateSignals}
                      height={380}
                    />
                  </div>

                  {/* Radar Chart & Checklist Overview */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-8">
                    <MasterRadarChart stock={stock} />
                    <KeyChecklistOverview stock={stock} />
                  </div>

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
              )}
            </div>
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
