/**
 * @responsibility UI 카피 단일 출처 SSOT — nav/card/tier/regime/gate/empty/action 7 카테고리.
 *
 * 사용 패턴: `import { useUILang } from '../hooks/useUILang';`
 * 직접 import (`import { UI_LANG } from '../config/uiLanguage';`) 는 매핑 테이블/배열
 * 케이스 한정. 컴포넌트 일반 사용은 useUILang() 훅 권장 (마찰 ↓).
 *
 * 금지 표현 정책 (scripts/check_ui_language.js 자동 차단):
 * - 절대 표현: 완벽한 / 강력한 / 확실한 / 보장 / 확실히 / 최고의 / 베스트
 * - 출처 모호: AI 가 분석한 / AI 추천
 * - 감정 표현: 놀라운 / 엄청난 / 대박 / 가장 좋은
 * - 약속 표현: 반드시 / 무조건 / 승률 100%
 *
 * 페르소나 철학 정합:
 * - "Data-driven, no emotion" → 감정 표현 금지
 * - "확률 사고" → 절대 표현 금지
 * - "출처 명시" → AI 추정은 tier.ESTIMATED 라벨 사용
 *
 * 본 SSOT 자기 자신은 검증 화이트리스트 (정책 정의 시그니처 등장 가능).
 *
 * 관련 ADR: 0094 (Phase A 게이트키퍼)
 */

export const UI_LANG = {
  /** 사이드바 / 탭 / 페이지 라벨 */
  nav: {
    DISCOVER: '발견',
    AUTO_TRADE: '자동매매',
    POSITIONS: '보유 종목',
    SCREENER: '스크리너',
    BACKTEST: '백테스트',
    LEARNING: '자기학습',
    MACRO: '매크로 인텔',
    SHADOW_LEARNING: 'Shadow 학습',
    RECOMMENDATION_HISTORY: '추천 이력',
    SETTINGS: '설정',
  },

  /** 종목 카드 / 추천 카드 라벨 */
  card: {
    STRONG_BUY: '강매수 후보',
    BUY: '매수 후보',
    HOLD: '관망',
    SELL: '청산 검토',
    AVOID: '진입 회피',
    PENDING: '평가 대기',
    EXECUTED: '진입 완료',
    REJECTED: '진입 거부',
  },

  /**
   * 데이터 품질 5-tier (ADR-0028 PR-A 의 3-tier 후속 격상 포인트).
   * 본 PR 은 SSOT 만 도입, 실제 5-tier 사다리 매핑은 후속 PR-Phase-A-2 (#3 아이디어).
   */
  tier: {
    VERIFIED: '실측',
    EXTERNAL: 'API 수신',
    DELAYED: '지연 데이터',
    ESTIMATED: 'AI 추정',
    MANUAL: '수동 입력',
  },

  /** 6 RegimeLevel (R1~R6) — src/types/ui.ts 의 REGIME_TRADING_POLICY 와 정합 */
  regime: {
    R1_TURBO: '🔥 가속 강세',
    R2_BULL: '🟢 안정 강세',
    R3_EARLY: '🌱 초기 강세',
    R4_NEUTRAL: '🟠 중립',
    R5_CAUTION: '🟡 경계',
    R6_DEFENSE: '🛑 방어',
  },

  /** 4단계 Gate (0/1/2/3) — gateEngine boundary 와 정합 */
  gate: {
    GATE_0: '시장 게이트',
    GATE_1: '필수 조건',
    GATE_2: '강화 조건',
    GATE_3: '확신 조건',
  },

  /**
   * 빈 상태 메시지 4 sub-variant (Phase B 의 #4 IDontKnow 사전 등록).
   * 컴포넌트는 본 SSOT 의 메시지를 직접 사용하거나 IDontKnow 컴포넌트 (Phase B) 에 키 전달.
   */
  empty: {
    DELAYED: '데이터 동기화 중 — 잠시 후 표시됩니다',
    INSUFFICIENT: '표본 부족 — 거래 30건 누적 후 활성화',
    STALE: '시장 외 시간 — 다음 영업일 09:00 갱신',
    CONFLICTED: '신호 충돌 감지 — 검토 필요',
  },

  /** 버튼 / 액션 라벨 */
  action: {
    APPROVE: '승인',
    REJECT: '거부',
    SKIP: '건너뜀',
    REFRESH: '새로고침',
    EXPAND: '펼치기',
    COLLAPSE: '접기',
    CLOSE: '닫기',
  },
} as const;

export type UILangKeys = typeof UI_LANG;
export type UILangCategory = keyof UILangKeys;
