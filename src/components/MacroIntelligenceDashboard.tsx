import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowRight, Globe, Ship, Cpu,
} from 'lucide-react';
import {
  Gate0Result, EconomicRegimeData, EconomicRegime, ROEType,
  SmartMoneyData, ExportMomentumData, GeopoliticalRiskData,
  CreditSpreadData, ContrarianSignal,
  GlobalCorrelationMatrix, GlobalMultiSourceData, ThemeReverseTrackResult,
  SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex, FomcSentimentAnalysis,
} from '../types/quant';
import {
  getEconomicRegime, getSmartMoneyFlow, getExportMomentum,
  getGeopoliticalRiskScore, getCreditSpreads,
  getGlobalCorrelationMatrix, getGlobalMultiSourceData, trackThemeToKoreaValueChain,
  getSupplyChainIntelligence, getSectorOrderIntelligence, getFinancialStressIndex, getFomcSentimentAnalysis,
} from '../services/stockService';
import { computeContrarianSignals, evaluateSectorOverheat, evaluateBearModeSimulator, evaluateMAPCResult } from '../services/quantEngine';
import { useGlobalIntelStore } from '../stores/useGlobalIntelStore';
import { BearKellyPanel } from './BearKellyPanel';
import { SectorOverheatPanel } from './SectorOverheatPanel';
import { BearModeSimulatorPanel } from './BearModeSimulatorPanel';
import { IPSPanel } from './IPSPanel';
import { FSSPanel } from './FSSPanel';
import { MIPDashboard } from './MIPDashboard';
import { MAPCPanel } from './MAPCPanel';
import { debugWarn } from '../utils/debug';

