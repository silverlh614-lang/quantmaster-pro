// @responsibility enum/상태 토큰 → 한글 표시 라벨 매핑 (표시 전용 — 비교·className·로직 값은 절대 불변).
const DISPLAY_LABELS: Record<string, string> = {
  // 추세·심리
  BULLISH: '강세', BEARISH: '약세', NEUTRAL: '중립', MIXED: '혼조',
  POSITIVE: '긍정', NEGATIVE: '부정',
  // 이동평균·MACD
  GOLDEN_CROSS: '골든크로스', DEAD_CROSS: '데드크로스',
  // 일목균형표
  ABOVE_CLOUD: '구름대 위', BELOW_CLOUD: '구름대 아래', IN_CLOUD: '구름대 안',
  // 감지·상태
  DETECTED: '감지', NORMAL: '정상', NONE: '없음',
  // 방향·수급
  INFLOW: '유입', OUTFLOW: '유출',
  INCREASING: '증가', DECREASING: '감소', FLAT: '보합', STABLE: '안정',
  RISING: '상승', FALLING: '하락', EXPANDING: '확대', CONTRACTING: '축소',
  // 수준
  HIGH: '높음', MEDIUM: '중간', LOW: '낮음', EXTREME: '극단',
  VERY_HIGH: '매우 높음', VERY_LOW: '매우 낮음',
  // 국면·regime
  RISK_ON: '위험 선호', RISK_OFF: '위험 회피',
  BULL: '강세', BEAR: '약세', SIDEWAYS: '횡보', TRANSITION: '전환',
  RECOVERY: '회복', EXPANSION: '확장', SLOWDOWN: '둔화', CONTRACTION: '수축',
  GOLDILOCKS: '골디락스', STAGFLATION: '스태그플레이션', REFLATION: '리플레이션', DEFLATION: '디플레이션',
  // 섹터
  LEADING: '주도', SECONDARY: '후순위', LAGGING: '후행',
  // 심리 상태
  OPTIMAL: '최적', CAUTION: '주의', CRISIS: '위기', CALM: '안정',
  EUPHORIA: '과열', FEAR: '공포', GREED: '탐욕',
  EXTREME_FEAR: '극단적 공포', EXTREME_GREED: '극단적 탐욕',
  // 동조·괴리
  SYNCHRONIZED: '동조', DIVERGED: '괴리', DECOUPLED: '디커플링',
  // 사이클
  EARLY: '초기', MID: '중기', LATE: '후기', PEAK: '정점', TROUGH: '저점',
  // 모멘텀·관심·강도
  ACCELERATING: '가속', EMERGING: '부상', HIDDEN: '미인지', SURGING: '급등', COLLAPSING: '급락',
  WIDENING: '확대', TIGHTENING: '축소', ELEVATED: '경계', CUTTING: '감축', TOO_EARLY: '시기상조',
  // 정책·금리
  MORE_CUTS: '인하 확대', FEWER_CUTS: '인하 축소', HAWKISH: '매파', DOVISH: '비둘기파',
  // 신호 (표시 전용 — SignalBadge 와 별개 경로)
  STRONG_BUY: '적극 매수', BUY: '매수', HOLD: '관망', SELL: '매도', STRONG_SELL: '적극 매도',
  // 이상 징후
  FUNDAMENTAL_DIVERGENCE: '펀더멘털 다이버전스', SMART_MONEY_ACCUMULATION: '스마트머니 매집',
  // 데이터 신뢰
  VERIFIED: '검증됨', DEGRADED: '저하', STALE: '오래됨', MISSING: '누락', AI_ESTIMATED: 'AI 추정', UNKNOWN: '알 수 없음',
  // ※ 시가총액(LARGE/MID/SMALL)은 MID 의미 충돌(중기 vs 중형)로 전역 매핑 제외 — 사용처에서 별도 처리.
};

/**
 * enum/상태 토큰을 한글 표시 라벨로 변환. **표시 전용** — 비교·분기·className·prop 값에는 쓰지 말 것.
 * 미등록 토큰은 underscore 만 공백 처리(기존 표시 동작 유지)하므로 점진 확장 안전.
 */
export function toKoLabel(value?: string | null): string {
  if (value == null || value === '') return '-';
  return DISPLAY_LABELS[value] ?? value.replace(/_/g, ' ');
}
