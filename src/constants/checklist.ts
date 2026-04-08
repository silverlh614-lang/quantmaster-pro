import type { LucideIcon } from 'lucide-react';
import {
  RefreshCw, BarChart3, Zap, AlertTriangle, Star, Flame, LayoutGrid,
  ShieldCheck, CheckCircle2, Target, Users, ArrowUpCircle, DollarSign,
  Activity, Building2, Wallet, TrendingUp, Shield, Percent, Maximize2,
  ArrowRightLeft, Sparkles, TrendingDown, XCircle, ArrowDownRight,
  AlertCircle, Newspaper, Clock,
} from 'lucide-react';

export interface ChecklistStep {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  gate: number;
}

export const MASTER_CHECKLIST_STEPS: ChecklistStep[] = [
  { key: 'cycleVerified', title: "주도주 사이클 (Cycle)", desc: "현재 시장의 주도 섹터 및 사이클 부합 여부", icon: RefreshCw, gate: 1 },
  { key: 'roeType3', title: "ROE 유형 3 (ROE Type 3)", desc: "자산회전율과 마진이 동반 상승하는 고품질 성장", icon: BarChart3, gate: 1 },
  { key: 'riskOnEnvironment', title: "시장 환경 (Risk-On)", desc: "삼성 IRI 및 VKOSPI 기반 리스크 온 상태", icon: Zap, gate: 1 },
  { key: 'mechanicalStop', title: "기계적 손절 (-30%)", desc: "리스크 관리를 위한 엄격한 손절 원칙", icon: AlertTriangle, gate: 1 },
  { key: 'notPreviousLeader', title: "신규 주도주 (New Leader)", desc: "과거의 영광이 아닌 새로운 사이클의 주인공", icon: Star, gate: 1 },
  { key: 'supplyInflow', title: "수급 질 개선 (Supply)", desc: "기관 및 외국인의 질적인 수급 유입", icon: Flame, gate: 2 },
  { key: 'ichimokuBreakout', title: "일목균형표 (Ichimoku)", desc: "구름대 돌파 및 후행스팬 역전 확인", icon: LayoutGrid, gate: 2 },
  { key: 'economicMoatVerified', title: "경제적 해자 (Moat)", desc: "브랜드, 네트워크 등 독점적 경쟁력 보유", icon: ShieldCheck, gate: 2 },
  { key: 'technicalGoldenCross', title: "기술적 정배열 (Technical)", desc: "주요 이동평균선의 정배열 및 골든크로스", icon: CheckCircle2, gate: 2 },
  { key: 'volumeSurgeVerified', title: "거래량 실체 (Volume)", desc: "의미 있는 거래량 동반과 매집 흔적", icon: Target, gate: 2 },
  { key: 'institutionalBuying', title: "기관/외인 수급 (Institutional)", desc: "최근 5거래일 이내 유의미한 순매수세 유입", icon: Users, gate: 2 },
  { key: 'consensusTarget', title: "목표가 여력 (Upside)", desc: "증권사 평균 목표가 대비 충분한 상승 여력", icon: ArrowUpCircle, gate: 2 },
  { key: 'earningsSurprise', title: "실적 서프라이즈 (Earnings)", desc: "최근 실적 예상치 상회 및 가이던스 상향", icon: DollarSign, gate: 2 },
  { key: 'performanceReality', title: "실체적 펀더멘털 (Reality)", desc: "수주 잔고 및 실질 이익 등 실체적 데이터 담보", icon: Activity, gate: 2 },
  { key: 'policyAlignment', title: "정책/매크로 부합 (Policy)", desc: "정부 육성 정책 및 글로벌 매크로 환경 부합", icon: Building2, gate: 2 },
  { key: 'ocfQuality', title: "이익의 질 (OCF)", desc: "영업활동현금흐름 > 당기순이익으로 실질적 현금 유입 확인", icon: Wallet, gate: 2 },
  { key: 'relativeStrength', title: "상대 강도 (RS)", desc: "시장 지수 대비 강력한 아웃퍼폼 및 하락장 방어력", icon: Zap, gate: 2 },
  { key: 'momentumRanking', title: "모멘텀 순위 (Momentum)", desc: "업종 내 모멘텀 순위 상위권 진입", icon: TrendingUp, gate: 3 },
  { key: 'psychologicalObjectivity', title: "심리적 객관성 (Psychology)", desc: "보유 효과 등 심리적 편향 배제 및 객관적 판단", icon: Target, gate: 3 },
  { key: 'turtleBreakout', title: "터틀 돌파 (Turtle)", desc: "20일/55일 신고가 돌파 및 ATR 기반 리스크 관리", icon: Shield, gate: 3 },
  { key: 'fibonacciLevel', title: "피보나치 레벨 (Fibonacci)", desc: "주요 되돌림 및 확장 레벨 지지/저항 확인", icon: BarChart3, gate: 3 },
  { key: 'elliottWaveVerified', title: "엘리엇 파동 (Elliott)", desc: "현재 파동 국면(상승 3파 등) 및 추세 지속성 확인", icon: Activity, gate: 3 },
  { key: 'marginAcceleration', title: "마진 가속도 (OPM)", desc: "최근 2~3분기 연속 영업이익률(YoY) 상승 및 레버리지 발생", icon: Percent, gate: 3 },
  { key: 'interestCoverage', title: "재무 방어력 (ICR)", desc: "이자보상배율 3배 초과로 고금리 환경 생존 능력 확보", icon: ShieldCheck, gate: 3 },
  { key: 'vcpPattern', title: "변동성 축소 (VCP)", desc: "주가 수축 및 거래량 마름(Dry-up) 현상으로 에너지 응축", icon: Maximize2, gate: 3 },
  { key: 'divergenceCheck', title: "다이버전스 (Divergence)", desc: "보조지표 역전 현상 부재 확인으로 가짜 돌파 리스크 배제", icon: ArrowRightLeft, gate: 3 },
  { key: 'catalystAnalysis', title: "촉매제 분석 (Catalyst)", desc: "확정 일정(30-60일), 핫 섹터 테마 연관성, DART 공시의 질(수주/소각 등) 기반 가산점 분석", icon: Sparkles, gate: 3 },
];

