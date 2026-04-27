// @responsibility macro 영역 constants 컴포넌트
import { EconomicRegime, ROEType } from '../../types/quant';

export type AlphaSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | 'AVOID';

export interface FusionCell {
  phase: string;
  signal: AlphaSignal;
  expectedReturn: string;
  strategy: string;
}

export const FUSION_MATRIX: Record<EconomicRegime, Record<ROEType, FusionCell>> = {
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

export const ROE_TYPE_LABELS: Record<ROEType, string> = {
  1: 'Type 1 · 레버리지 의존',
  2: 'Type 2 · 자본경량 성장',
  3: 'Type 3 · 매출·마진 동반',
  4: 'Type 4 · 비용 통제 방어',
  5: 'Type 5 · 재무 왜곡형',
};

export const REGIME_LABELS: Record<EconomicRegime, { ko: string; color: string; bgColor: string; borderColor: string }> = {
  RECOVERY:    { ko: '회복기',   color: 'text-blue-700',    bgColor: 'bg-blue-50',    borderColor: 'border-blue-400' },
  EXPANSION:   { ko: '확장기',   color: 'text-green-700',   bgColor: 'bg-green-50',   borderColor: 'border-green-400' },
  SLOWDOWN:    { ko: '둔화기',   color: 'text-amber-700',   bgColor: 'bg-amber-50',   borderColor: 'border-amber-400' },
  RECESSION:   { ko: '침체기',   color: 'text-red-700',     bgColor: 'bg-red-50',     borderColor: 'border-red-400' },
  UNCERTAIN:   { ko: '불확실',   color: 'text-purple-700',  bgColor: 'bg-purple-50',  borderColor: 'border-purple-400' },
  CRISIS:      { ko: '위기',     color: 'text-rose-700',    bgColor: 'bg-rose-50',    borderColor: 'border-rose-400' },
  RANGE_BOUND: { ko: '박스권',   color: 'text-theme-text-secondary',   bgColor: 'bg-theme-bg',   borderColor: 'border-theme-border' },
};

export const SIGNAL_STYLE: Record<AlphaSignal, { label: string; bg: string; text: string }> = {
  STRONG_BUY:  { label: '★ 최강 매수', bg: 'bg-green-700',  text: 'text-white' },
  BUY:         { label: '▲ 매수',      bg: 'bg-green-100',  text: 'text-green-800' },
  NEUTRAL:     { label: '— 관망',      bg: 'bg-theme-card',   text: 'text-theme-text-secondary' },
  SELL:        { label: '▼ 매도',      bg: 'bg-red-100',    text: 'text-red-700' },
  STRONG_SELL: { label: '▼▼ 즉시청산', bg: 'bg-red-700',    text: 'text-white' },
  AVOID:       { label: '✕ 진입금지',  bg: 'bg-theme-text',   text: 'text-theme-text-muted' },
};
