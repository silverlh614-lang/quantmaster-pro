/**
 * @responsibility UI 카피 단일 출처 SSOT — nav/card/tier/regime/gate/empty/action 7 카테고리.
 *
 * 사용 패턴: `import { useUILang } from '../hooks/useUILang';`
 * 직접 import (`import { UI_LANG } from '../config/uiLanguage';`) 는 매핑 테이블/배열
 * 케이스 한정. 컴포넌트 일반 사용은 useUILang() 훅 권장 (마찰 ↓).
 *
 * 금지 표현 정책 (scripts/check_ui_language.js 자동 차단):
 * - 절대 표현: 과도한 단정·우월·수익 약속 표현
 * - 출처 모호: 출처 없는 분석 문구 / AI 기반 후보 권유
 * - 감정 표현: 놀라운 / 엄청난 / 대박 / 가장 좋은
 * - 약속 표현: 필연·무조건·무위험을 암시하는 표현
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
    DISCOVER: '후보 판정',
    AUTO_TRADE: '자동매매',
    POSITIONS: '보유 종목',
    SCREENER: '스크리너',
    BACKTEST: '백테스트',
    LEARNING: '자기학습',
    MACRO: '매크로 인텔',
    SHADOW_LEARNING: 'Shadow 학습',
    PUBLIC_REPORT: 'Public Report',
    BLOG_EXPORT: 'Blog Export',
    DIAGNOSTICS: 'Diagnostics',
    RECOMMENDATION_HISTORY: '판정 이력',
    SETTINGS: '설정',
  },

  /** 종목 카드 / 판정 카드 라벨 */
  card: {
    STRONG_BUY: 'Confirmed Candidate',
    BUY: '진입 가능 후보',
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
    GATE_1: '생존 필터',
    GATE_2: '성장 검증',
    GATE_3: '진입 타이밍',
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

  /**
   * ADR-0398 (= 사용자 명시 ADR-0373): sectorEnergy 8번째 카테고리.
   * 5단계 dataQuality + YAHOO_ETF 보조 신호 한계 + boost 비활성 메시지 SSOT.
   * /sector_energy_diag 텔레그램 명령 + UI 진단 뱃지 단일 출처.
   */
  sectorEnergy: {
    BOOST_DISABLED: '섹터 가산점 미적용',
    OK: '섹터 신호 정상',
    PARTIAL: '섹터 신호 부분 수신',
    STALE: '섹터 신호 지연 데이터, fallback 진행 중',
    DEGRADED: '섹터 신호 저신뢰, STRONG BUY 승격 제한',
    FAILED: '섹터 신호 사용 불가, 개별 종목 판단만 사용',
    YAHOO_ETF: '해외 ETF 프록시 기반 보조 신호, 고신뢰 아님',
  },
} as const;

export type UILangKeys = typeof UI_LANG;
export type UILangCategory = keyof UILangKeys;