export interface SellChecklistStep {
  title: string;
  desc: string;
  icon: LucideIcon;
}

export const SELL_CHECKLIST_STEPS: SellChecklistStep[] = [
  { title: '주도주 이탈', desc: '섹터 내 대장주 지위 상실 — 상대강도(RS) 급락', icon: TrendingDown },
  { title: 'ROE 훼손', desc: '이익률 하락 및 자산 효율성 저하 — 영업이익률 2분기 연속 하락', icon: BarChart3 },
  { title: '데드크로스', desc: '주요 이평선 역배열 전환 — 50일선 200일선 하향 돌파', icon: XCircle },
  { title: '수급 이탈', desc: '기관/외인 대량 매도 — 5거래일 연속 순매도', icon: ArrowDownRight },
  { title: '목표가 도달', desc: '산정된 적정 가치 도달 — 목표가 95% 이상 도달', icon: Target },
  { title: '손절가 터치', desc: '기계적 리스크 관리 — 매수가 대비 -8%~-15% 도달', icon: AlertTriangle },
  { title: '유포리아 발생', desc: '과도한 낙관론 및 과열 — RSI 80 이상 및 거래량 폭증', icon: AlertCircle },
  { title: '촉매 소멸', desc: '기대했던 재료 노출 및 소멸 — 뉴스 발표 후 음봉 발생', icon: Newspaper },
  { title: '추세 붕괴', desc: '상승 추세선 하향 이탈 — 추세선 이탈 후 리테스트 실패', icon: Activity },
  { title: '거래량 실린 음봉', desc: '고점에서 대량 거래 동반 하락 — 평균 거래량 3배 이상 음봉', icon: Flame },
];

export const getMarketPhaseInfo = (phase?: string) => {
  const p = phase?.toUpperCase() || 'NEUTRAL';
  switch (p) {
    case 'RISK_ON':
    case 'BULL':
      return {
        label: '강세장 (Bull)',
        description: '시장이 상승 추세에 있으며 투자 심리가 긍정적입니다.',
        recommendation: '적극 매수 및 수익 극대화 전략',
        color: 'text-green-400'
      };
    case 'RISK_OFF':
    case 'BEAR':
      return {
        label: '약세장 (Bear)',
        description: '시장이 하락 추세에 있으며 투자 심리가 위축되어 있습니다.',
        recommendation: '현금 비중 확대 및 보수적 관망',
        color: 'text-red-400'
      };
    case 'SIDEWAYS':
      return {
        label: '횡보장 (Sideways)',
        description: '시장이 뚜렷한 방향성 없이 박스권에서 움직이고 있습니다.',
        recommendation: '박스권 매매 및 개별 종목 장세 대응',
        color: 'text-blue-400'
      };
    case 'TRANSITION':
      return {
        label: '전환기 (Transition)',
        description: '시장의 추세가 변하고 있는 중요한 시점입니다.',
        recommendation: '주도주 교체 확인 및 분할 매수 준비',
        color: 'text-purple-400'
      };
    case 'NEUTRAL':
    default:
      return {
        label: '중립 (Neutral)',
        description: '시장 상황을 분석 중이며 관망세가 짙습니다.',
        recommendation: '시장 방향성 확인 후 진입 결정',
        color: 'text-gray-400'
      };
  }
};
