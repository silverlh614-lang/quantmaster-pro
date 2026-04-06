import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, RefreshCw, ArrowRight, Globe, Ship, Cpu,
} from 'lucide-react';
import {
  Gate0Result, EconomicRegimeData, EconomicRegime, ROEType,
  SmartMoneyData, ExportMomentumData, GeopoliticalRiskData,
  CreditSpreadData, ContrarianSignal,
} from '../types/quant';
import {
  getEconomicRegime, getSmartMoneyFlow, getExportMomentum,
  getGeopoliticalRiskScore, getCreditSpreads,
} from '../services/stockService';
import { computeContrarianSignals } from '../services/quantEngine';

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
  RANGE_BOUND: { ko: '박스권',   color: 'text-slate-700',   bgColor: 'bg-slate-50',   borderColor: 'border-slate-400' },
};

const SIGNAL_STYLE: Record<AlphaSignal, { label: string; bg: string; text: string }> = {
  STRONG_BUY:  { label: '★ 최강 매수', bg: 'bg-green-700',  text: 'text-white' },
  BUY:         { label: '▲ 매수',      bg: 'bg-green-100',  text: 'text-green-800' },
  NEUTRAL:     { label: '— 관망',      bg: 'bg-gray-100',   text: 'text-gray-600' },
  SELL:        { label: '▼ 매도',      bg: 'bg-red-100',    text: 'text-red-700' },
  STRONG_SELL: { label: '▼▼ 즉시청산', bg: 'bg-red-700',    text: 'text-white' },
  AVOID:       { label: '✕ 진입금지',  bg: 'bg-gray-800',   text: 'text-gray-200' },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function MHSBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-600' : score >= 40 ? 'bg-amber-500' : 'bg-red-600';
  const label = score >= 70 ? '정상 운용' : score >= 40 ? 'Kelly 50% 축소' : '매수 중단';
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Macro Health Score (MHS)</span>
        <span className="text-sm font-black font-mono">{score} / 100 — {label}</span>
      </div>
      <div className="h-4 w-full bg-gray-200 border border-[#141414] relative">
        <div
          className={`h-full ${color} transition-all duration-700`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
        {[40, 70].map(threshold => (
          <div
            key={threshold}
            className="absolute top-0 bottom-0 w-px bg-[#141414] opacity-40"
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
}

export const MacroIntelligenceDashboard: React.FC<Props> = ({
  gate0Result,
  currentRoeType = 3,
  marketOverview,
  externalRegime,
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
    finally { setSmartMoneyLoading(false); }
  };

  const loadExportMomentum = async () => {
    setExportLoading(true);
    try { setExportMomentum(await getExportMomentum()); }
    finally { setExportLoading(false); }
  };

  const loadGeoRisk = async () => {
    setGeoLoading(true);
    try { setGeoRisk(await getGeopoliticalRiskScore()); }
    finally { setGeoLoading(false); }
  };

  const loadCreditSpread = async () => {
    setCreditLoading(true);
    try { setCreditSpread(await getCreditSpreads()); }
    finally { setCreditLoading(false); }
  };

  const currentRegime: EconomicRegime = economicRegime?.regime ?? 'EXPANSION';
  const regimeMeta = REGIME_LABELS[currentRegime];
  const mhs = gate0Result?.macroHealthScore ?? 0;

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
          <p className="text-[10px] font-mono text-gray-500 mt-1">
            거시경제 컨트롤 타워 — 경기 레짐 · MHS · ETF 자금흐름 · FX 임팩트
          </p>
        </div>
        <button
          onClick={loadRegime}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-[#141414] bg-white hover:bg-[#141414] hover:text-white transition-colors text-sm font-black uppercase tracking-widest disabled:opacity-50"
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
        <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-6">
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
                      : 'border-gray-200 text-gray-400 bg-gray-50'
                  }`}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest">{r}</p>
                  <p className={`text-base font-black mt-1 ${isActive ? meta.color : 'text-gray-300'}`}>
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
              <p className="text-xs italic text-gray-600 leading-relaxed">"{economicRegime.rationale}"</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(economicRegime.keyIndicators).map(([k, v]) => (
                  <div key={k} className="p-3 bg-gray-50 border border-gray-200">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                      {k === 'exportGrowth' ? '수출증가율' : k === 'bokRateDirection' ? '기준금리' : k === 'oeciCli' ? 'OECD CLI' : 'GDP 성장률'}
                    </p>
                    <p className="text-sm font-black font-mono mt-1">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic text-center py-4">
              "레짐 분류 실행" 버튼을 눌러 Gemini AI로 현재 경기 사이클을 자동 분류합니다.
            </p>
          )}
        </div>

        {/* MHS + FX + 금리 사이클 */}
        <div className="space-y-6">

          {/* MHS 바 */}
          <div className="p-6 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <MHSBar score={mhs} />
            {gate0Result && (
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                {[
                  { label: '금리', v: gate0Result.details.interestRateScore },
                  { label: '유동성', v: gate0Result.details.liquidityScore },
                  { label: '경기', v: gate0Result.details.economicScore },
                  { label: '리스크', v: gate0Result.details.riskScore },
                ].map(item => (
                  <div key={item.label} className="p-2 border border-gray-200 bg-gray-50">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{item.label}</p>
                    <p className="text-lg font-black font-mono">{item.v}<span className="text-[9px] text-gray-400">/25</span></p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FX + 금리 사이클 인디케이터 */}
          {gate0Result && (
            <div className="p-6 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">
                FX · Rate Cycle 임팩트
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-gray-200">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">환율 레짐</p>
                  <p className="text-lg font-black">
                    {gate0Result.fxRegime === 'DOLLAR_STRONG'
                      ? '💵 달러 강세'
                      : gate0Result.fxRegime === 'DOLLAR_WEAK'
                        ? '🌏 달러 약세'
                        : '〰 중립 구간'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {gate0Result.fxRegime === 'DOLLAR_STRONG'
                      ? '수출주 +3pt / 내수주 -3pt'
                      : gate0Result.fxRegime === 'DOLLAR_WEAK'
                        ? '내수주 +3pt / 수출주 -3pt'
                        : 'FX 조정 없음'}
                  </p>
                </div>
                <div className="p-4 border border-gray-200">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">금리 사이클</p>
                  <p className="text-lg font-black">
                    {gate0Result.rateCycle === 'TIGHTENING'
                      ? '🔺 긴축기'
                      : gate0Result.rateCycle === 'EASING'
                        ? '🔻 완화기'
                        : '⏸ 동결기'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
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

      {/* ── 허용 섹터 화이트리스트 ── */}
      {economicRegime && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">
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
          <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">
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
                <span className="text-xs text-gray-400 italic">현재 특별 회피 섹터 없음</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Global ETF 자금 흐름 히트맵 ── */}
      {marketOverview?.globalEtfMonitoring && (
        <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-6">
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
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{etf.name}</p>
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
        <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-6">
            섹터 모멘텀 랭킹 (수출·자금흐름 기준)
          </h3>
          <div className="space-y-3">
            {sortedSectors.map((s: any, i: number) => {
                const isInflow = s.flow === 'INFLOW';
                return (
                  <div key={s.sector} className="flex items-center gap-4">
                    <span className="text-[10px] font-black text-gray-400 w-4 text-right">{i + 1}</span>
                    <span className="text-sm font-black w-20">{s.sector}</span>
                    <div className="flex-1 h-3 bg-gray-100 border border-gray-200 relative">
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
      <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Smart Money Radar — 글로벌 ETF 선행 모니터
            </h3>
            {smartMoney && (
              <p className="text-[9px] font-mono text-gray-400 mt-1">업데이트: {smartMoney.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadSmartMoney}
            disabled={smartMoneyLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw size={12} className={smartMoneyLoading ? 'animate-spin' : ''} />
            {smartMoneyLoading ? '조회 중...' : 'Smart Money 조회'}
          </button>
        </div>

        {smartMoney ? (
          <div className="space-y-6">
            {/* Score + Signal */}
            <div className="flex items-center gap-6">
              <div className="text-center p-4 border-2 border-[#141414] w-28">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">SMF 점수</p>
                <p className="text-4xl font-black font-mono mt-1">{smartMoney.score}</p>
                <p className="text-[9px] text-gray-400 font-mono">/10</p>
              </div>
              <div className="flex-1 space-y-2">
                <div className={`inline-flex items-center gap-2 px-4 py-2 font-black text-sm border-2 ${
                  smartMoney.signal === 'BULLISH' ? 'border-green-600 bg-green-50 text-green-700'
                  : smartMoney.signal === 'BEARISH' ? 'border-red-600 bg-red-50 text-red-700'
                  : 'border-gray-400 bg-gray-50 text-gray-600'
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
            <div className="grid grid-cols-5 gap-3">
              {smartMoney.etfFlows.map(etf => (
                <div
                  key={etf.ticker}
                  className={`p-3 border-2 text-center ${
                    etf.flow === 'INFLOW' ? 'border-green-400 bg-green-50'
                    : etf.flow === 'OUTFLOW' ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 bg-gray-50'
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
                    : 'text-gray-500'
                  }`}>{etf.flow}</p>
                  <p className="text-[8px] text-gray-400 mt-1 leading-tight">{etf.significance}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic text-center py-4">
            "Smart Money 조회" 버튼을 눌러 글로벌 ETF 자금 흐름을 분석합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 5: 수출 모멘텀 엔진 ── */}
      <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Cpu size={12} className="inline mr-1" />
              수출 모멘텀 섹터 로테이션 엔진
            </h3>
            {exportMomentum && (
              <p className="text-[9px] font-mono text-gray-400 mt-1">업데이트: {exportMomentum.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadExportMomentum}
            disabled={exportLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
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
            <div className="grid grid-cols-5 gap-3">
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
                    <p className="text-[8px] text-gray-500 mt-1">YoY</p>
                    {hot && <p className="text-[8px] font-black text-amber-700 mt-1">🔥 HOT</p>}
                    {p.consecutiveGrowthMonths && (
                      <p className="text-[8px] text-blue-600 font-black mt-1">{p.consecutiveGrowthMonths}개월 연속↑</p>
                    )}
                    <p className="text-[8px] text-gray-400 mt-1 leading-tight">{p.sector}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic text-center py-4">
            "수출 모멘텀 조회" 버튼을 눌러 주요 수출 품목별 YoY 성장률을 분석합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 7: 지정학 리스크 스코어링 모듈 ── */}
      <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Globe size={12} className="inline mr-1" />
              지정학 리스크 스코어링 모듈 (GOS)
            </h3>
            {geoRisk && (
              <p className="text-[9px] font-mono text-gray-400 mt-1">업데이트: {geoRisk.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadGeoRisk}
            disabled={geoLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
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
                : 'border-gray-400 bg-gray-50'
              }`}>
                <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">GOS</p>
                <p className="text-4xl font-black font-mono mt-1">{geoRisk.score}</p>
                <p className="text-[9px] text-gray-400 font-mono">/10</p>
              </div>
              <div className="flex-1 space-y-2">
                <div className={`inline-flex items-center gap-2 px-4 py-2 font-black text-sm border-2 ${
                  geoRisk.level === 'OPPORTUNITY' ? 'border-green-600 bg-green-50 text-green-700'
                  : geoRisk.level === 'RISK' ? 'border-red-600 bg-red-50 text-red-700'
                  : 'border-gray-400 bg-gray-50 text-gray-600'
                }`}>
                  {geoRisk.level === 'OPPORTUNITY' ? '★ 지정학 기회 (방산·조선·원자력 Gate 3 완화)'
                  : geoRisk.level === 'RISK' ? '⚠ 지정학 리스크 (지정학 섹터 Kelly 30% 축소)'
                  : '— 중립 구간'}
                </div>
                <div className="flex gap-2">
                  {geoRisk.affectedSectors.map(s => (
                    <span key={s} className="px-2 py-0.5 text-[9px] font-black border border-gray-300 bg-gray-100">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* GOS Bar */}
            <div>
              <div className="h-3 w-full bg-gray-200 border border-gray-300 relative">
                <div
                  className={`h-full transition-all duration-700 ${
                    geoRisk.score >= 7 ? 'bg-green-600' : geoRisk.score >= 4 ? 'bg-gray-400' : 'bg-red-600'
                  }`}
                  style={{ width: `${geoRisk.score * 10}%` }}
                />
                {[3, 7].map(t => (
                  <div
                    key={t}
                    className="absolute top-0 bottom-0 w-px bg-[#141414] opacity-40"
                    style={{ left: `${t * 10}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[8px] text-red-500 font-black">0 Kelly축소</span>
                <span className="text-[8px] text-gray-500 font-black">3↑ 중립 7↑</span>
                <span className="text-[8px] text-green-600 font-black">Gate3완화 10</span>
              </div>
            </div>

            {/* Tone Breakdown */}
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: '긍정', val: geoRisk.toneBreakdown.positive, color: 'text-green-700 bg-green-50 border-green-300' },
                { label: '중립', val: geoRisk.toneBreakdown.neutral,  color: 'text-gray-600 bg-gray-50 border-gray-300' },
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
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">주요 뉴스 헤드라인</p>
                {geoRisk.headlines.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 border border-gray-200 bg-gray-50">
                    <span className="text-[9px] font-black text-gray-400 mt-0.5">{i + 1}.</span>
                    <p className="text-xs text-gray-700 leading-snug">{h}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic text-center py-4">
            "지정학 리스크 조회" 버튼을 눌러 Gemini AI 기반 GOS를 산출합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 9: 크레딧 스프레드 조기 경보 시스템 ── */}
      <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Credit Spread Sentinel — 채권 시장 조기 경보
            </h3>
            {creditSpread && (
              <p className="text-[9px] font-mono text-gray-400 mt-1">업데이트: {creditSpread.lastUpdated}</p>
            )}
          </div>
          <button
            onClick={loadCreditSpread}
            disabled={creditLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-white transition-colors text-xs font-black uppercase tracking-widest disabled:opacity-50"
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
                : 'border-gray-400 bg-gray-50 text-gray-600'
              }`}>
                {creditSpread.trend === 'WIDENING' ? '▲ WIDENING — 신용 스트레스'
                  : creditSpread.trend === 'NARROWING' ? '▼ NARROWING — 유동성 확장'
                  : '〰 STABLE — 안정 구간'}
              </span>
            </div>

            {/* 3 Spread Cards */}
            <div className="grid grid-cols-3 gap-4">
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
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">{item.label}</p>
                  <p className="text-[8px] text-gray-400 mt-0.5">{item.sublabel}</p>
                  <p className={`text-3xl font-black font-mono mt-3 ${
                    item.danger ? 'text-red-700' : item.warn ? 'text-amber-700' : 'text-green-700'
                  }`}>{item.val}</p>
                  <p className="text-[9px] text-gray-400 mt-1">bp</p>
                  {item.danger && <p className="text-[8px] font-black text-red-600 mt-2">⚠ 위기 임계치 초과</p>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic text-center py-4">
            "크레딧 스프레드 조회" 버튼을 눌러 채권 시장 조기 경보 신호를 분석합니다.
          </p>
        )}
      </div>

      {/* ── 아이디어 11: 역발상 카운터사이클 알고리즘 ── */}
      <div className="p-8 border border-[#141414] bg-white shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Contrarian Counter-Cycle Engine — 역발상 카운터사이클
          </h3>
          <p className="text-[9px] font-mono text-gray-400 mt-1">
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
              idleColor: 'border-gray-200 bg-gray-50 text-gray-500',
            },
            {
              id: 'DOLLAR_STRONG_HEALTHCARE',
              name: '달러강세 헬스케어 역발상',
              description: '달러 강세 + 수출 둔화 → 내수 헬스케어 상대적 수혜 → Gate 3 +3pt',
              condition: 'FX 레짐: DOLLAR_STRONG + 수출증가율 < 0 + 대상 섹터: 헬스케어·바이오',
              bonus: 3,
              triggerColor: 'border-blue-500 bg-blue-50 text-blue-700',
              idleColor: 'border-gray-200 bg-gray-50 text-gray-500',
            },
            {
              id: 'VIX_FEAR_PEAK',
              name: 'VIX 공포 극점 역발상',
              description: 'VIX ≥ 35 공포 극점 → 통계적 과매도 → 전 섹터 Gate 3 +3pt',
              condition: 'VIX ≥ 35 (공황 수준 공포 지수)',
              bonus: 3,
              triggerColor: 'border-purple-500 bg-purple-50 text-purple-700',
              idleColor: 'border-gray-200 bg-gray-50 text-gray-500',
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
                        isActive ? 'border-current bg-white bg-opacity-50' : 'border-gray-300 bg-white'
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

        <div className="mt-4 p-3 bg-gray-50 border border-gray-200">
          <p className="text-[9px] text-gray-500 font-mono">
            ※ 역발상 신호는 종목 평가 시 섹터·VIX·FX 레짐 정보가 입력된 경우 자동 발동됩니다.
            Macro Intelligence 탭은 현재 게이트 환경만 표시합니다.
          </p>
        </div>
      </div>

      {/* ── 아이디어 8: 경기사이클 × ROE유형 융합 매트릭스 ── */}
      <div className="border border-[#141414] bg-white shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
        <div className="p-8 border-b border-[#141414]">
          <h3 className="text-xl font-black uppercase tracking-tight">
            Macro-Micro Fusion Matrix
          </h3>
          <p className="text-[10px] font-mono text-gray-500 mt-1">
            경기사이클 4단계 × ROE 5유형 → 20개 투자 국면 알파 지도
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr>
                <th className="p-3 border border-gray-200 bg-gray-50 text-[9px] font-black uppercase tracking-widest text-left w-36">
                  ROE 유형 ↓ / 레짐 →
                </th>
                {regimes.map(r => (
                  <th
                    key={r}
                    className={`p-3 border border-gray-200 text-[9px] font-black uppercase tracking-widest text-center ${
                      r === currentRegime ? REGIME_LABELS[r].bgColor : 'bg-gray-50'
                    }`}
                  >
                    <span className={r === currentRegime ? REGIME_LABELS[r].color : 'text-gray-400'}>
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
                    className={`p-3 border border-gray-200 text-[9px] font-black ${
                      roeType === currentRoeType ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-600'
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
                            ? 'border-[#141414] ring-2 ring-inset ring-[#141414]'
                            : 'border-gray-200'
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
          const currentCell = FUSION_MATRIX[currentRegime][currentRoeType];
          const style = SIGNAL_STYLE[currentCell.signal];
          return (
            <div className={`p-6 border-t border-[#141414] ${style.bg}`}>
              <div className="flex items-start gap-4">
                <ArrowRight size={20} className={`flex-shrink-0 mt-0.5 ${style.text}`} />
                <div>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${style.text}`}>
                    현재 위치: {REGIME_LABELS[currentRegime].ko} + {ROE_TYPE_LABELS[currentRoeType]} → {currentCell.phase}
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
    </div>
  );
};
