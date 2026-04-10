import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowRight, Globe, Ship, Cpu, Activity, Shield, CalendarDays,
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
import { computeContrarianSignals, evaluateSectorOverheat, evaluateBearModeSimulator } from '../services/quantEngine';
import { useGlobalIntelStore } from '../stores/useGlobalIntelStore';
import { BearKellyPanel } from './BearKellyPanel';
import { SectorOverheatPanel } from './SectorOverheatPanel';
import { BearModeSimulatorPanel } from './BearModeSimulatorPanel';
import { IPSPanel } from './IPSPanel';
import { debugWarn } from '../utils/debug';

// ─── Fusion Matrix 데이터 (아이디어 8) ──────────────────────────────────────

type AlphaSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | 'AVOID';

interface FusionCell {
  phase: string;
  signal: AlphaSignal;
  expectedReturn: string;
  strategy: string;
}

const FUSION_MATRIX: Record<EconomicRegime, Record<ROEType, FusionCell>> = {
  RECOVERY: {
    1: { phase: '설비투자 초기 진입', signal: 'STRONG_BUY', expectedReturn: '+20~35%', strategy: '경기 회복이 매출로 전환되는 임계점. 아직 실적 없어도 선제 진입 최적기.' },
    2: { phase: '자본경량 회복 초기', signal: 'BUY', expectedReturn: '+12~20%', strategy: 'SaaS·플랫폼 매출 반등 시작. 모멘텀 형성 초기로 조기 매집 유효.' },
    3: { phase: '매출·마진 준비 완료', signal: 'BUY', expectedReturn: '+15~25%', strategy: '성장 폭발 직전 단계. 매집 후 확장기 진입 시 극대화.' },
    4: { phase: '비용절감 후 실적 회복', signal: 'NEUTRAL', expectedReturn: '+5~10%', strategy: '실적 가시성 낮음. 매출 회복 신호 2분기 확인 후 진입.' },
    5: { phase: '구조조정 생존 단계', signal: 'AVOID', expectedReturn: '-∞~+5%', strategy: '회복 여부 불확실. 채무 구조 개선 확인 전 관망 유지.' },
  },
  EXPANSION: {
    1: { phase: '레버리지 확장 수혜', signal: 'BUY', expectedReturn: '+18~28%', strategy: '금리 안정기 레버리지 활용 극대화. 부채비율 분기별 모니터링 필수.' },
    2: { phase: '자본경량 성장 가속', signal: 'BUY', expectedReturn: '+15~22%', strategy: '구독·반복매출 기반 성장 가속. 낮은 자본으로 안정적 알파 창출.' },
    3: { phase: '매출·마진 동반 폭발', signal: 'STRONG_BUY', expectedReturn: '+25~45%', strategy: '연평균 35.8% 수익률 · 83.3% 상승확률 구간. 포트폴리오 집중 투자 최적기.' },
    4: { phase: '비용절감 한계 도달', signal: 'NEUTRAL', expectedReturn: '+3~8%', strategy: '성장 동력 소진. 포트폴리오 내 비중 최소화 및 관찰 유지.' },
    5: { phase: '재무 왜곡 과열 구간', signal: 'AVOID', expectedReturn: '-10~+5%', strategy: '자사주 매입 소진 후 급락 위험. 진입 금지 구간.' },
  },
  SLOWDOWN: {
    1: { phase: '레버리지 위험 노출', signal: 'SELL', expectedReturn: '-15~-5%', strategy: '금리 상승 + 매출 둔화 복합 타격. 부채 의존 기업 즉각 비중 축소.' },
    2: { phase: '자본경량 방어 구간', signal: 'NEUTRAL', expectedReturn: '-5~+5%', strategy: '상대적 선방하나 성장 모멘텀 약화. Hold 또는 일부 차익실현.' },
    3: { phase: '매출 둔화 경고 신호', signal: 'SELL', expectedReturn: '-12~-3%', strategy: '매출 성장 둔화 시작 = 매도 준비 신호. 목표가 95% 도달 시 단계적 청산.' },
    4: { phase: '비용절감 방어 주도', signal: 'BUY', expectedReturn: '+5~12%', strategy: '매출 무관 이익 방어력 부각. 경기방어주·유틸리티 선호 구간.' },
    5: { phase: '재무 왜곡 붕괴 초입', signal: 'STRONG_SELL', expectedReturn: '-30~-15%', strategy: '자본 구조 취약 + 경기 하강 복합 손실. 즉각 청산.' },
  },
  RECESSION: {
    1: { phase: '레버리지 완전 붕괴', signal: 'STRONG_SELL', expectedReturn: '-40~-20%', strategy: '부채 + 매출 급락 복합 타격. 전량 청산 후 현금화 우선.' },
    2: { phase: '자본경량 피난처 역할', signal: 'SELL', expectedReturn: '-8~+2%', strategy: '상대적 방어력 있으나 하락 불가피. 비중 최소화, 현금 확보.' },
    3: { phase: '성장 동력 완전 소멸', signal: 'STRONG_SELL', expectedReturn: '-35~-15%', strategy: '어떤 기술적 반등 신호도 무효. 즉각 전량 청산.' },
    4: { phase: '비용절감 한계 직면', signal: 'NEUTRAL', expectedReturn: '-5~+3%', strategy: '유틸리티·필수소비재 중심 극소 포지션 유지.' },
    5: { phase: '즉각 청산 대상', signal: 'STRONG_SELL', expectedReturn: '-50~-25%', strategy: '어떤 신호도 무효. 즉각 전량 청산. 현금 최대화.' },
  },
  UNCERTAIN: {
    1: { phase: '레버리지 보류', signal: 'AVOID', expectedReturn: '-10~+5%', strategy: '방향성 불확실 시 부채 의존 종목 진입 금지. 현금 비중 70% 유지.' },
    2: { phase: '자본경량 관망', signal: 'NEUTRAL', expectedReturn: '-3~+5%', strategy: '플랫폼 기업 방어력 있으나 모멘텀 부재. 기존 포지션 유지, 신규 진입 보류.' },
    3: { phase: '성장 모멘텀 대기', signal: 'NEUTRAL', expectedReturn: '-5~+8%', strategy: '성장주 수치 확인 후 레짐 전환 시 빠른 진입 준비. 매집 감지 시에만 소규모 진입.' },
    4: { phase: '비용절감 선호', signal: 'BUY', expectedReturn: '+3~10%', strategy: '불확실성 시 비용 통제 기업의 방어력 부각. 유틸리티·통신 중심 소규모 포지션.' },
    5: { phase: '재무 왜곡 회피', signal: 'STRONG_SELL', expectedReturn: '-20~-5%', strategy: '불확실 환경에서 재무 왜곡 기업 최우선 청산 대상.' },
  },
  CRISIS: {
    1: { phase: '레버리지 전면 청산', signal: 'STRONG_SELL', expectedReturn: '-50~-25%', strategy: '위기 시 부채 기업 즉각 전량 청산. 현금 100% 전환.' },
    2: { phase: '자본경량 긴급 축소', signal: 'SELL', expectedReturn: '-15~-5%', strategy: '상대적 방어력 있으나 시장 공포 시 동반 하락. 최소 비중으로 축소.' },
    3: { phase: '성장주 전면 회피', signal: 'STRONG_SELL', expectedReturn: '-40~-15%', strategy: '위기 시 성장주 밸류에이션 급격 붕괴. Gate 평가 중단, 전량 현금화.' },
    4: { phase: '방산·유틸리티 역발상', signal: 'BUY', expectedReturn: '+5~15%', strategy: '위기 시 정부 지출 확대 수혜. 방산·유틸리티·필수소비재 중심 역발상 매수.' },
    5: { phase: '즉시 완전 청산', signal: 'STRONG_SELL', expectedReturn: '-60~-30%', strategy: '위기 시 재무 왜곡 기업 파산 위험. 무조건 즉시 청산.' },
  },
  RANGE_BOUND: {
    1: { phase: '레버리지 제한 진입', signal: 'NEUTRAL', expectedReturn: '-5~+5%', strategy: '박스권 내 레버리지 효과 제한적. 배당 수익 중심 소규모 포지션만.' },
    2: { phase: '자본경량 페어트레이드', signal: 'BUY', expectedReturn: '+3~8%', strategy: '박스권에서 플랫폼 기업 안정적 매출. 페어트레이딩 또는 배당 전략 활용.' },
    3: { phase: '매출·마진 구간 매매', signal: 'NEUTRAL', expectedReturn: '-3~+8%', strategy: '박스권 하단 매수, 상단 매도의 단기 트레이딩. 주도주 부재 시 중립.' },
    4: { phase: '비용절감 안정 수익', signal: 'BUY', expectedReturn: '+5~10%', strategy: '박스권에서 비용 통제 기업의 안정적 이익률 부각. 배당주 전략 최적.' },
    5: { phase: '재무 왜곡 관망', signal: 'AVOID', expectedReturn: '-10~+2%', strategy: '박스권 내 재무 왜곡 기업 방향성 없음. 진입 불가.' },
  },
};

