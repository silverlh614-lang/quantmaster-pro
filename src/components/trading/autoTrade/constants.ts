/** 자동매매 대시보드에서 공용으로 쓰이는 라벨/툴팁 상수 모음. */

/** 조건 키 → 한국어 레이블 (진입조건 설정·Gate 히트맵·워치리스트 공용) */
export const CONDITION_LABELS: Record<string, string> = {
  momentum:          '모멘텀 (당일 +2% 이상)',
  ma_alignment:      '정배열 (MA5 > MA20 > MA60)',
  volume_breakout:   '거래량 돌파 (평균 2배 이상)',
  per:               'PER 밸류에이션 (0~20 구간)',
  turtle_high:       '터틀 돌파 (20일 신고가)',
  relative_strength: '상대강도 (KOSPI 대비 +1%p)',
  vcp:               '변동성 수축 (VCP 패턴)',
  volume_surge:      '거래량 급증+상승 (3배 & +1%)',
  rsi_zone:          'RSI 건강구간 (40~70)',
  macd_bull:         'MACD 가속 (히스토그램 양수+확대)',
  pullback:          '눌림목 셋업 (고점 대비 조정)',
  ma60_rising:       'MA60 우상향 추세 (장기 상승)',
  weekly_rsi_zone:   '주봉 RSI 건강구간 (40~70)',
  supply_confluence: '수급 합치 (기관+외인 순매수)',
  earnings_quality:  '이익 품질 (영업현금흐름 비율)',
};

/** 레짐 코드 → 한국어 레이블 */
export const REGIME_LABELS: Record<string, string> = {
  R1_TURBO:   'R1 터보 강세',
  R2_BULL:    'R2 상승장',
  R3_EARLY:   'R3 초기 회복',
  R4_NEUTRAL: 'R4 중립',
  R5_CAUTION: 'R5 주의',
  R6_DEFENSE: 'R6 방어',
};

/** Gate 설명 툴팁 — 워치리스트/히트맵 상단에 표시 */
export const GATE_TOOLTIPS: Record<number, string> = {
  1: 'Gate 1 (생존): 유동성·재무·상장요건 필수 통과',
  2: 'Gate 2 (성장): ROE개선·마진가속·수급 12개 조건',
  3: 'Gate 3 (타이밍): 기술적 진입 타점 10개 조건',
};

/** RRR 분포 막대차트 색상 (손실/소·중·대 수익 4구간) */
export const RRR_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#10b981'];

/** exitRuleTag → 축약 레이블 (완결 트레이드 태그용) */
export const EXIT_RULE_SHORT: Record<string, string> = {
  HARD_STOP: 'HARD STOP', CASCADE_FINAL: 'CASCADE', CASCADE_HALF_SELL: 'CASCADE ½',
  R6_EMERGENCY_EXIT: 'R6 긴급', MA60_DEATH_FORCE_EXIT: 'MA60', TARGET_EXIT: '목표가',
  LIMIT_TRANCHE_TAKE_PROFIT: 'LIMIT TP', TRAILING_PROTECTIVE_STOP: 'TRAILING',
  RRR_COLLAPSE_PARTIAL: 'RRR', DIVERGENCE_PARTIAL: 'DIVG', EUPHORIA_PARTIAL: '과열',
};

/** subType → 축약 레이블 (exitRuleTag 가 없을 때 fallback) */
export const SUBTYPE_SHORT: Record<string, string> = {
  STOP_LOSS: 'STOP', EMERGENCY: '긴급', PARTIAL_TP: 'LIMIT TP', TRAILING_TP: 'TRAILING', FULL_CLOSE: '목표가',
};
