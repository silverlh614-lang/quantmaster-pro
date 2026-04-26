// @responsibility reflectionTypes 학습 엔진 모듈
/**
 * reflectionTypes.ts — Nightly Reflection Engine 공용 타입.
 *
 * Phase 1 Foundation: 16개 기능이 공유하는 최소 타입만 정의.
 * 각 기능 구현 Phase에서 필요에 따라 보강된다.
 *
 * 디자인 원칙:
 *   - 모든 claim 은 sourceIds[] 로 원천 데이터 식별자를 담는다 (Integrity Guard).
 *   - LLM 출력은 반드시 이 스키마에 맞춰 파싱 후 저장 (free-form 금지).
 */

export type DailyVerdict = 'GOOD_DAY' | 'MIXED' | 'BAD_DAY' | 'SILENT';

/** 원천 추적 가능한 claim — sourceIds 누락/미존재 시 Integrity Guard 가 삭제 */
export interface TraceableClaim {
  text: string;
  /** attribution tradeId · incident.at · shadow id 등 원천 식별자 */
  sourceIds: string[];
}

/** 메인 반성 리포트 — 매일 밤 KST 19:00 생성 */
export interface ReflectionReport {
  /** YYYY-MM-DD (KST 기준) */
  date:              string;
  generatedAt:       string;           // ISO UTC
  dailyVerdict:      DailyVerdict;
  keyLessons:        TraceableClaim[];
  questionableDecisions: TraceableClaim[];
  tomorrowAdjustments:   TraceableClaim[];
  followUpActions:       TraceableClaim[];
  /** Phase 4: 200~300자 서사 (System Narrative Generator) */
  narrative?:        string;
  /** Phase 2: 5-Why 심문 결과 */
  fiveWhy?:          FiveWhyResult[];
  /** Phase 2: 반사실 시뮬레이터 결과 (통화 KRW) */
  counterfactual?:   CounterfactualBreakdown;
  /** Phase 2: 페르소나 원탁 평가 */
  personaReview?:    PersonaReviewSummary;
  /** Phase 3: 조건 참회록 후보 */
  conditionConfession?: ConditionConfessionEntry[];
  /** Phase 3: 후회 지연 손실 (Regret Quantifier) */
  regret?:           RegretQuantifierResult;
  /** P2: 수동 청산 의무 분석 — 일일 편향·괴리 통계 */
  manualExitReview?: ManualExitReview;
  /** Integrity Guard 감사: 삭제된 claim 수 */
  integrity?:        IntegrityAuditResult;
  /** Budget Governor 결과 (완전/감쇠/템플릿) */
  mode?:             ReflectionMode;
}

export type ReflectionMode =
  | 'FULL'           // 정상 — 4~6회 Gemini 호출
  | 'REDUCED_EOD'    // 예산 70% — 격일
  | 'REDUCED_MWF'    // 예산 90% — 주 3회
  | 'TEMPLATE_ONLY'  // 예산 100% — 로컬 RAG 템플릿
  | 'SILENCE_MONDAY';// 월요일 의도적 비활성

// ── Five-Why ─────────────────────────────────────────────────────────────────
export interface FiveWhyStep {
  depth: 1 | 2 | 3 | 4 | 5;
  question: string;
  answer: string;
}
export interface FiveWhyResult {
  tradeId: string;
  stockCode: string;
  steps: FiveWhyStep[];
  /** 🟢 기존 원칙과 일치 / 🟡 새로운 발견 */
  tag: 'GREEN_EXISTING' | 'YELLOW_NEW_INSIGHT';
  /** 🟡 발견 시 rag-embeddings.json 에 추가될 최종 원칙 */
  generalPrinciple?: string;
}

// ── Counterfactual Simulator ─────────────────────────────────────────────────
export interface CounterfactualBreakdown {
  /** Watch 중 Gate 미달 보류 종목 당일 수익 합계 (KRW) */
  missedOpportunityKrw: number;
  /** 익절 후 추가 상승 금액 합계 (KRW) */
  earlyExitKrw:         number;
  /** 손절 기준 도달 후 지연 집행 손실 합계 (KRW) */
  lateStopKrw:          number;
  /** 참여 케이스 수 (샘플 크기 투명성) */
  sampleCount:          number;
}

// ── Persona Round-Table ──────────────────────────────────────────────────────
export type PersonaRole = 'QUANT_LEAD' | 'RISK_MANAGER' | 'BEHAVIORAL' | 'SKEPTIC';
export type PersonaSignal = 'GREEN' | 'YELLOW' | 'RED';
export interface PersonaVote {
  role:    PersonaRole;
  signal:  PersonaSignal;
  comment: string;
}
export interface PersonaReviewSummary {
  tradeId: string;
  votes:   PersonaVote[];
  /** 4표 모두 🟢 = true */
  stressTested: boolean;
  /** 🔴 가 하나라도 있으면 RAG 반례 사례로 추가될 요지 */
  counterExample?: string;
}

// ── Condition Confession (Phase 3 #6) ────────────────────────────────────────
export interface ConditionConfessionEntry {
  conditionId: number;
  passedCount: number;
  winCount:    number;
  lossCount:   number;
  expiredCount: number;
  /** 당일 허위신호 정도 (0~1) */
  falseSignalScore: number;
}