const ROE_TYPE_LABELS: Record<ROEType, string> = {
  1: 'Type 1 · 레버리지 의존',
  2: 'Type 2 · 자본경량 성장',
  3: 'Type 3 · 매출·마진 동반',
  4: 'Type 4 · 비용 통제 방어',
  5: 'Type 5 · 재무 왜곡형',
};

const REGIME_LABELS: Record<EconomicRegime, { ko: string; color: string; bgColor: string; borderColor: string }> = {
  RECOVERY:    { ko: '회복기',   color: 'text-blue-700',    bgColor: 'bg-blue-50',    borderColor: 'border-blue-400' },
  EXPANSION:   { ko: '확장기',   color: 'text-green-700',   bgColor: 'bg-green-50',   borderColor: 'border-green-400' },
  SLOWDOWN:    { ko: '둔화기',   color: 'text-amber-700',   bgColor: 'bg-amber-50',   borderColor: 'border-amber-400' },
  RECESSION:   { ko: '침체기',   color: 'text-red-700',     bgColor: 'bg-red-50',     borderColor: 'border-red-400' },
  UNCERTAIN:   { ko: '불확실',   color: 'text-purple-700',  bgColor: 'bg-purple-50',  borderColor: 'border-purple-400' },
  CRISIS:      { ko: '위기',     color: 'text-rose-700',    bgColor: 'bg-rose-50',    borderColor: 'border-rose-400' },
  RANGE_BOUND: { ko: '박스권',   color: 'text-theme-text-secondary',   bgColor: 'bg-theme-bg',   borderColor: 'border-theme-border' },
};