import { FUSION_MATRIX, ROE_TYPE_LABELS, REGIME_LABELS, SIGNAL_STYLE, AlphaSignal, FusionCell } from './macro/constants';
import { RegimeGaugeSection } from './macro/RegimeGaugeSection';
import { BearRegimeSection } from './macro/BearRegimeSection';
import { MarketOverviewSection } from './macro/MarketOverviewSection';

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

  const [smartMoney, setSmartMoney] = useState<SmartMoneyData | null>(null);
  const [smartMoneyLoading, setSmartMoneyLoading] = useState(false);

  const [exportMomentum, setExportMomentum] = useState<ExportMomentumData | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const [geoRisk, setGeoRisk] = useState<GeopoliticalRiskData | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const [creditSpread, setCreditSpread] = useState<CreditSpreadData | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);

  const [globalCorrelation, setGlobalCorrelation] = useState<GlobalCorrelationMatrix | null>(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);

  const [globalMultiSource, setGlobalMultiSource] = useState<GlobalMultiSourceData | null>(null);
  const [multiSourceLoading, setMultiSourceLoading] = useState(false);

  const [themeResults, setThemeResults] = useState<ThemeReverseTrackResult[]>([]);
  const [themeLoading, setThemeLoading] = useState(false);

  // 레이어 I~L 상태 (외부 props 있으면 사용, 없으면 내부 로드)
  const [supplyChain, setSupplyChain] = useState<SupplyChainIntelligence | null>(externalSupplyChain ?? null);
  const [supplyChainLoading, setSupplyChainLoading] = useState(false);
  const [sectorOrders, setSectorOrders] = useState<SectorOrderIntelligence | null>(externalSectorOrders ?? null);
  const [sectorOrdersLoading, setSectorOrdersLoading] = useState(false);
  const [fsi, setFsi] = useState<FinancialStressIndex | null>(externalFsi ?? null);
  const [fsiLoading, setFsiLoading] = useState(false);
  const [fomcSentiment, setFomcSentiment] = useState<FomcSentimentAnalysis | null>(externalFomcSentiment ?? null);
  const [fomcLoading, setFomcLoading] = useState(false);

  // 역발상 신호는 gate0Result + marketOverview 기반 순수 계산 (AI 불필요)
  const contrarianSignals: ContrarianSignal[] = useMemo(() => {
    if (!gate0Result) return [];
    return computeContrarianSignals(
      undefined, // economicRegime: dashboard에서는 선택적 표시
      gate0Result.fxRegime,
      0,  // vix: gate0Result에 직접 노출되지 않으므로 표시용 0
      0,  // exportGrowth: 표시용
      '', // sectorName: 전체 시장 뷰에서는 섹터 미지정
    );
  }, [gate0Result]);

  useEffect(() => {
    if (externalRegime) setEconomicRegime(externalRegime);
  }, [externalRegime]);
  useEffect(() => { if (externalSupplyChain) setSupplyChain(externalSupplyChain); }, [externalSupplyChain]);
  useEffect(() => { if (externalSectorOrders) setSectorOrders(externalSectorOrders); }, [externalSectorOrders]);
  useEffect(() => { if (externalFsi) setFsi(externalFsi); }, [externalFsi]);
  useEffect(() => { if (externalFomcSentiment) setFomcSentiment(externalFomcSentiment); }, [externalFomcSentiment]);

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

  const loadSmartMoney = async () => {
    setSmartMoneyLoading(true);
    try { setSmartMoney(await getSmartMoneyFlow()); }
    catch (err) { console.error('[ERROR] Smart Money 조회 실패:', err); }
    finally { setSmartMoneyLoading(false); }
  };

  const loadExportMomentum = async () => {
    setExportLoading(true);
    try { setExportMomentum(await getExportMomentum()); }
    catch (err) { console.error('[ERROR] Export Momentum 조회 실패:', err); }
    finally { setExportLoading(false); }
  };

  const loadGeoRisk = async () => {
    setGeoLoading(true);
    try { setGeoRisk(await getGeopoliticalRiskScore()); }
    catch (err) { console.error('[ERROR] Geo Risk 조회 실패:', err); }
    finally { setGeoLoading(false); }
  };

  const loadCreditSpread = async () => {
    setCreditLoading(true);
    try { setCreditSpread(await getCreditSpreads()); }
    catch (err) { console.error('[ERROR] Credit Spread 조회 실패:', err); }
    finally { setCreditLoading(false); }
  };

  const loadGlobalCorrelation = async () => {
    setCorrelationLoading(true);
    try { setGlobalCorrelation(await getGlobalCorrelationMatrix()); }
    catch (err) { console.error('[ERROR] Global Correlation 조회 실패:', err); }
    finally { setCorrelationLoading(false); }
  };

  const loadGlobalMultiSource = async () => {
    setMultiSourceLoading(true);
    try { setGlobalMultiSource(await getGlobalMultiSourceData()); }
    catch (err) { console.error('[ERROR] Multi Source 조회 실패:', err); }
    finally { setMultiSourceLoading(false); }
  };

  const loadThemeTracking = async () => {
    setThemeLoading(true);
    try { setThemeResults(await trackThemeToKoreaValueChain()); }
    catch (err) { console.error('[ERROR] Theme Tracking 조회 실패:', err); }
    finally { setThemeLoading(false); }
  };

  const loadSupplyChain = async () => {
    setSupplyChainLoading(true);
    try { setSupplyChain(await getSupplyChainIntelligence()); }
    catch (err) { console.error('[ERROR] Supply Chain 조회 실패:', err); }
    finally { setSupplyChainLoading(false); }
  };

  const loadSectorOrders = async () => {
    setSectorOrdersLoading(true);
    try { setSectorOrders(await getSectorOrderIntelligence()); }
    catch (err) { console.error('[ERROR] Sector Orders 조회 실패:', err); }
    finally { setSectorOrdersLoading(false); }
  };

  const loadFsi = async () => {
    setFsiLoading(true);
    try { setFsi(await getFinancialStressIndex()); }
    catch (err) { console.error('[ERROR] Financial Stress 조회 실패:', err); }
    finally { setFsiLoading(false); }
  };

  const loadFomcSentiment = async () => {
    setFomcLoading(true);
    try { setFomcSentiment(await getFomcSentimentAnalysis()); }
    catch (err) { console.error('[ERROR] FOMC Sentiment 조회 실패:', err); }
    finally { setFomcLoading(false); }
  };

  const currentRegime: EconomicRegime = economicRegime?.regime ?? 'EXPANSION';
  const regimeMeta = REGIME_LABELS[currentRegime];

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

  // ── Fusion Matrix ────────────────────────────────────────────────────────
  const regimes: EconomicRegime[] = ['RECOVERY', 'EXPANSION', 'SLOWDOWN', 'RECESSION', 'UNCERTAIN', 'CRISIS', 'RANGE_BOUND'];
  const roeTypes: ROEType[] = [1, 2, 3, 4, 5];

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

      {/* ── 아이디어 4: Smart Money Radar ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
              Smart Money Radar — 글로벌 ETF 선행 모니터
            </h3>
            {smartMoney && (
              <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {smartMoney.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadSmartMoney}
            disabled={smartMoneyLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw size={12} className={smartMoneyLoading ? 'animate-spin' : ''} />
            {smartMoneyLoading ? '조회 중...' : 'Smart Money 조회'}
          </button>
        </div>

        {smartMoney ? (
          <div className="space-y-6">
            {/* Score + Signal */}
            <div className="flex items-center gap-6">
              <div className="text-center p-4 border-2 border-theme-text w-28">
                <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">SMF 점수</p>
                <p className="text-fluid-4xl font-black font-mono mt-1">{smartMoney.score}</p>
                <p className="text-[9px] text-theme-text-muted font-mono">/10</p>
              </div>
              <div className="flex-1 space-y-2">
                <div className={`inline-flex items-center gap-2 px-4 py-2 font-black text-sm border-2 ${
                  smartMoney.signal === 'BULLISH' ? 'border-green-600 bg-green-50 text-green-700'
                  : smartMoney.signal === 'BEARISH' ? 'border-red-600 bg-red-50 text-red-700'
                  : 'border-gray-400 bg-theme-bg text-theme-text-secondary'
                }`}>
                  {smartMoney.signal === 'BULLISH' ? <TrendingUp size={14} /> : smartMoney.signal === 'BEARISH' ? <TrendingDown size={14} /> : null}
                  {smartMoney.signal} — 선행 {smartMoney.leadTimeWeeks}
                </div>
                {smartMoney.isEwyMtumBothInflow && (
                  <div className="px-3 py-1.5 bg-green-700 text-white text-[10px] font-black inline-block">
                    ★ EWY + MTUM 동시 유입 → Gate 2 기준 9→8 완화 적용
                  </div>
                )}
              </div>
            </div>

            {/* ETF Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {smartMoney.etfFlows.map(etf => (
                <div
                  key={etf.ticker}
                  className={`p-3 border-2 text-center ${
                    etf.flow === 'INFLOW' ? 'border-green-400 bg-green-50'
                    : etf.flow === 'OUTFLOW' ? 'border-red-400 bg-red-50'
                    : 'border-theme-border bg-theme-bg'
                  }`}
                >
                  <p className="text-[10px] font-black font-mono">{etf.ticker}</p>
                  <p className={`text-lg font-black mt-1 font-mono ${
                    etf.weeklyAumChange >= 0 ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {etf.weeklyAumChange >= 0 ? '+' : ''}{etf.weeklyAumChange.toFixed(1)}%
                  </p>
                  <p className={`text-[8px] font-black mt-1 ${
                    etf.flow === 'INFLOW' ? 'text-green-600'
                    : etf.flow === 'OUTFLOW' ? 'text-red-600'
                    : 'text-theme-text-muted'
                  }`}>{etf.flow}</p>
                  <p className="text-[8px] text-theme-text-muted mt-1 leading-tight">{etf.significance}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-theme-text-muted italic text-center py-4">
            "Smart Money 조회" 버튼을 눌러 글로벌 ETF 자금 흐름을 분석합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 5: 수출 모멘텀 엔진 ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
              <Cpu size={12} className="inline mr-1" />
              수출 모멘텀 섹터 로테이션 엔진
            </h3>
            {exportMomentum && (
              <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {exportMomentum.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadExportMomentum}
            disabled={exportLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw size={12} className={exportLoading ? 'animate-spin' : ''} />
            {exportLoading ? '조회 중...' : '수출 모멘텀 조회'}
          </button>
        </div>

        {exportMomentum ? (
          <div className="space-y-4">
            {/* Hot Sector Badges */}
            {exportMomentum.hotSectors.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {exportMomentum.hotSectors.map(s => (
                  <span key={s} className="px-3 py-1 bg-amber-100 border-2 border-amber-500 text-amber-800 text-xs font-black">
                    🔥 {s} +5% 보너스 적용
                  </span>
                ))}
                {exportMomentum.semiconductorGate2Relax && (
                  <span className="px-3 py-1 bg-blue-100 border-2 border-blue-500 text-blue-800 text-xs font-black">
                    ★ 반도체 3개월 연속 성장 → Gate 2 완화
                  </span>
                )}
                {exportMomentum.shipyardBonus && (
                  <span className="px-3 py-1 bg-cyan-100 border-2 border-cyan-500 text-cyan-800 text-xs font-black">
                    <Ship size={10} className="inline mr-1" />조선 +30% YoY 보너스
                  </span>
                )}
              </div>
            )}

            {/* Product Heatmap */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {exportMomentum.products.map(p => {
                const hot = p.isHot;
                const positive = p.yoyGrowth >= 0;
                return (
                  <div
                    key={p.product}
                    className={`p-4 border-2 text-center ${
                      hot ? 'border-amber-500 bg-amber-50'
                      : positive ? 'border-green-300 bg-green-50'
                      : 'border-red-300 bg-red-50'
                    }`}
                  >
                    <p className="text-[10px] font-black">{p.product}</p>
                    <p className={`text-2xl font-black font-mono mt-2 ${
                      positive ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {positive ? '+' : ''}{p.yoyGrowth.toFixed(1)}%
                    </p>
                    <p className="text-[8px] text-theme-text-muted mt-1">YoY</p>
                    {hot && <p className="text-[8px] font-black text-amber-700 mt-1">🔥 HOT</p>}
                    {p.consecutiveGrowthMonths && (
                      <p className="text-[8px] text-blue-600 font-black mt-1">{p.consecutiveGrowthMonths}개월 연속↑</p>
                    )}
                    <p className="text-[8px] text-theme-text-muted mt-1 leading-tight">{p.sector}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-theme-text-muted italic text-center py-4">
            "수출 모멘텀 조회" 버튼을 눌러 주요 수출 품목별 YoY 성장률을 분석합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 7: 지정학 리스크 스코어링 모듈 ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
              <Globe size={12} className="inline mr-1" />
              지정학 리스크 스코어링 모듈 (GOS)
            </h3>
            {geoRisk && (
              <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {geoRisk.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadGeoRisk}
            disabled={geoLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw size={12} className={geoLoading ? 'animate-spin' : ''} />
            {geoLoading ? '조회 중...' : '지정학 리스크 조회'}
          </button>
        </div>

        {geoRisk ? (
          <div className="space-y-6">
            {/* Score + Level */}
            <div className="flex items-center gap-6">
              <div className={`text-center p-4 border-2 w-28 ${
                geoRisk.level === 'OPPORTUNITY' ? 'border-green-600 bg-green-50'
                : geoRisk.level === 'RISK' ? 'border-red-600 bg-red-50'
                : 'border-gray-400 bg-theme-bg'
              }`}>
                <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">GOS</p>
                <p className="text-fluid-4xl font-black font-mono mt-1">{geoRisk.score}</p>
                <p className="text-[9px] text-theme-text-muted font-mono">/10</p>
              </div>
              <div className="flex-1 space-y-2">
                <div className={`inline-flex items-center gap-2 px-4 py-2 font-black text-sm border-2 ${
                  geoRisk.level === 'OPPORTUNITY' ? 'border-green-600 bg-green-50 text-green-700'
                  : geoRisk.level === 'RISK' ? 'border-red-600 bg-red-50 text-red-700'
                  : 'border-gray-400 bg-theme-bg text-theme-text-secondary'
                }`}>
                  {geoRisk.level === 'OPPORTUNITY' ? '★ 지정학 기회 (방산·조선·원자력 Gate 3 완화)'
                  : geoRisk.level === 'RISK' ? '⚠ 지정학 리스크 (지정학 섹터 Kelly 30% 축소)'
                  : '— 중립 구간'}
                </div>
                <div className="flex gap-2">
                  {geoRisk.affectedSectors.map(s => (
                    <span key={s} className="px-2 py-0.5 text-[9px] font-black border border-theme-border bg-theme-card">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* GOS Bar */}
            <div>
              <div className="h-3 w-full bg-theme-card border border-theme-border relative">
                <div
                  className={`h-full transition-all duration-700 ${
                    geoRisk.score >= 7 ? 'bg-green-600' : geoRisk.score >= 4 ? 'bg-theme-text-muted' : 'bg-red-600'
                  }`}
                  style={{ width: `${geoRisk.score * 10}%` }}
                />
                {[3, 7].map(t => (
                  <div
                    key={t}
                    className="absolute top-0 bottom-0 w-px bg-theme-text opacity-40"
                    style={{ left: `${t * 10}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[8px] text-red-500 font-black">0 Kelly축소</span>
                <span className="text-[8px] text-theme-text-muted font-black">3↑ 중립 7↑</span>
                <span className="text-[8px] text-green-600 font-black">Gate3완화 10</span>
              </div>
            </div>

            {/* Tone Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              {[
                { label: '긍정', val: geoRisk.toneBreakdown.positive, color: 'text-green-700 bg-green-50 border-green-300' },
                { label: '중립', val: geoRisk.toneBreakdown.neutral,  color: 'text-theme-text-secondary bg-theme-bg border-theme-border' },
                { label: '부정', val: geoRisk.toneBreakdown.negative, color: 'text-red-700 bg-red-50 border-red-300' },
              ].map(item => (
                <div key={item.label} className={`p-3 border ${item.color}`}>
                  <p className="text-[9px] font-black uppercase tracking-widest">{item.label}</p>
                  <p className="text-2xl font-black font-mono mt-1">{item.val}%</p>
                </div>
              ))}
            </div>

            {/* Headlines */}
            {geoRisk.headlines.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">주요 뉴스 헤드라인</p>
                {geoRisk.headlines.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 border border-theme-border bg-theme-bg">
                    <span className="text-[9px] font-black text-theme-text-muted mt-0.5">{i + 1}.</span>
                    <p className="text-xs text-theme-text leading-snug">{h}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-theme-text-muted italic text-center py-4">
            "지정학 리스크 조회" 버튼을 눌러 Gemini AI 기반 GOS를 산출합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 9: 크레딧 스프레드 조기 경보 시스템 ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
              Credit Spread Sentinel — 채권 시장 조기 경보
            </h3>
            {creditSpread && (
              <p className="text-[9px] font-mono text-theme-text-muted mt-1">업데이트: {creditSpread.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadCreditSpread}
            disabled={creditLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw size={12} className={creditLoading ? 'animate-spin' : ''} />
            {creditLoading ? '조회 중...' : '크레딧 스프레드 조회'}
          </button>
        </div>

        {creditSpread ? (
          <div className="space-y-6">
            {/* Crisis Alert Banner */}
            {creditSpread.isCrisisAlert && (
              <div className="p-4 border-2 border-red-600 bg-red-50 text-red-700 font-black text-sm">
                🚨 신용 위기 경보 — AA- 스프레드 {creditSpread.krCorporateSpread}bp ≥ 150bp 임계치 돌파
                <p className="text-xs font-normal mt-1">Gate 1 부채비율 ≤50% 조건 자동 발동 · Kelly 전면 50% 하향</p>
              </div>
            )}
            {creditSpread.isLiquidityExpanding && (
              <div className="p-4 border-2 border-green-500 bg-green-50 text-green-700 font-black text-sm">
                ★ 유동성 확장 환경 — 스프레드 축소 추세 감지 → Gate 2 통과 조건 완화
              </div>
            )}

            {/* Trend Badge */}
            <div className="flex items-center gap-3">
              <span className={`px-4 py-1.5 text-xs font-black border-2 ${
                creditSpread.trend === 'WIDENING'  ? 'border-red-500 bg-red-50 text-red-700'
                : creditSpread.trend === 'NARROWING' ? 'border-green-500 bg-green-50 text-green-700'
                : 'border-gray-400 bg-theme-bg text-theme-text-secondary'
              }`}>
                {creditSpread.trend === 'WIDENING' ? '▲ WIDENING — 신용 스트레스'
                  : creditSpread.trend === 'NARROWING' ? '▼ NARROWING — 유동성 확장'
                  : '〰 STABLE — 안정 구간'}
              </span>
            </div>

            {/* 3 Spread Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[
                {
                  label: '한국 AA- 회사채',
                  sublabel: '국채 대비 스프레드',
                  val: creditSpread.krCorporateSpread,
                  danger: creditSpread.krCorporateSpread >= 150,
                  warn: creditSpread.krCorporateSpread >= 100,
                },
                {
                  label: '미국 하이일드',
                  sublabel: 'ICE BofA HY OAS',
                  val: creditSpread.usHySpread,
                  danger: creditSpread.usHySpread >= 600,
                  warn: creditSpread.usHySpread >= 400,
                },
                {
                  label: '신흥국 EMBI+',
                  sublabel: 'JPMorgan EMBI+',
                  val: creditSpread.embiSpread,
                  danger: creditSpread.embiSpread >= 600,
                  warn: creditSpread.embiSpread >= 450,
                },
              ].map(item => (
                <div
                  key={item.label}
                  className={`p-5 border-2 text-center ${
                    item.danger ? 'border-red-600 bg-red-50'
                    : item.warn ? 'border-amber-500 bg-amber-50'
                    : 'border-green-400 bg-green-50'
                  }`}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">{item.label}</p>
                  <p className="text-[8px] text-theme-text-muted mt-0.5">{item.sublabel}</p>
                  <p className={`text-fluid-3xl font-black font-mono mt-3 ${
                    item.danger ? 'text-red-700' : item.warn ? 'text-amber-700' : 'text-green-700'
                  }`}>{item.val}</p>
                  <p className="text-[9px] text-theme-text-muted mt-1">bp</p>
                  {item.danger && <p className="text-[8px] font-black text-red-600 mt-2">⚠ 위기 임계치 초과</p>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-theme-text-muted italic text-center py-4">
            "크레딧 스프레드 조회" 버튼을 눌러 채권 시장 조기 경보 신호를 분석합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 11: 역발상 카운터사이클 알고리즘 ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            Contrarian Counter-Cycle Engine — 역발상 카운터사이클
          </h3>
          <p className="text-[9px] font-mono text-theme-text-muted mt-1">
            거시 악재가 특정 섹터의 매수 신호가 되는 역설을 기계적으로 시스템화
          </p>
        </div>

        <div className="space-y-3">
          {[
            {
              id: 'RECESSION_DEFENSE',
              name: '침체기 방산 역발상',
              description: '경기 RECESSION 레짐 → 정부 방산 예산 확대 기대 → 방산주 Gate 3 +5pt',
              condition: '경기 레짐: RECESSION + 대상 섹터: 방산·방위산업',
              bonus: 5,
              triggerColor: 'border-green-500 bg-green-50 text-green-700',
              idleColor: 'border-theme-border bg-theme-bg text-theme-text-muted',
            },
            {
              id: 'DOLLAR_STRONG_HEALTHCARE',
              name: '달러강세 헬스케어 역발상',
              description: '달러 강세 + 수출 둔화 → 내수 헬스케어 상대적 수혜 → Gate 3 +3pt',
              condition: 'FX 레짐: DOLLAR_STRONG + 수출증가율 < 0 + 대상 섹터: 헬스케어·바이오',
              bonus: 3,
              triggerColor: 'border-blue-500 bg-blue-50 text-blue-700',
              idleColor: 'border-theme-border bg-theme-bg text-theme-text-muted',
            },
            {
              id: 'VIX_FEAR_PEAK',
              name: 'VIX 공포 극점 역발상',
              description: 'VIX ≥ 35 공포 극점 → 통계적 과매도 → 전 섹터 Gate 3 +3pt',
              condition: 'VIX ≥ 35 (공황 수준 공포 지수)',
              bonus: 3,
              triggerColor: 'border-purple-500 bg-purple-50 text-purple-700',
              idleColor: 'border-theme-border bg-theme-bg text-theme-text-muted',
            },
          ].map(signal => {
            const matched = contrarianSignals.find(s => s.id === signal.id);
            const isActive = matched?.active ?? false;
            return (
              <div
                key={signal.id}
                className={`p-5 border-2 ${isActive ? signal.triggerColor : signal.idleColor}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-black px-2 py-0.5 border ${
                        isActive ? 'border-current bg-theme-card bg-opacity-50' : 'border-theme-border bg-theme-card'
                      }`}>
                        {isActive ? '▶ 발동' : '— 미발동'}
                      </span>
                      <span className="text-xs font-black">{signal.name}</span>
                    </div>
                    <p className="text-[10px] leading-relaxed opacity-80">{signal.description}</p>
                    <p className="text-[9px] font-mono mt-1 opacity-60">조건: {signal.condition}</p>
                  </div>
                  <div className="text-center flex-shrink-0">
                    <p className="text-[9px] font-black opacity-60 uppercase tracking-widest">보너스</p>
                    <p className={`text-2xl font-black font-mono ${isActive ? '' : 'opacity-30'}`}>
                      +{signal.bonus}
                    </p>
                    <p className="text-[8px] opacity-60">pt</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 p-3 bg-theme-bg border border-theme-border">
          <p className="text-[9px] text-theme-text-muted font-mono">
            ※ 역발상 신호는 종목 평가 시 섹터·VIX·FX 레짐 정보가 입력된 경우 자동 발동됩니다.
            Macro Intelligence 탭은 현재 게이트 환경만 표시합니다.
          </p>
        </div>
      </div>

      {/* ── 아이디어 8: 경기사이클 × ROE유형 융합 매트릭스 ── */}
      <div className="border border-theme-text bg-theme-card shadow-[8px_8px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="p-8 border-b border-theme-text">
          <h3 className="text-xl font-black uppercase tracking-tight">
            Macro-Micro Fusion Matrix
          </h3>
          <p className="text-[10px] font-mono text-theme-text-muted mt-1">
            경기사이클 4단계 × ROE 5유형 → 20개 투자 국면 알파 지도
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr>
                <th className="p-3 border border-theme-border bg-theme-bg text-[9px] font-black uppercase tracking-widest text-left w-36">
                  ROE 유형 ↓ / 레짐 →
                </th>
                {regimes.map(r => (
                  <th
                    key={r}
                    className={`p-3 border border-theme-border text-[9px] font-black uppercase tracking-widest text-center ${
                      r === currentRegime ? REGIME_LABELS[r].bgColor : 'bg-theme-bg'
                    }`}
                  >
                    <span className={r === currentRegime ? REGIME_LABELS[r].color : 'text-theme-text-muted'}>
                      {r === currentRegime ? '▶ ' : ''}{REGIME_LABELS[r].ko}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roeTypes.map(roeType => (
                <tr key={roeType}>
                  <td
                    className={`p-3 border border-theme-border text-[9px] font-black ${
                      roeType === currentRoeType ? 'bg-theme-text text-white' : 'bg-theme-bg text-theme-text-secondary'
                    }`}
                  >
                    {roeType === currentRoeType ? '▶ ' : ''}{ROE_TYPE_LABELS[roeType]}
                  </td>
                  {regimes.map(regime => {
                    const cell = FUSION_MATRIX[regime][roeType];
                    const style = SIGNAL_STYLE[cell.signal];
                    const isCurrentPosition = regime === currentRegime && roeType === currentRoeType;
                    return (
                      <td
                        key={regime}
                        className={`p-3 border-2 transition-all ${
                          isCurrentPosition
                            ? 'border-theme-text ring-2 ring-inset ring-[#141414]'
                            : 'border-theme-border'
                        } ${style.bg}`}
                        title={cell.strategy}
                      >
                        <div className="space-y-1">
                          <span className={`text-[9px] font-black block ${style.text}`}>
                            {style.label}
                          </span>
                          <span className={`text-[8px] font-mono block ${style.text} opacity-80`}>
                            {cell.expectedReturn}
                          </span>
                          <span className={`text-[8px] leading-tight block ${style.text} opacity-70`}>
                            {cell.phase}
                          </span>
                          {isCurrentPosition && (
                            <span className={`text-[8px] font-black block mt-1 underline ${style.text}`}>
                              ← 현재 위치
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 현재 위치 전략 하이라이트 */}
        {(() => {
          const regimeRow = FUSION_MATRIX[currentRegime] as Record<number, FusionCell> | undefined;
          const currentCell = regimeRow?.[currentRoeType as number];
          if (!currentCell) return null;
          const style = SIGNAL_STYLE[currentCell.signal as AlphaSignal];
          if (!style) return null;
          return (
            <div className={`p-6 border-t border-theme-text ${style.bg}`}>
              <div className="flex items-start gap-4">
                <ArrowRight size={20} className={`flex-shrink-0 mt-0.5 ${style.text}`} />
                <div>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${style.text}`}>
                    현재 위치: {REGIME_LABELS[currentRegime]?.ko} + {(ROE_TYPE_LABELS as Record<number, string>)[currentRoeType as number]} → {currentCell.phase}
                  </p>
                  <p className={`text-sm font-bold leading-relaxed ${style.text}`}>
                    {currentCell.strategy}
                  </p>
                  <p className={`text-[10px] font-mono mt-2 opacity-80 ${style.text}`}>
                    기대 수익률: {currentCell.expectedReturn}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── 글로벌 멀티소스 인텔리전스 (D) ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            글로벌 멀티소스 인텔리전스 — Fed·China·TSMC·BOJ·ISM
          </h3>
          <button onClick={loadGlobalMultiSource} disabled={multiSourceLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={multiSourceLoading ? 'animate-spin' : ''} />
            {multiSourceLoading ? '수집 중...' : '글로벌 데이터 수집'}
          </button>
        </div>
        {globalMultiSource ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">FED WATCH</p>
              <p className="text-lg font-bold font-mono">{globalMultiSource.fedWatch.cutProbability}%</p>
              <p className="text-[9px] text-theme-text-muted">금리인하 확률</p>
              <p className="text-[8px] text-theme-text-muted mt-1">다음 회의: {globalMultiSource.fedWatch.nextMeetingDate}</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">CHINA PMI</p>
              <p className={`text-lg font-bold font-mono ${globalMultiSource.chinaPmi.manufacturing >= 50 ? 'text-green-700' : 'text-red-700'}`}>
                {globalMultiSource.chinaPmi.manufacturing}
              </p>
              <p className="text-[9px] text-theme-text-muted">제조업 ({globalMultiSource.chinaPmi.trend})</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">TSMC REVENUE</p>
              <p className={`text-lg font-bold font-mono ${globalMultiSource.tsmcRevenue.yoyGrowth > 0 ? 'text-green-700' : 'text-red-700'}`}>
                {globalMultiSource.tsmcRevenue.yoyGrowth > 0 ? '+' : ''}{globalMultiSource.tsmcRevenue.yoyGrowth}%
              </p>
              <p className="text-[9px] text-theme-text-muted">YoY ({globalMultiSource.tsmcRevenue.trend})</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">BOJ POLICY</p>
              <p className="text-lg font-bold font-mono">{globalMultiSource.bojPolicy.currentRate}%</p>
              <p className={`text-[9px] ${globalMultiSource.bojPolicy.yenCarryRisk === 'HIGH' ? 'text-red-600 font-bold' : 'text-theme-text-muted'}`}>
                캐리리스크: {globalMultiSource.bojPolicy.yenCarryRisk}
              </p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">US ISM MFG</p>
              <p className={`text-lg font-bold font-mono ${globalMultiSource.usIsm.manufacturing >= 50 ? 'text-green-700' : 'text-red-700'}`}>
                {globalMultiSource.usIsm.manufacturing}
              </p>
              <p className="text-[9px] text-theme-text-muted">{globalMultiSource.usIsm.trend}</p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg">
              <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">US CPI / 실업률</p>
              <p className="text-lg font-bold font-mono">{globalMultiSource.fredData.usCpi}%</p>
              <p className="text-[9px] text-theme-text-muted">실업률 {globalMultiSource.fredData.usUnemployment}%</p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">'글로벌 데이터 수집' 버튼으로 최신 데이터를 불러오세요.</p>
        )}
      </div>

      {/* ── 글로벌 상관관계 매트릭스 (C) ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            글로벌 상관관계 매트릭스 — Decoupling / Synchronization Detector
          </h3>
          <button onClick={loadGlobalCorrelation} disabled={correlationLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={correlationLoading ? 'animate-spin' : ''} />
            {correlationLoading ? '분석 중...' : '상관관계 분석'}
          </button>
        </div>
        {globalCorrelation ? (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { label: 'KOSPI-S&P500', value: globalCorrelation.kospiSp500, normal: '0.6~0.8' },
                { label: 'KOSPI-닛케이', value: globalCorrelation.kospiNikkei, normal: '0.5~0.7' },
                { label: 'KOSPI-상해종합', value: globalCorrelation.kospiShanghai, normal: '0.3~0.6' },
                { label: 'KOSPI-DXY', value: globalCorrelation.kospiDxy, normal: '-0.3~-0.6' },
              ].map(item => (
                <div key={item.label} className="p-3 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[8px] font-black uppercase text-theme-text-muted mb-1">{item.label}</p>
                  <p className={`text-2xl font-bold font-mono ${
                    Math.abs(item.value) > 0.8 ? 'text-red-600' : Math.abs(item.value) < 0.3 ? 'text-purple-600' : 'text-theme-text'
                  }`}>
                    {item.value > 0 ? '+' : ''}{item.value.toFixed(2)}
                  </p>
                  <p className="text-[8px] text-theme-text-muted mt-1">정상: {item.normal}</p>
                </div>
              ))}
            </div>
            {(globalCorrelation.isDecoupling || globalCorrelation.isGlobalSync) && (
              <div className={`p-4 border-2 ${globalCorrelation.isDecoupling ? 'border-purple-400 bg-purple-50' : 'border-red-400 bg-red-50'}`}>
                <p className={`text-sm font-black ${globalCorrelation.isDecoupling ? 'text-purple-700' : 'text-red-700'}`}>
                  {globalCorrelation.isDecoupling
                    ? '⚠ 디커플링 감지: KOSPI-S&P500 상관관계 급락. 한국 특수 요인 발생. 27개 조건 재가중치 필요.'
                    : '⚠ 글로벌 동조화: 상관계수 0.9+. 외부 충격 전이 모드. 미국 시장이 선행지표.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">'상관관계 분석' 버튼으로 글로벌 상관관계를 분석하세요.</p>
        )}
      </div>

      {/* ── 섹터-테마 역추적 엔진 (H) ── */}
      <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
              섹터-테마 역추적 — Global Theme → Korea Hidden Gems
            </h3>
            <p className="text-[8px] text-theme-text-muted mt-1">글로벌 메가트렌드에서 아직 시장이 연결짓지 못한 한국 숨은 수혜주 발굴</p>
          </div>
          <button onClick={loadThemeTracking} disabled={themeLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={themeLoading ? 'animate-spin' : ''} />
            {themeLoading ? '역추적 중...' : '테마 역추적 실행'}
          </button>
        </div>
        {themeResults.length > 0 ? (
          <div className="space-y-6">
            {themeResults.map((theme, idx) => (
              <div key={idx} className="border border-theme-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-black">{theme.theme}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 border ${
                      theme.investmentTiming === 'OPTIMAL' ? 'border-green-400 bg-green-50 text-green-700' :
                      theme.investmentTiming === 'TOO_EARLY' ? 'border-blue-400 bg-blue-50 text-blue-700' :
                      theme.investmentTiming === 'LATE' ? 'border-amber-400 bg-amber-50 text-amber-700' :
                      'border-red-400 bg-red-50 text-red-700'
                    }`}>
                      {theme.investmentTiming}
                    </span>
                    <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                      theme.globalTrend.momentum === 'ACCELERATING' ? 'border-green-400 text-green-700' :
                      theme.globalTrend.momentum === 'EMERGING' ? 'border-blue-400 text-blue-700' :
                      'border-theme-border text-theme-text-muted'
                    }`}>
                      {theme.globalTrend.momentum}
                    </span>
                  </div>
                  {theme.globalTrend.globalMarketSize && (
                    <span className="text-[9px] font-mono text-theme-text-muted">{theme.globalTrend.globalMarketSize}</span>
                  )}
                </div>
                <p className="text-[10px] text-theme-text-secondary mb-3">{theme.globalTrend.source}</p>

                {/* Hidden Gems 강조 */}
                {theme.hiddenGems.length > 0 && (
                  <div className="mb-3 p-3 border-2 border-emerald-300 bg-emerald-50">
                    <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-2">
                      HIDDEN GEMS — 시장 미인지 수혜주
                    </p>
                    <div className="space-y-2">
                      {theme.hiddenGems.map((gem, gIdx) => (
                        <div key={gIdx} className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-bold text-emerald-800">{gem.company}</span>
                            <span className="text-[9px] text-theme-text-muted ml-2">({gem.code})</span>
                            <span className="text-[9px] text-emerald-600 ml-2">— {gem.role}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] font-mono text-theme-text-secondary">매출비중 {gem.revenueExposure}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 전체 밸류체인 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="text-left p-1.5 font-black uppercase">기업</th>
                        <th className="text-left p-1.5 font-black uppercase">코드</th>
                        <th className="text-left p-1.5 font-black uppercase">역할</th>
                        <th className="text-right p-1.5 font-black uppercase">매출비중</th>
                        <th className="text-center p-1.5 font-black uppercase">인지도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {theme.koreaValueChain.map((vc, vIdx) => (
                        <tr key={vIdx} className={`border-b border-theme-border ${vc.marketAttention === 'HIDDEN' ? 'bg-emerald-50' : ''}`}>
                          <td className="p-1.5 font-bold">{vc.company}</td>
                          <td className="p-1.5 font-mono text-theme-text-muted">{vc.code}</td>
                          <td className="p-1.5 text-theme-text-secondary">{vc.role}</td>
                          <td className="p-1.5 text-right font-mono">{vc.revenueExposure}%</td>
                          <td className="p-1.5 text-center">
                            <span className={`px-1.5 py-0.5 text-[8px] font-black ${
                              vc.marketAttention === 'HIDDEN' ? 'bg-emerald-200 text-emerald-800' :
                              vc.marketAttention === 'EMERGING' ? 'bg-blue-200 text-blue-800' :
                              'bg-theme-card text-theme-text-secondary'
                            }`}>
                              {vc.marketAttention}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">'테마 역추적 실행' 버튼으로 글로벌 테마에서 한국 숨은 수혜주를 발굴하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 I: 공급망 물동량 인텔리전스
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            I. 공급망 물동량 인텔리전스
          </h3>
          <button onClick={loadSupplyChain} disabled={supplyChainLoading}
            className="text-[9px] px-3 py-1 border border-blue-300 text-blue-600 hover:bg-blue-50 font-bold disabled:opacity-50">
            {supplyChainLoading ? '수집 중...' : '공급망 데이터 수집'}
          </button>
        </div>
        {supplyChain ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* BDI */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">Baltic Dry Index</p>
              <p className="text-xl font-black">{supplyChain.bdi.current.toLocaleString()}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  supplyChain.bdi.trend === 'SURGING' || supplyChain.bdi.trend === 'RISING' ? 'border-green-400 text-green-700 bg-green-50' :
                  supplyChain.bdi.trend === 'FALLING' || supplyChain.bdi.trend === 'COLLAPSING' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{supplyChain.bdi.trend}</span>
                <span className={`text-[10px] font-mono ${supplyChain.bdi.mom3Change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  3M {supplyChain.bdi.mom3Change >= 0 ? '+' : ''}{supplyChain.bdi.mom3Change.toFixed(1)}%
                </span>
              </div>
              {supplyChain.bdi.mom3Change >= 20 && (
                <p className="text-[8px] mt-1 px-2 py-0.5 bg-green-100 text-green-800 font-bold">Gate 연동: 조선섹터 Gate 2 완화 -1</p>
              )}
              <p className="text-[9px] text-theme-text-muted mt-2">{supplyChain.bdi.sectorImplication}</p>
            </div>
            {/* SEMI Billings */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">SEMI N.A. Billings</p>
              <p className="text-xl font-black">${supplyChain.semiBillings.latestBillionUSD.toFixed(1)}B</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-mono text-theme-text-secondary">YoY {supplyChain.semiBillings.yoyGrowth >= 0 ? '+' : ''}{supplyChain.semiBillings.yoyGrowth.toFixed(1)}%</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  supplyChain.semiBillings.bookToBill >= 1.1 ? 'border-green-400 text-green-700 bg-green-50' :
                  supplyChain.semiBillings.bookToBill >= 1.0 ? 'border-blue-400 text-blue-700 bg-blue-50' :
                  'border-red-400 text-red-700 bg-red-50'
                }`}>B/B {supplyChain.semiBillings.bookToBill.toFixed(2)}</span>
              </div>
              <p className="text-[9px] text-theme-text-muted mt-2">{supplyChain.semiBillings.implication}</p>
            </div>
            {/* GCFI */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">Container Freight</p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[9px] text-theme-text-muted">상하이→유럽</span>
                  <span className="text-sm font-bold">${supplyChain.gcfi.shanghaiEurope.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[9px] text-theme-text-muted">태평양 횡단</span>
                  <span className="text-sm font-bold">${supplyChain.gcfi.transPacific.toLocaleString()}</span>
                </div>
              </div>
              <span className={`text-[9px] font-bold px-2 py-0.5 border mt-2 inline-block ${
                supplyChain.gcfi.trend === 'RISING' ? 'border-red-400 text-red-700 bg-red-50' :
                supplyChain.gcfi.trend === 'FALLING' ? 'border-green-400 text-green-700 bg-green-50' :
                'border-theme-border text-theme-text-muted'
              }`}>{supplyChain.gcfi.trend}</span>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">BDI·SEMI·컨테이너 운임 데이터를 수집하여 조선·반도체 섹터 선행지표를 확인하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 J: 섹터별 글로벌 수주 인텔리전스
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            J. 섹터별 글로벌 수주 인텔리전스
          </h3>
          <button onClick={loadSectorOrders} disabled={sectorOrdersLoading}
            className="text-[9px] px-3 py-1 border border-amber-300 text-amber-600 hover:bg-amber-50 font-bold disabled:opacity-50">
            {sectorOrdersLoading ? '수집 중...' : '수주 데이터 수집'}
          </button>
        </div>
        {sectorOrders ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* 방산 */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">글로벌 방산</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-black">NATO GDP {sectorOrders.globalDefense.natoGdpAvg.toFixed(1)}%</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  sectorOrders.globalDefense.trend === 'EXPANDING' ? 'border-green-400 text-green-700 bg-green-50' :
                  sectorOrders.globalDefense.trend === 'CUTTING' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{sectorOrders.globalDefense.trend}</span>
              </div>
              <p className="text-[10px] text-theme-text-secondary">미국 국방예산: ${sectorOrders.globalDefense.usDefenseBudget.toLocaleString()}억</p>
              <p className="text-[9px] text-theme-text-muted mt-1">{sectorOrders.globalDefense.koreaExposure}</p>
            </div>
            {/* LNG */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">LNG 발주</p>
              <p className="text-xl font-black">{sectorOrders.lngOrders.newOrdersYTD}<span className="text-xs font-normal text-theme-text-muted ml-1">척 (YTD)</span></p>
              <p className="text-[10px] text-theme-text-secondary mt-1">수주잔고: {sectorOrders.lngOrders.orderBookMonths}개월</p>
              <p className="text-[9px] text-theme-text-muted mt-1">{sectorOrders.lngOrders.qatarEnergy}</p>
              <p className="text-[9px] text-blue-600 mt-1 font-bold">{sectorOrders.lngOrders.implication}</p>
            </div>
            {/* SMR */}
            <div className="border border-theme-border p-3">
              <p className="text-[9px] font-black uppercase text-theme-text-muted mb-2">SMR 원자력</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-black">{sectorOrders.smrContracts.totalGwCapacity} GW</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  sectorOrders.smrContracts.timing === 'OPTIMAL' ? 'border-green-400 text-green-700 bg-green-50' :
                  sectorOrders.smrContracts.timing === 'TOO_EARLY' ? 'border-blue-400 text-blue-700 bg-blue-50' :
                  'border-amber-400 text-amber-700 bg-amber-50'
                }`}>{sectorOrders.smrContracts.timing}</span>
              </div>
              <p className="text-[10px] text-theme-text-secondary">NRC 승인: {sectorOrders.smrContracts.usNrcApprovals}기</p>
              <p className="text-[9px] text-theme-text-muted mt-1">{sectorOrders.smrContracts.koreaHyundai}</p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">방산·LNG·SMR 글로벌 수주 데이터를 수집하여 조·방·원 주도주 사이클을 검증하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 K: 금융시스템 스트레스 인덱스
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            K. 금융시스템 스트레스 인덱스 (FSI)
          </h3>
          <button onClick={loadFsi} disabled={fsiLoading}
            className="text-[9px] px-3 py-1 border border-red-300 text-red-600 hover:bg-red-50 font-bold disabled:opacity-50">
            {fsiLoading ? '수집 중...' : 'FSI 수집'}
          </button>
        </div>
        {fsi ? (
          <div>
            {/* 종합 스코어 바 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-theme-text-muted">종합 FSI</span>
                <span className={`text-sm font-black ${
                  fsi.compositeScore >= 60 ? 'text-red-600' : fsi.compositeScore >= 40 ? 'text-amber-600' : fsi.compositeScore >= 20 ? 'text-yellow-600' : 'text-green-600'
                }`}>{fsi.compositeScore}/100</span>
              </div>
              <div className="w-full h-3 bg-theme-card overflow-hidden">
                <div className={`h-full transition-all ${
                  fsi.compositeScore >= 60 ? 'bg-red-500' : fsi.compositeScore >= 40 ? 'bg-amber-500' : fsi.compositeScore >= 20 ? 'bg-yellow-400' : 'bg-green-400'
                }`} style={{ width: `${fsi.compositeScore}%` }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[8px] text-theme-text-muted">NORMAL</span>
                <span className="text-[8px] text-theme-text-muted">CAUTION</span>
                <span className="text-[8px] text-theme-text-muted">DEFENSIVE</span>
                <span className="text-[8px] text-theme-text-muted">CRISIS</span>
              </div>
            </div>
            <div className={`text-center py-2 mb-4 font-black text-xs ${
              fsi.systemAction === 'CRISIS' ? 'bg-red-100 text-red-800 border border-red-300' :
              fsi.systemAction === 'DEFENSIVE' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
              fsi.systemAction === 'CAUTION' ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' :
              'bg-green-100 text-green-800 border border-green-300'
            }`}>
              {fsi.systemAction === 'CRISIS' ? 'Gate 0 매수 중단 강제 발동 · Kelly 0%' :
               fsi.systemAction === 'DEFENSIVE' ? 'Gate 기준 대폭 강화 · 현금 80%' :
               fsi.systemAction === 'CAUTION' ? '주의 모드 · 신규 매수 축소' :
               '정상 · 금융시스템 안정'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">TED Spread</p>
                <p className="text-lg font-black">{fsi.tedSpread.bps}<span className="text-[9px] font-normal text-theme-text-muted ml-1">bp</span></p>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  fsi.tedSpread.alert === 'CRISIS' ? 'border-red-400 text-red-700 bg-red-50' :
                  fsi.tedSpread.alert === 'ELEVATED' ? 'border-amber-400 text-amber-700 bg-amber-50' :
                  'border-green-400 text-green-700 bg-green-50'
                }`}>{fsi.tedSpread.alert}</span>
              </div>
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">US HY Spread</p>
                <p className="text-lg font-black">{fsi.usHySpread.bps}<span className="text-[9px] font-normal text-theme-text-muted ml-1">bp</span></p>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  fsi.usHySpread.trend === 'WIDENING' ? 'border-red-400 text-red-700 bg-red-50' :
                  fsi.usHySpread.trend === 'TIGHTENING' ? 'border-green-400 text-green-700 bg-green-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{fsi.usHySpread.trend}</span>
              </div>
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">MOVE Index</p>
                <p className="text-lg font-black">{fsi.moveIndex.current}</p>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${
                  fsi.moveIndex.alert === 'EXTREME' ? 'border-red-400 text-red-700 bg-red-50' :
                  fsi.moveIndex.alert === 'ELEVATED' ? 'border-amber-400 text-amber-700 bg-amber-50' :
                  'border-green-400 text-green-700 bg-green-50'
                }`}>{fsi.moveIndex.alert}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">TED Spread·HY Spread·MOVE Index를 수집하여 금융위기 조기경보를 확인하세요.</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          레이어 L: FOMC 문서 감성 분석
         ════════════════════════════════════════════════════════════════════ */}
      <div className="border border-theme-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-theme-text">
            L. FOMC 감성 분석
          </h3>
          <button onClick={loadFomcSentiment} disabled={fomcLoading}
            className="text-[9px] px-3 py-1 border border-indigo-300 text-indigo-600 hover:bg-indigo-50 font-bold disabled:opacity-50">
            {fomcLoading ? '분석 중...' : 'FOMC 분석 실행'}
          </button>
        </div>
        {fomcSentiment ? (
          <div>
            {/* 매파/비둘기파 게이지 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-blue-500">극비둘기 -10</span>
                <span className="text-[9px] font-bold text-theme-text-muted">HAWK/DOVE SCORE</span>
                <span className="text-[9px] font-bold text-red-500">극매파 +10</span>
              </div>
              <div className="relative w-full h-4 bg-gradient-to-r from-blue-200 via-gray-200 to-red-200 overflow-hidden">
                <div className="absolute top-0 h-full w-1 bg-black" style={{ left: `${(fomcSentiment.hawkDovishScore + 10) / 20 * 100}%` }} />
              </div>
              <p className="text-center text-lg font-black mt-2">
                {fomcSentiment.hawkDovishScore > 0 ? '+' : ''}{fomcSentiment.hawkDovishScore}
                <span className="text-xs font-normal text-theme-text-muted ml-2">
                  {fomcSentiment.hawkDovishScore >= 5 ? '매파적' : fomcSentiment.hawkDovishScore <= -5 ? '비둘기파적' : '중립'}
                </span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">점도표 변화</p>
                <span className={`text-xs font-bold px-3 py-1 border ${
                  fomcSentiment.dotPlotShift === 'MORE_CUTS' ? 'border-green-400 text-green-700 bg-green-50' :
                  fomcSentiment.dotPlotShift === 'FEWER_CUTS' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{fomcSentiment.dotPlotShift}</span>
              </div>
              <div className="border border-theme-border p-3 text-center">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">KOSPI 임팩트</p>
                <span className={`text-xs font-bold px-3 py-1 border ${
                  fomcSentiment.kospiImpact === 'BULLISH' ? 'border-green-400 text-green-700 bg-green-50' :
                  fomcSentiment.kospiImpact === 'BEARISH' ? 'border-red-400 text-red-700 bg-red-50' :
                  'border-theme-border text-theme-text-muted'
                }`}>{fomcSentiment.kospiImpact}</span>
              </div>
              <div className="border border-theme-border p-3">
                <p className="text-[9px] font-black uppercase text-theme-text-muted mb-1">핵심 문구</p>
                <div className="flex flex-wrap gap-1">
                  {fomcSentiment.keyPhrases.map((phrase, i) => (
                    <span key={i} className="text-[8px] px-1.5 py-0.5 bg-theme-card text-theme-text-secondary border border-theme-border">{phrase}</span>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-theme-text-secondary italic">{fomcSentiment.rationale}</p>
          </div>
        ) : (
          <p className="text-[10px] text-theme-text-muted italic">FOMC 의사록/성명서 매파·비둘기파 분석으로 한국 증시 영향을 정량화하세요.</p>
        )}
      </div>
    </div>
  );
};