// ── Manual Exit Review (P2 #15) ──────────────────────────────────────────────
/**
 * 매일 19:00 반성에서 산출되는 수동 청산 의무 분석.
 * Nightly Reflection 이 이 스냅샷을 기록하여 심리 온도계·행동 경보 등 상위 체계가 소비.
 */
export interface ManualExitReview {
  date: string;                       // YYYY-MM-DD (KST)
  count: number;                      // 오늘 수동 청산 건수
  reasonBreakdown: Record<string, number>; // reasonCode → 건수
  avgBias: {
    regretAvoidance: number;          // 0~1 평균
    endowmentEffect: number;
    panicSelling:    number;
  };
  /** 기계 대기 규칙과 괴리 (사용자 청산 ↔ 자동 규칙 불일치) 건수 */
  machineDivergenceCount: number;
  /** 평균 손절/목표 거리 — 근접/이격 경향을 수치로 */
  avgDistanceToStop:   number;
  avgDistanceToTarget: number;
  /** 최근 7일 롤링 카운트 — 3/5/7 임계값 경보 판단용 */
  rolling7dCount: number;
  /** 최근 30일 롤링 카운트 */
  rolling30dCount: number;
  /** ≥0.5 평균 편향 트리거 요약 */
  flags: string[];
}

// ── Regret Quantifier (Phase 3 #8) ───────────────────────────────────────────
export interface RegretQuantifierResult {
  immediateStopLossKrw: number;
  delay5minLossKrw:     number;
  delay30minLossKrw:    number;
  delay60minLossKrw:    number;
  /** 즉시 집행 대비 최대 지연 시 추가 손실 (KRW) */
  mechanicalValueKrw:   number;
}

// ── Ghost Portfolio (Phase 3 #9) ─────────────────────────────────────────────
export interface GhostPosition {
  stockCode: string;
  stockName: string;
  /** 신호 발생일 종가 KRW */
  signalPriceKrw:  number;
  signalDate:      string;            // YYYY-MM-DD
  /** 신호 발생 이유 — 어느 Gate 에서 탈락했는지 */
  rejectionReason: string;
  /** 추적 종료일 (signalDate + 30일) */
  trackUntil:      string;
  /** 최근 갱신된 수익률 */
  currentReturnPct?: number;
  lastUpdatedAt?:    string;
  closed?:           boolean;
}

// ── Meta-Decision Journal (Phase 4 #10) ──────────────────────────────────────
export interface MetaDecisionEntry {
  decisionId:    string;
  decidedAt:     string;            // ISO
  candidateCount: number;
  gatePassCounts: { gate0: number; gate1: number; gate2: number };
  finalSelection: string | null;
  /** 판단 엔진 + 가중치 + 매크로 스냅샷 해시 — 프로세스 편향 감지용 */
  decisionHash:  string;
  /** 실제 체결 지연 (ms). null = 미체결 */
  fillLatencyMs: number | null;
}

// ── Bias Heatmap (Phase 4 #11) ───────────────────────────────────────────────
export type BiasType =
  | 'REGRET_AVERSION'     // 후회 회피
  | 'ENDOWMENT'           // 보유 효과
  | 'CONFIRMATION'        // 확신 편향
  | 'HERDING'             // 군중 추종
  | 'LOSS_AVERSION'       // 손실 회피
  | 'ANCHORING'           // 앵커링
  | 'RECENCY'             // 최신성 편향
  | 'OVERCONFIDENCE'      // 과신
  | 'SUNK_COST'           // 매몰비용
  | 'FOMO';               // 기회 상실 공포

export interface BiasScore {
  bias:  BiasType;
  /** 0~1 발동 가능성 */
  score: number;
  /** 스코어 근거 한 줄 */
  evidence: string;
}
export interface BiasHeatmapDailyEntry {
  date:   string;               // YYYY-MM-DD
  scores: BiasScore[];
}

// ── Experiment Proposal (Phase 4 #12) ────────────────────────────────────────
export type ExperimentTrack = 'YELLOW_AUTO' | 'RED_APPROVE';
export type ExperimentState =
  | 'PROPOSED'
  | 'AUTO_STARTED'
  | 'AWAIT_APPROVAL'
  | 'RUNNING'
  | 'COMPLETED'
  | 'REJECTED';
export interface ExperimentProposal {
  id:          string;
  proposedAt:  string;
  hypothesis:  string;
  rationale:   string;
  method:      string;
  terminationCondition: string;
  track:       ExperimentTrack;
  state:       ExperimentState;
  /** YELLOW_AUTO → 24h 후 자동 시작 기준 시각 */
  autoStartAt?: string;
}

// ── Tomorrow Priming (Phase 2 #5) ────────────────────────────────────────────
export interface TomorrowPriming {
  forDate: string;               // YYYY-MM-DD (내일 기준)
  producedAt: string;            // ISO UTC
  oneLineLearning: string;       // 아침 브리핑 상단 삽입용 "🌅 오늘의 학습 포인트"
  adjustments:  TraceableClaim[];
  followUps:    TraceableClaim[];
}

// ── Integrity Audit (Phase 1 #14) ────────────────────────────────────────────
export interface IntegrityAuditResult {
  claimsIn:      number;
  claimsOut:     number;
  /** sourceIds 검증 실패로 삭제된 claim 텍스트 */
  removed:       string[];
  /** LLM 응답 자체 파싱 실패 시 true (fallback 발동) */
  parseFailed?:  boolean;
}