const SIGNAL_STYLE: Record<AlphaSignal, { label: string; bg: string; text: string }> = {
  STRONG_BUY:  { label: '★ 최강 매수', bg: 'bg-green-700',  text: 'text-white' },
  BUY:         { label: '▲ 매수',      bg: 'bg-green-100',  text: 'text-green-800' },
  NEUTRAL:     { label: '— 관망',      bg: 'bg-theme-card',   text: 'text-theme-text-secondary' },
  SELL:        { label: '▼ 매도',      bg: 'bg-red-100',    text: 'text-red-700' },
  STRONG_SELL: { label: '▼▼ 즉시청산', bg: 'bg-red-700',    text: 'text-white' },
  AVOID:       { label: '✕ 진입금지',  bg: 'bg-theme-text',   text: 'text-theme-text-muted' },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function MHSBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-600' : score >= 40 ? 'bg-amber-500' : 'bg-red-600';
  const label = score >= 70 ? '정상 운용' : score >= 40 ? `MAPC Kelly ${score}% 운용` : '매수 중단';
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">Macro Health Score (MHS)</span>
        <span className="text-sm font-black font-mono">{score} / 100 — {label}</span>
      </div>
      <div className="h-4 w-full bg-theme-card border border-theme-text relative">
        <div
          className={`h-full ${color} transition-all duration-700`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
        {[40, 70].map(threshold => (
          <div
            key={threshold}
            className="absolute top-0 bottom-0 w-px bg-theme-text opacity-40"
            style={{ left: `${threshold}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-red-500 font-black">0 매수중단</span>
        <span className="text-[8px] text-amber-500 font-black ml-[30%]">40 Kelly축소</span>
        <span className="text-[8px] text-green-500 font-black ml-auto">70 정상 100</span>
      </div>
    </div>
  );
}

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
  const mhs = gate0Result?.macroHealthScore ?? 0;

  // ── Gate -1 & VKOSPI 트리거 (전역 스토어에서 읽기) ───────────────────────
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const vkospiTriggerResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const bearSeasonalityResult = useGlobalIntelStore(s => s.bearSeasonalityResult);
  const inverseGate1Result = useGlobalIntelStore(s => s.inverseGate1Result);
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

  const sortedSectors = useMemo(
    () => [...(marketOverview?.sectorRotation ?? [])].sort((a, b) => b.momentum - a.momentum),
    [marketOverview?.sectorRotation]
  );

  // ── Fusion Matrix ────────────────────────────────────────────────────────
  const regimes: EconomicRegime[] = ['RECOVERY', 'EXPANSION', 'SLOWDOWN', 'RECESSION', 'UNCERTAIN', 'CRISIS', 'RANGE_BOUND'];
  const roeTypes: ROEType[] = [1, 2, 3, 4, 5];

  return (
    <div className="space-y-10">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Macro Intelligence</h2>
          <p className="text-[10px] font-mono text-theme-text-muted mt-1">
            거시경제 컨트롤 타워 — 경기 레짐 · MHS · ETF 자금흐름 · FX 임팩트
          </p>
        </div>
        <button
          onClick={loadRegime}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors text-sm font-black uppercase tracking-widest disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'AI 조회 중...' : '레짐 분류 실행'}
        </button>
      </div>

      {error && (
        <div className="p-4 border border-red-400 bg-red-50 text-red-700 text-sm font-bold">
          ⚠ {error}
        </div>
      )}

      {/* ── 경기 레짐 게이지 + MHS 바 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* 경기 레짐 게이지 */}
        <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-6">
            경기 레짐 게이지 — Economic Regime Classifier
          </h3>
          <div className="flex gap-2 mb-6">
            {regimes.map(r => {
              const meta = REGIME_LABELS[r];
              const isActive = r === currentRegime;
              return (
                <div
                  key={r}
                  className={`flex-1 p-3 border-2 text-center transition-all ${
                    isActive
                      ? `${meta.bgColor} ${meta.borderColor} ${meta.color}`
                      : 'border-theme-border text-theme-text-muted bg-theme-bg'
                  }`}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest">{r}</p>
                  <p className={`text-base font-black mt-1 ${isActive ? meta.color : 'text-theme-text-muted'}`}>
                    {meta.ko}
                  </p>
                  {isActive && economicRegime && (
                    <p className="text-[9px] font-mono mt-1">{economicRegime.confidence}% 확신</p>
                  )}
                </div>
              );
            })}
          </div>

          {economicRegime ? (
            <div className="space-y-4">
              <p className="text-xs italic text-theme-text-secondary leading-relaxed">"{economicRegime.rationale}"</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(economicRegime.keyIndicators).map(([k, v]) => (
                  <div key={k} className="p-3 bg-theme-bg border border-theme-border">
                    <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">
                      {k === 'exportGrowth' ? '수출증가율' : k === 'bokRateDirection' ? '기준금리' : k === 'oeciCli' ? 'OECD CLI' : 'GDP 성장률'}
                    </p>
                    <p className="text-sm font-black font-mono mt-1">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-theme-text-muted italic text-center py-4">
              "레짐 분류 실행" 버튼을 눌러 Gemini AI로 현재 경기 사이클을 자동 분류합니다.
            </p>
          )}
        </div>

        {/* MHS + FX + 금리 사이클 */}
        <div className="space-y-6">

          {/* MHS 바 */}
          <div className="p-6 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
            <MHSBar score={mhs} />
            {gate0Result && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  { label: '금리', v: gate0Result.details.interestRateScore },
                  { label: '유동성', v: gate0Result.details.liquidityScore },
                  { label: '경기', v: gate0Result.details.economicScore },
                  { label: '리스크', v: gate0Result.details.riskScore },
                ].map(item => (
                  <div key={item.label} className="p-2 border border-theme-border bg-theme-bg">
                    <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">{item.label}</p>
                    <p className="text-lg font-black font-mono">{item.v}<span className="text-[9px] text-theme-text-muted">/25</span></p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FX + 금리 사이클 인디케이터 */}
          {gate0Result && (
            <div className="p-6 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-4">
                FX · Rate Cycle 임팩트
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-theme-border">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">환율 레짐</p>
                  <p className="text-lg font-black">
                    {gate0Result.fxRegime === 'DOLLAR_STRONG'
                      ? '💵 달러 강세'
                      : gate0Result.fxRegime === 'DOLLAR_WEAK'
                        ? '🌏 달러 약세'
                        : '〰 중립 구간'}
                  </p>
                  <p className="text-[10px] text-theme-text-muted mt-1">
                    {gate0Result.fxRegime === 'DOLLAR_STRONG'
                      ? '수출주 +3pt / 내수주 -3pt'
                      : gate0Result.fxRegime === 'DOLLAR_WEAK'
                        ? '내수주 +3pt / 수출주 -3pt'
                        : 'FX 조정 없음'}
                  </p>
                </div>
                <div className="p-4 border border-theme-border">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">금리 사이클</p>
                  <p className="text-lg font-black">
                    {gate0Result.rateCycle === 'TIGHTENING'
                      ? '🔺 긴축기'
                      : gate0Result.rateCycle === 'EASING'
                        ? '🔻 완화기'
                        : '⏸ 동결기'}
                  </p>
                  <p className="text-[10px] text-theme-text-muted mt-1">
                    {gate0Result.rateCycle === 'TIGHTENING'
                      ? 'ICR 기준 강화 · 레버리지 페널티'
                      : gate0Result.rateCycle === 'EASING'
                        ? '성장주 가중치 +20%'
                        : '기본 모드 유지'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Gate -1 Bear Regime Detector + VKOSPI 트리거 (아이디어 1, 4) ── */}
      {(bearRegimeResult || vkospiTriggerResult) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Gate -1 Bear Regime Detector */}
          {bearRegimeResult && (
            <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
              bearRegimeResult.regime === 'BEAR' ? 'border-red-500'
                : bearRegimeResult.regime === 'TRANSITION' ? 'border-amber-500'
                : 'border-green-500'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  Gate -1 · Market Regime Detector
                </h3>
                <span className={`text-xs font-black px-3 py-1 rounded border ${
                  bearRegimeResult.regime === 'BEAR'
                    ? 'bg-red-900/40 border-red-500 text-red-300'
                    : bearRegimeResult.regime === 'TRANSITION'
                    ? 'bg-amber-900/40 border-amber-500 text-amber-300'
                    : 'bg-green-900/40 border-green-500 text-green-300'
                }`}>
                  {bearRegimeResult.regime === 'BEAR' ? '🔴 BEAR'
                    : bearRegimeResult.regime === 'TRANSITION' ? '🟡 TRANSITION'
                    : '🟢 BULL'}
                </span>
              </div>

              {/* Condition bar */}
              <div className="mb-4">
                <div className="flex justify-between text-[9px] font-black text-theme-text-muted mb-1">
                  <span>BEAR 조건 달성</span>
                  <span>{bearRegimeResult.triggeredCount} / {bearRegimeResult.conditions.length} (기준: {bearRegimeResult.threshold}개 이상)</span>
                </div>
                <div className="h-3 bg-theme-bg border border-theme-border relative overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${
                      bearRegimeResult.regime === 'BEAR' ? 'bg-red-500'
                        : bearRegimeResult.regime === 'TRANSITION' ? 'bg-amber-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${(bearRegimeResult.triggeredCount / bearRegimeResult.conditions.length) * 100}%` }}
                  />
                  {/* Threshold marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/60"
                    style={{ left: `${(bearRegimeResult.threshold / bearRegimeResult.conditions.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Conditions list */}
              <ul className="space-y-1.5 mb-4">
                {bearRegimeResult.conditions.map(cond => (
                  <li key={cond.id} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black ${
                      cond.triggered
                        ? 'bg-red-500/30 border-red-400 text-red-300'
                        : 'bg-theme-bg border-theme-border text-theme-text-muted'
                    }`}>
                      {cond.triggered ? '✓' : '–'}
                    </span>
                    <span className={`leading-snug ${cond.triggered ? 'text-theme-text' : 'text-theme-text-muted'}`}>
                      {cond.name}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Action recommendation */}
              <div className={`p-3 border text-xs leading-relaxed ${
                bearRegimeResult.regime === 'BEAR'
                  ? 'border-red-500/40 bg-red-900/20 text-red-200'
                  : bearRegimeResult.regime === 'TRANSITION'
                  ? 'border-amber-500/40 bg-amber-900/20 text-amber-200'
                  : 'border-green-500/40 bg-green-900/20 text-green-200'
              }`}>
                {bearRegimeResult.actionRecommendation}
              </div>
            </div>
          )}

          {/* VKOSPI 공포지수 트리거 시스템 */}
          {vkospiTriggerResult && (
            <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
              vkospiTriggerResult.level === 'HISTORICAL_FEAR' ? 'border-red-600'
                : vkospiTriggerResult.level === 'ENTRY_2' ? 'border-red-500'
                : vkospiTriggerResult.level === 'ENTRY_1' ? 'border-orange-500'
                : vkospiTriggerResult.level === 'WARNING' ? 'border-amber-500'
                : 'border-theme-border'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  VKOSPI 공포지수 트리거
                </h3>
                <span className={`text-xs font-black px-3 py-1 rounded border font-mono ${
                  vkospiTriggerResult.level === 'HISTORICAL_FEAR' ? 'bg-red-900/50 border-red-500 text-red-200'
                    : vkospiTriggerResult.level === 'ENTRY_2' ? 'bg-red-900/40 border-red-400 text-red-300'
                    : vkospiTriggerResult.level === 'ENTRY_1' ? 'bg-orange-900/40 border-orange-400 text-orange-300'
                    : vkospiTriggerResult.level === 'WARNING' ? 'bg-amber-900/40 border-amber-500 text-amber-300'
                    : 'bg-green-900/40 border-green-500 text-green-300'
                }`}>
                  {vkospiTriggerResult.vkospi.toFixed(1)}
                </span>
              </div>

              {/* VKOSPI Level Gauge */}
              <div className="mb-4 space-y-1">
                {[
                  { label: '정상', threshold: 0, max: 25, color: 'bg-green-500' },
                  { label: '경계', threshold: 25, max: 30, color: 'bg-amber-500' },
                  { label: '1차', threshold: 30, max: 40, color: 'bg-orange-500' },
                  { label: '2차', threshold: 40, max: 50, color: 'bg-red-500' },
                  { label: '역사', threshold: 50, max: 70, color: 'bg-red-700' },
                ].map(tier => {
                  const v = vkospiTriggerResult.vkospi;
                  const inTier = v >= tier.threshold && v < tier.max;
                  const above = v >= tier.max;
                  return (
                    <div key={tier.label} className="flex items-center gap-2 text-[9px] font-black">
                      <span className="w-8 text-right text-theme-text-muted">{tier.threshold}+</span>
                      <div className="flex-1 h-2 bg-theme-bg border border-theme-border overflow-hidden">
                        <div className={`h-full transition-all ${above ? tier.color : inTier ? tier.color + ' opacity-80' : 'bg-transparent'}`}
                          style={{ width: above ? '100%' : inTier ? `${((v - tier.threshold) / (tier.max - tier.threshold)) * 100}%` : '0%' }}
                        />
                      </div>
                      <span className={`w-6 ${inTier ? 'text-white' : 'text-theme-text-muted'}`}>{tier.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Current level description */}
              <p className="text-xs font-bold mb-2">{vkospiTriggerResult.description}</p>
              <div className={`p-3 border text-xs leading-relaxed mb-3 ${
                vkospiTriggerResult.level === 'HISTORICAL_FEAR' ? 'border-red-600/40 bg-red-900/20 text-red-200'
                  : vkospiTriggerResult.level === 'ENTRY_2' ? 'border-red-500/40 bg-red-900/15 text-red-300'
                  : vkospiTriggerResult.level === 'ENTRY_1' ? 'border-orange-500/40 bg-orange-900/20 text-orange-200'
                  : vkospiTriggerResult.level === 'WARNING' ? 'border-amber-500/40 bg-amber-900/20 text-amber-200'
                  : 'border-theme-border bg-theme-bg text-theme-text-secondary'
              }`}>
                {vkospiTriggerResult.actionMessage}
              </div>

              {/* Position summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">현금 비중</p>
                  <p className="text-xl font-black font-mono">{vkospiTriggerResult.cashRatio}%</p>
                </div>
                <div className="p-3 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">인버스 비중</p>
                  <p className={`text-xl font-black font-mono ${vkospiTriggerResult.inversePosition > 0 ? 'text-red-400' : 'text-theme-text-muted'}`}>
                    {vkospiTriggerResult.inversePosition}%
                  </p>
                </div>
              </div>

              {/* Inverse ETFs */}
              {vkospiTriggerResult.inverseEtfSuggestions.length > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">추천 인버스 ETF</p>
                  <ul className="space-y-1">
                    {vkospiTriggerResult.inverseEtfSuggestions.map(etf => (
                      <li key={etf} className="text-[10px] text-theme-text-secondary">• {etf}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* V-Recovery stocks (HISTORICAL_FEAR only) */}
              {vkospiTriggerResult.dualPositionActive && vkospiTriggerResult.vRecoveryStocks && (
                <div className="mt-4 p-3 border border-green-500/30 bg-green-900/10">
                  <p className="text-[9px] font-black text-green-400 uppercase tracking-widest mb-2">
                    🔄 V자 반등 준비 리스트 (듀얼 포지션)
                  </p>
                  <ul className="space-y-0.5">
                    {vkospiTriggerResult.vRecoveryStocks.map(s => (
                      <li key={s} className="text-[10px] text-green-300/80">• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 아이디어 11: 계절성 Bear Calendar ── */}
      {bearSeasonalityResult && (
        <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
          bearSeasonalityResult.isBearSeason ? 'border-red-500' : 'border-theme-border'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
              <CalendarDays className="w-3.5 h-3.5" />
              Bear Calendar · 계절성 약세 레이어
            </h3>
            <span className={`text-xs font-black px-3 py-1 rounded border ${
              bearSeasonalityResult.isBearSeason
                ? 'bg-red-900/40 border-red-500 text-red-300'
                : 'bg-theme-bg border-theme-border text-theme-text-muted'
            }`}>
              {bearSeasonalityResult.isBearSeason ? '🔴 HIGH RISK WINDOW' : '🟢 NORMAL WINDOW'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {bearSeasonalityResult.windows.map(window => (
              <div
                key={window.id}
                className={`p-3 border ${
                  window.active
                    ? 'border-red-500/40 bg-red-900/15'
                    : 'border-theme-border bg-theme-bg'
                }`}
              >
                <p className={`text-[10px] font-black uppercase tracking-widest ${window.active ? 'text-red-300' : 'text-theme-text-muted'}`}>
                  {window.name}
                </p>
                <p className="text-[9px] text-theme-text-muted mt-0.5">{window.period}</p>
                <p className={`text-[10px] mt-1.5 leading-relaxed ${window.active ? 'text-theme-text' : 'text-theme-text-secondary'}`}>
                  {window.description}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="p-3 border border-theme-border bg-theme-bg text-center">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">Gate -1 임계치 조정</p>
              <p className={`text-xl font-black font-mono ${bearSeasonalityResult.gateThresholdAdjustment < 0 ? 'text-red-400' : 'text-theme-text-secondary'}`}>
                {bearSeasonalityResult.gateThresholdAdjustment < 0 ? `${bearSeasonalityResult.gateThresholdAdjustment}` : '0'}
              </p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg text-center">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">인버스 확률 가중치</p>
              <p className={`text-xl font-black font-mono ${bearSeasonalityResult.inverseEntryWeightPct > 0 ? 'text-red-300' : 'text-theme-text-secondary'}`}>
                +{bearSeasonalityResult.inverseEntryWeightPct}%
              </p>
            </div>
            <div className="p-3 border border-theme-border bg-theme-bg text-center">
              <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest">VKOSPI 동반 상승</p>
              <p className={`text-sm font-black ${bearSeasonalityResult.vkospiRisingConfirmed ? 'text-red-300' : 'text-theme-text-secondary'}`}>
                {bearSeasonalityResult.vkospiRisingConfirmed ? '확인됨' : '미확인'}
              </p>
            </div>
          </div>

          <div className={`p-3 border text-xs leading-relaxed ${
            bearSeasonalityResult.isBearSeason
              ? 'border-red-500/40 bg-red-900/20 text-red-200'
              : 'border-theme-border bg-theme-bg text-theme-text-secondary'
          }`}>
            {bearSeasonalityResult.actionMessage}
          </div>
        </div>
      )}

      {/* ── 아이디어 2: Inverse Gate 1 — 인버스 ETF 스코어링 시스템 ── */}
      {inverseGate1Result && (
        <div className={`p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)] ${
          inverseGate1Result.signalType === 'STRONG_BEAR' ? 'border-red-600'
            : inverseGate1Result.signalType === 'PARTIAL' ? 'border-orange-500'
            : 'border-theme-border'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
              <TrendingDown className="w-3.5 h-3.5" />
              Inverse Gate 1 · 인버스 ETF 스코어링 시스템
            </h3>
            <span className={`text-xs font-black px-3 py-1 rounded border ${
              inverseGate1Result.signalType === 'STRONG_BEAR'
                ? 'bg-red-900/50 border-red-500 text-red-200 animate-pulse'
                : inverseGate1Result.signalType === 'PARTIAL'
                ? 'bg-orange-900/40 border-orange-500 text-orange-200'
                : 'bg-theme-bg border-theme-border text-theme-text-muted'
            }`}>
              {inverseGate1Result.signalType === 'STRONG_BEAR' ? '🔴 STRONG BEAR'
                : inverseGate1Result.signalType === 'PARTIAL' ? '🟠 PARTIAL'
                : '🟢 INACTIVE'}
            </span>
          </div>

          {/* Condition progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-[9px] font-black text-theme-text-muted mb-1">
              <span>Bear 필수 조건 달성</span>
              <span>{inverseGate1Result.triggeredCount} / {inverseGate1Result.conditions.length} (전부 충족 시 STRONG BEAR)</span>
            </div>
            <div className="h-3 bg-theme-bg border border-theme-border relative overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ${
                  inverseGate1Result.signalType === 'STRONG_BEAR' ? 'bg-red-600'
                    : inverseGate1Result.signalType === 'PARTIAL' ? 'bg-orange-500'
                    : 'bg-theme-border'
                }`}
                style={{ width: `${(inverseGate1Result.triggeredCount / inverseGate1Result.conditions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Conditions list */}
          <ul className="space-y-1.5 mb-4">
            {inverseGate1Result.conditions.map(cond => (
              <li key={cond.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black ${
                  cond.triggered
                    ? 'bg-red-500/30 border-red-400 text-red-300'
                    : 'bg-theme-bg border-theme-border text-theme-text-muted'
                }`}>
                  {cond.triggered ? '✓' : '–'}
                </span>
                <span className={`leading-snug ${cond.triggered ? 'text-theme-text' : 'text-theme-text-muted'}`}>
                  <span className="font-bold">{cond.name}</span>
                  {cond.triggered && (
                    <span className="opacity-70"> — {cond.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* Action recommendation */}
          <div className={`p-3 border text-xs leading-relaxed ${
            inverseGate1Result.signalType === 'STRONG_BEAR'
              ? 'border-red-600/40 bg-red-900/20 text-red-200'
              : inverseGate1Result.signalType === 'PARTIAL'
              ? 'border-orange-500/40 bg-orange-900/20 text-orange-200'
              : 'border-theme-border bg-theme-bg text-theme-text-secondary'
          }`}>
            {inverseGate1Result.actionMessage}
          </div>

          {/* ETF Recommendations (STRONG_BEAR only) */}
          {inverseGate1Result.etfRecommendations.length > 0 && (
            <div className="mt-4 p-3 border border-red-600/40 bg-red-900/15">
              <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-2">
                🔴 STRONG BEAR 시그널 — 추천 인버스 ETF
              </p>
              <ul className="space-y-1">
                {inverseGate1Result.etfRecommendations.map(etf => (
                  <li key={etf} className="text-[10px] text-red-300">• {etf}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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

      {/* ── 아이디어 11: IPS 통합 변곡점 확률 엔진 ── */}
      <IPSPanel ipsResult={ipsResult} />

      {/* ── 허용 섹터 화이트리스트 ── */}
      {economicRegime && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-4">
              허용 섹터 화이트리스트 ({currentRegime} · {regimeMeta.ko})
            </h3>
            <div className="flex flex-wrap gap-2">
              {economicRegime.allowedSectors.map(s => (
                <span key={s} className={`px-3 py-1 text-xs font-black border-2 ${regimeMeta.borderColor} ${regimeMeta.bgColor} ${regimeMeta.color}`}>
                  ✓ {s}
                </span>
              ))}
            </div>
          </div>
          <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-4">
              회피 섹터 블랙리스트
            </h3>
            <div className="flex flex-wrap gap-2">
              {economicRegime.avoidSectors.length > 0 ? (
                economicRegime.avoidSectors.map(s => (
                  <span key={s} className="px-3 py-1 text-xs font-black border-2 border-red-400 bg-red-50 text-red-700">
                    ✕ {s}
                  </span>
                ))
              ) : (
                <span className="text-xs text-theme-text-muted italic">현재 특별 회피 섹터 없음</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Global ETF 자금 흐름 히트맵 ── */}
      {marketOverview?.globalEtfMonitoring && (
        <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-6">
            글로벌 ETF 자금 흐름 히트맵
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {marketOverview.globalEtfMonitoring.map((etf: any) => {
              const isInflow = etf.flow === 'INFLOW';
              return (
                <div
                  key={etf.name}
                  className={`p-4 border-2 text-center ${
                    isInflow ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'
                  }`}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">{etf.name}</p>
                  <div className={`mt-2 flex items-center justify-center gap-1 font-black ${isInflow ? 'text-green-700' : 'text-red-700'}`}>
                    {isInflow ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    <span className="text-sm">{isInflow ? '+' : ''}{etf.change?.toFixed(2) ?? '—'}%</span>
                  </div>
                  <p className={`text-[9px] font-black mt-1 ${isInflow ? 'text-green-600' : 'text-red-600'}`}>
                    {etf.flow}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 수출 모멘텀 섹터 랭킹 ── */}
      {marketOverview?.sectorRotation && (
        <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted mb-6">
            섹터 모멘텀 랭킹 (수출·자금흐름 기준)
          </h3>
          <div className="space-y-3">
            {sortedSectors.map((s: any, i: number) => {
                const isInflow = s.flow === 'INFLOW';
                return (
                  <div key={s.sector} className="flex items-center gap-4">
                    <span className="text-[10px] font-black text-theme-text-muted w-4 text-right">{i + 1}</span>
                    <span className="text-sm font-black w-20">{s.sector}</span>
                    <div className="flex-1 h-3 bg-theme-card border border-theme-border relative">
                      <div
                        className={`h-full ${isInflow ? 'bg-green-600' : 'bg-red-500'}`}
                        style={{ width: `${s.momentum}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-black font-mono w-8 text-right">{s.momentum}</span>
                    <span className={`text-[9px] font-black w-14 ${isInflow ? 'text-green-600' : 'text-red-500'}`}>
                      {isInflow ? '↑ INFLOW' : '↓ OUTFLOW'}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

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
