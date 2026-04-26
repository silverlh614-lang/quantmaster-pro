// @responsibility signal 도메인 타입 정의
// ─── 매도 신호 타입 ───────────────────────────────────────────────────────────

export type SellAction =
  | 'HARD_STOP'         // L1: 기계적 손절 (전량 시장가)
  | 'REVALIDATE_GATE1'  // L1: -7% 경보 → Gate 1 재검증 요청
  | 'PRE_MORTEM'        // L2: 펀더멘털 붕괴 조건 발동
  | 'PROFIT_TAKE'       // L3: 분할 익절 타겟 도달
  | 'TRAILING_STOP'     // L3: 트레일링 스톱 발동
  | 'EUPHORIA_SELL'     // L4: 과열 탐지 익절
  | 'STOP_LADDER'       // L1.5: 3단 경보 손절 사다리 (Phase 3)
  | 'ICHIMOKU_EXIT'     // L5: 일목균형표 이탈 매도 (Phase 3)
  | 'VDA_ALERT';        // L5: Volume Dry-up Alert (Phase 4)

export interface SellSignal {
  action: SellAction;
  ratio: number;                 // 매도 비율 0~1 (1.0 = 전량)
  orderType: 'MARKET' | 'LIMIT';
  price?: number;                // LIMIT 주문 가격 (MARKET 시 불필요)
  reason: string;                // 텔레그램 알림 메시지용
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// ─── L2 Pre-Mortem 타입 ───────────────────────────────────────────────────────

export type PreMortemType =
  | 'ROE_DRIFT'         // ROE 유형 3 → 4 이상 전이
  | 'FOREIGN_SELLOUT'   // 외국인 5일 연속 순매도
  | 'MA_DEATH_CROSS'    // 20일선 < 60일선 교차
  | 'REGIME_DEFENSE'    // 레짐 R6 전환
  | 'TREND_COLLAPSE';   // 고점 대비 -30% 추세 붕괴

export interface PreMortemTrigger {
  type: PreMortemType;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sellRatio: number;
  reason: string;
}

// ─── L3 익절 타겟 ─────────────────────────────────────────────────────────────

export interface TakeProfitTarget {
  trigger: number | null;        // 수익률 임계값 (null = 트레일링 스톱)
  ratio: number;                 // 해당 트랜치 매도 비율 0~1
  type: 'LIMIT' | 'TRAILING';
  trailPct?: number;             // TRAILING 타입 전용 — 고점 대비 하락 허용 폭
}
