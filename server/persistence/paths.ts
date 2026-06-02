// @responsibility paths 영속화 저장소 모듈
import path from 'path';
import fs from 'fs';

// Railway Volume 마운트 경로 우선, 미설정 시 기본 data/
export const DATA_DIR = process.env.PERSIST_DATA_DIR
  ? path.resolve(process.env.PERSIST_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const WATCHLIST_FILE          = path.join(DATA_DIR, 'watchlist.json');
export const INTRADAY_WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist-intraday.json');
/** 프론트엔드 "관심종목" — 자동매매 워치리스트와 분리된 사용자 큐레이션 저장소. */
export const USER_WATCHLIST_FILE     = path.join(DATA_DIR, 'user-watchlist.json');

/** 레짐별 가중치 파일 경로 (예: data/condition-weights-R2_BULL.json) */
export function conditionWeightsRegimeFile(regime: string): string {
  // 파일명 안전 처리: 영숫자·_만 허용
  const safe = regime.replace(/[^A-Za-z0-9_]/g, '_');
  return path.join(DATA_DIR, `condition-weights-${safe}.json`);
}
/**
 * ADR-0141 Stage 1: FSS 11분류 투자자별 매매 raw 영속 (시장 단위 일자별).
 * Passive/Active 매핑 미적용 — 매핑은 ADR-0142 별도 PR (운영 데이터 1~2주
 * 누적 후 데이터 기반 검증).
 */
export const FSS_DETAIL_FILE       = path.join(DATA_DIR, 'fss-detail.json');

/**
 * P3 (PR #669/#670/#671/#672/#673/#674 후속) — CRITICAL 알림 패턴 기반 BUG 후보 영속.
 * BUG_LEDGER 와 분리 — 자동 BUG 생성 영구 금지, 운영자가 수동으로 BUG_LEDGER.md 에 전사.
 * 후보 ID 는 `BUG-CANDIDATE-YYYY-MM-DD-NNN` (BUG-YYYY-MM-DD-NNN 와 prefix 분리).
 */
export const BUG_CANDIDATES_FILE   = path.join(DATA_DIR, 'bug-candidates.json');

export const SHADOW_FILE             = path.join(DATA_DIR, 'shadow-trades.json');

/**
 * ADR-0140: 외인 보유율 시계열 영속 디렉토리.
 * 종목별 1 파일 (`data/foreigner-ratio/{code}.json`) — 30영업일 보관.
 * 사용자 12 아이디어 #8 — Naver foreignerOwnRatio 5d/20d 추세 가공.
 */
export const FOREIGNER_RATIO_DIR     = path.join(DATA_DIR, 'foreigner-ratio');
export function foreignerRatioFile(code: string): string {
  // 6자리 숫자 외 파일명 차단 (path traversal 방어)
  const safe = code.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
  return path.join(FOREIGNER_RATIO_DIR, `${safe}.json`);
}
/** data/trade-events-YYYYMM.jsonl — 월별 롤링 append-only 이벤트 로그 */
export function tradeEventsFile(yyyymm: string): string {
  return path.join(DATA_DIR, `trade-events-${yyyymm}.jsonl`);
}
export const SHADOW_LOG_FILE         = path.join(DATA_DIR, 'shadow-log.json');
export const MACRO_STATE_FILE        = path.join(DATA_DIR, 'macro-state.json');
export const REGIME_TRANSITION_STATE_FILE = path.join(DATA_DIR, 'regime-transition-state.json');
export const CONDITION_WEIGHTS_FILE  = path.join(DATA_DIR, 'condition-weights.json');
export const BLACKLIST_FILE          = path.join(DATA_DIR, 'blacklist.json');
export const FSS_RECORDS_FILE        = path.join(DATA_DIR, 'fss-records.json');
export const DART_ALERTS_FILE        = path.join(DATA_DIR, 'dart-alerts.json');
export const RECOMMENDATIONS_FILE    = path.join(DATA_DIR, 'recommendations.json');
export const SCREENER_FILE           = path.join(DATA_DIR, 'screener-cache.json');
export const PENDING_ORDERS_FILE     = path.join(DATA_DIR, 'pending-orders.json');
export const PENDING_SELL_ORDERS_FILE = path.join(DATA_DIR, 'pending-sell-orders.json');
export const GATE_LEARNED_THRESHOLD_FILE = path.join(DATA_DIR, 'gate-learned-thresholds.json');
export const OCO_ORDERS_FILE          = path.join(DATA_DIR, 'oco-orders.json');
/** Stage1 Pre-screening 캐시 — 전날 16:30 실행 결과를 저장, 당일 08:35 Stage2+3에서 사용 */
export const STAGE1_CACHE_FILE        = path.join(DATA_DIR, 'stage1-cache.json');
export const BEAR_ALERT_FILE         = path.join(DATA_DIR, 'bear-alert-state.json');
export const MHS_MORNING_ALERT_FILE  = path.join(DATA_DIR, 'mhs-morning-alert-state.json');
export const IPS_ALERT_FILE          = path.join(DATA_DIR, 'ips-alert-state.json');
/** IPS → MAPC Kelly 감쇠 상태 — IPS가 임계치 초과 시 신규 포지션 Kelly 배율을 낮춘다. */
export const KELLY_DAMPENER_FILE     = path.join(DATA_DIR, 'kelly-dampener-state.json');
/** F2W(Failure-to-Weight) 감사 로그 — 매 실행마다의 가중치 조정 이력을 append. */
export const F2W_AUDIT_FILE          = path.join(DATA_DIR, 'f2w-audit-log.json');
/** JobMetrics 영속화 — scheduleCatalog 의 runCount/lastRun 등을 디스크에 저장해 Railway 재배포 시 reset 방지 (PR-Diag-5 결함 수리). */
export const JOB_METRICS_FILE        = path.join(DATA_DIR, 'job-metrics.json');
export const REAL_TRADE_FLAG_FILE    = path.join(DATA_DIR, 'real-trade-ready.flag');
export const DART_FAST_SEEN_FILE     = path.join(DATA_DIR, 'dart-fast-seen.json');
export const ORCHESTRATOR_STATE_FILE = path.join(DATA_DIR, 'orchestrator-state.json');
export const TRANCHE_FILE            = path.join(DATA_DIR, 'tranche-schedule.json');
/**  워크포워드 검증 — 과최적화 감지 시 동결 상태 저장 */
export const WALK_FORWARD_STATE_FILE = path.join(DATA_DIR, 'walk-forward-state.json');
/** 워크포워드 Framework (ADR-0083) — Rolling window 결과 누적 진단 SSOT (freeze 정책과 별개) */
export const WALK_FORWARD_RESULTS_FILE = path.join(DATA_DIR, 'walk-forward-results.json');
/** Shadow 워크포워드 (ADR-0086) — Rejection + Twin 데이터 IS/OOS 분할 결과 별도 영속 */
export const WALK_FORWARD_SHADOW_RESULTS_FILE = path.join(DATA_DIR, 'walk-forward-shadow-results.json');
/** 조건 감사 — 조건별 ACTIVE/PROBATION/SUSPENDED 이력 저장 */
export const CONDITION_AUDIT_FILE    = path.join(DATA_DIR, 'condition-audit.json');
/**  이상 감지 — 마지막 경보 상태 저장 (중복 알림 억제) */
export const ANOMALY_STATE_FILE      = path.join(DATA_DIR, 'anomaly-state.json');
/** 귀인 분석 — 클라이언트에서 전송된 거래 종료 기록 (최근 500건) */
export const ATTRIBUTION_FILE        = path.join(DATA_DIR, 'attribution-records.json');
export const ATTRIBUTION_EVIDENCE_LEDGER_DIR = path.join(DATA_DIR, 'attribution', 'evidence-ledger');
export function attributionEvidenceLedgerFile(yyyymm: string): string {
  const safe = yyyymm.replace(/[^0-9-]/g, '').slice(0, 7);
  return path.join(ATTRIBUTION_EVIDENCE_LEDGER_DIR, `${safe}.json`);
}
export function ensureAttributionEvidenceLedgerDir(): void {
  ensureDataDir();
  if (!fs.existsSync(ATTRIBUTION_EVIDENCE_LEDGER_DIR)) fs.mkdirSync(ATTRIBUTION_EVIDENCE_LEDGER_DIR, { recursive: true });
}
/** 글로벌 스캔 에이전트 — 매일 KST 06:00 간밤 시장 분석 결과 */
export const GLOBAL_SCAN_FILE        = path.join(DATA_DIR, 'global-scan-report.json');
/** 뉴스-수급 시차 학습 DB — 공급망/ETF 경보 이벤트 + T+1·T+3·T+5 추적 결과 */
export const NEWS_SUPPLY_FILE        = path.join(DATA_DIR, 'news-supply-log.json');
/** 마지막 reconcile 결과 — /reconcile last 조회용. dry-run/apply 모두 기록. */
export const RECONCILE_LAST_FILE     = path.join(DATA_DIR, 'reconcile-last.json');
/** R6 emergency exits blocked by session guards; re-evaluated at the next regular open. */
export const PENDING_EMERGENCY_EXIT_FILE = path.join(DATA_DIR, 'pending-emergency-exits.json');
/** 스케줄러 실행 이력 — /scheduler history 조회용. 최근 N건 in-memory ring. 디스크 저장 X. */
/** 반실패 패턴 DB — 손절된 포지션 진입 스냅샷 (코사인 유사도 경고 기반) */
export const FAILURE_PATTERN_FILE    = path.join(DATA_DIR, 'failure-patterns.json');
/** DART LLM 임팩트 상태 — 악재 소화 완료 종목 캐시 */
export const DART_LLM_STATE_FILE     = path.join(DATA_DIR, 'dart-llm-state.json');
/**
 * ADR-0445 — KRX investor-flow parser empty rows 진단 ledger.
 *
 * sanitized metadata 만 영속 (raw payload / token / cookie / private header
 * 영구 금지). parser 가 시도한 expectedPaths + 실제 발견된 detectedCandidatePaths
 * + 첫 row sanitizedSampleKeys + lastSuccess/lastFailure timestamps 만 저장.
 * 별도 ledger — `data/investor-flow-cache.json` 와 *물리 분리* (cache 는 successful
 * sample, ledger 는 parser 실패 원인 분해). 두 ledger 합치지 않음.
 */
export const KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE = path.join(
  DATA_DIR,
  'krx-investor-flow-parser-diagnostics.json',
);
/**
 * ADR-0505 — Gate1 Minimum Signal Forensic Audit 종목별 detail trace ledger.
 *
 * sanitized metadata 만 영속 (raw payload / token / cookie / 계좌번호 /
 * `total_assets` / `orderable_cash` / personal Telegram ID 영구 금지, ADR-0445
 * sanitized 정합). per-symbol component 분해 + missing positive sources +
 * supplyScopeAudit + sectorEnergyAudit + wouldPassIf 8 counterfactual flags
 * 만 저장. 별도 ledger — 다른 ledger (shadow-trades / counterfactual-* /
 * provisional-* / krx-investor-flow-parser-diagnostics) 와 *물리 분리*.
 *
 * FIFO 200 + 7일 TTL (ADR-0479 detail trace registry 정합).
 */
export const GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE = path.join(
  DATA_DIR,
  'diagnostics',
  'gate1-minimum-signal-forensic-adr0505.json',
);
/** Gate 조건 통과율 히트맵 — 조건별 passed/failed 누적 */
export const GATE_AUDIT_FILE         = path.join(DATA_DIR, 'gate-audit.json');
/** 파이프라인 트레이서 — 일별 스캔 의사결정 추적 파일 */
export function scanTraceFile(yyyymmdd: string): string {
  return path.join(DATA_DIR, `scan_trace_${yyyymmdd}.json`);
}
/** 장마감 Pipeline Yield 스코어카드 — 일별 4단계 수율 기록 */
export const SCORECARD_FILE           = path.join(DATA_DIR, 'pipeline-scorecard.json');
/** 거시-섹터-종목 동기화 루프 상태 — 장중 VIX 급등 보수 모드 플래그 등 */
export const MACRO_SYNC_STATE_FILE    = path.join(DATA_DIR, 'macro-sync-state.json');
/** 트레이딩 설정 — 매수조건/손절/포지션한도/운용시간/OCO 등 사용자 설정 저장 */
export const TRADING_SETTINGS_FILE    = path.join(DATA_DIR, 'trading-settings.json');
/** 세션 상태 저장 — Gate 가중치, 유니버스, 초기투자금 등 마지막 설정 스냅샷 */
export const SESSION_STATE_FILE       = path.join(DATA_DIR, 'session-state.json');
/** R3 sanity violation latch. Active state blocks new buys until operator ack/clear. */
export const R3_SANITY_BLOCK_FILE     = path.join(DATA_DIR, 'r3-sanity-block.json');
/**
 * ADR-0401 — R3 Violation streak 영속 SSOT.
 *
 * 같은 violation+regime 의 *연속 발생 횟수* 영속해 단계형 (CLEAN→WARNING→ELEVATED→
 * SHADOW_ONLY→HARD_BLOCK) state machine 의 입력으로 사용. 24h decay (default,
 * ENV `R3_VIOLATION_STREAK_DECAY_HOURS`) 로 무한 누적 차단 (사용자 절대 원칙 #9).
 *
 * atomic write (tmp → rename) + 손상 JSON 빈 상태 fallback + scanIds[] 마지막
 * 1건 비교로 같은 스캔 사이클 중복 증가 차단.
 */
export const R3_VIOLATION_STREAK_FILE = path.join(DATA_DIR, 'r3-violation-streak.json');
/** 이중 기록 Reconciliation 마지막 결과 — 텔레그램·이벤트로그·섀도우상태 정합성 */
export const RECONCILE_STATE_FILE     = path.join(DATA_DIR, 'reconcile-state.json');
/** 텔레그램 알림 발송 로그 — 청산·진입 알림 건별 기록 (최근 1000건) */
export const NOTIFICATION_LOG_FILE    = path.join(DATA_DIR, 'notification-log.json');
/** 4티어 자기학습 상태 — L1~L4 마지막 실행 시각, prevRegime, 첫 캘리브레이션 완료 플래그, 거래 홀드 만료시각 */
export const LEARNING_STATE_FILE      = path.join(DATA_DIR, 'learning-state.json');
/** Phase 1 — Counterfactual Shadow: Gate 1 탈락 후보의 가상 진입/추적 로그 */
export const COUNTERFACTUAL_FILE      = path.join(DATA_DIR, 'counterfactual-shadow.json');
/** Phase 1 — Parallel Universe Ledger: 동일 신호 × 3 Kelly 세팅 병렬 가상체결 */
export const LEDGER_FILE              = path.join(DATA_DIR, 'parallel-universe-ledger.json');
/**
 * 27 조건 전체 학습 커버리지용 — 클라이언트 전용 조건(21개)의 Gemini 프롬프트 boost 맵.
 * 서버 자동평가 경로로 피드백되지 않는 조건도 Gemini 분석 비중으로 소프트 가중 적용.
 */
export const PROMPT_BOOSTS_FILE       = path.join(DATA_DIR, 'condition-prompt-boosts.json');
/**
 * 실험 조건 레지스터 — Gemini 가 제안한 신규 조건 후보의 A/B 테스트 상태.
 * PROPOSED → BACKTESTED_PASSED/FAILED → (선택적) ACTIVE 생애주기.
 */
export const EXPERIMENTAL_CONDITIONS_FILE = path.join(DATA_DIR, 'experimental-conditions.json');
/**
 * 가중치 스냅샷 히스토리 — 월간 캘리브레이션 직후 저장.
 * 워크포워드 동결 시 최근 3개월 중앙값을 앙상블 임시 가중치로 활용한다.
 */
export const WEIGHT_HISTORY_FILE      = path.join(DATA_DIR, 'condition-weight-history.json');
/**
 * 조건별 레짐 위상 맵 — 각 조건이 "위험 레짐"에서 WIN률이 급락하면 그 레짐에서
 * 가중치를 cap 하는 정책 테이블. attributionAnalyzer.byRegime 로부터 도출.
 */
export const PHASE_MAP_FILE           = path.join(DATA_DIR, 'condition-phase-map.json');
/**
 * Shadow vs Real 드리프트 감지 상태 — 진입/청산가 괴리율 이력.
 */
export const SHADOW_REAL_DRIFT_FILE   = path.join(DATA_DIR, 'shadow-real-drift.json');
/**
 * ADR 역산 갭 모니터 — 간밤 미국 ADR 종가 기반 이론 시가 계산 결과.
 * 경보 중복 억제용 마지막 발송 시각/종목별 갭률 기록.
 */
export const ADR_GAP_STATE_FILE       = path.join(DATA_DIR, 'adr-gap-state.json');
/**
 * 홍콩 30분 선행 신호 — 항셍 08:30 KST 개장 후 첫 30분 스냅샷.
 * 경보 중복 억제 + 당일 방향성 예측 이력 저장.
 */
export const PRE_MARKET_SIGNAL_FILE   = path.join(DATA_DIR, 'pre-market-signal.json');
/**
 * DXY 실시간 수급 연동 모니터 — 달러인덱스 임계값 돌파 이벤트/쿨다운 상태.
 * EM 자금이탈·복귀 방향 전환 예비 경보 중복 억제.
 */
export const DXY_MONITOR_STATE_FILE   = path.join(DATA_DIR, 'dxy-monitor-state.json');
/**
 * 섹터 ETF 30분 모멘텀 교차 스캐너 — 미국 섹터 ETF 간밤 RS 랭킹 + 한국 섹터 매핑 결과.
 */
export const SECTOR_ETF_MOMENTUM_FILE = path.join(DATA_DIR, 'sector-etf-momentum.json');
/** KIS Sector Index dry-run promotion audit history — 20 trading-day observation lane. */
export const KIS_SECTOR_INDEX_PROMOTION_HISTORY_FILE = path.join(DATA_DIR, 'kis-sector-index-promotion-history.json');
/** ADR-0545 last-known verified sector snapshot (휴일/세션닫힘 표시·shadow 근거 전용, live promotion 비활성). */
export const SECTOR_ENERGY_VERIFIED_SNAPSHOT_FILE = path.join(DATA_DIR, 'sector-energy-verified-snapshot.json');
/**
 * AI 응답 캐시 영속화 — 클라이언트 lsSet/aiCache의 3층 (Volume) 백엔드.
 * macro-environment 등 분기급 TTL 키는 재배포 후에도 즉시 히트하여 비용 절감.
 */
export const AI_CACHE_FILE            = path.join(DATA_DIR, 'ai-cache.json');
/**
 * Incident Log — Phase 2차: 치명 버그 감지 시 타임스탬프 + 원인 기록.
 * 이후 Shadow 샘플의 incidentFlag 자동 부착 / 오염 반경 계산의 기초.
 */
export const INCIDENT_LOG_FILE        = path.join(DATA_DIR, 'incident-log.json');
/**
 * 알림 감사 로그 — 월별 JSONL. 티어·카테고리·쿨다운키·시각을 1행 1건 append.
 * Phase 6 주간 알림 감사 리포트가 빈발 카테고리·티어별 폭증을 자동 감지한다.
 */
export function alertAuditFile(yyyymm: string): string {
  return path.join(DATA_DIR, `alert-audit-${yyyymm}.jsonl`);
}
/**
 * T1 ACK 대기 상태 — 미확인 상태가 유지되면 30분 후 재발송, 60분 후 이메일 에스컬레이션.
 * 재시작 후에도 복원되어야 하므로 파일 영속화.
 */
export const T1_ACK_STATE_FILE        = path.join(DATA_DIR, 't1-ack-pending.json');
/**
 * 기억 보완 회로 — 부팅/종료 매니페스트.
 * Railway 재시작 시 "이전 세션이 정상 종료됐는지, 크래시였는지"를 확인하는 근거.
 */
export const BOOT_MANIFEST_FILE       = path.join(DATA_DIR, 'boot-manifest.json');
/**
 * 기억 보완 회로 — 월별 영속 에러 로그 (JSONL).
 * uncaughtException·unhandledRejection·명시적 recordError 호출을 append-only 로 누적.
 * Telegram 발송 실패 여부와 무관하게 "무슨 에러가 언제 발생했는지" 재시작 후에도 조회 가능.
 */
export function errorLogFile(yyyymm: string): string {
  return path.join(DATA_DIR, `error-log-${yyyymm}.jsonl`);
}

/**
 * Phase 3-⑨ 콜드스타트 부트스트랩 — 진입 후 30·60·120분 시점의 mini-bar 스냅샷
 * (return, MAE, MFE)을 약한 라벨로 저장. recommendationTracker 정식 라벨이
 * 5건 미만일 때 0.3배 가중치로 학습 부트스트랩에 투입.
 */
export const COLDSTART_SNAPSHOTS_FILE = path.join(DATA_DIR, 'coldstart-snapshots.json');

// ── Nightly Reflection Engine — R(t) 티어 ─────────────────────────────────────

/**
 * Nightly Reflection — 일별 반성 리포트 디렉토리.
 * 하루 1건, 파일명 YYYY-MM-DD.json.
 */
export const REFLECTIONS_DIR           = path.join(DATA_DIR, 'reflections');
export function reflectionFile(yyyymmdd: string): string {
  return path.join(REFLECTIONS_DIR, `${yyyymmdd}.json`);
}
/** 내일 아침 브리핑 상단에 주입될 1줄 학습 포인트 + 요약 */
export const TOMORROW_PRIMING_FILE     = path.join(DATA_DIR, 'tomorrow-priming.json');
/** 고스트 포트폴리오 — Watch/BUY 신호 났으나 매수 안 한 종목 30일 추적 */
export const GHOST_PORTFOLIO_FILE      = path.join(DATA_DIR, 'ghost-portfolio.json');
/** ADR-0028 (PR-L): Rejection Shadow — Gate Score 14~17 near-miss 거절 종목 5영업일 추적 */
export const REJECTION_SHADOW_FILE     = path.join(DATA_DIR, 'rejection-shadow.json');
/** ADR-0454: Near-Miss Outcome Ledger — DATA_BLOCKED_NEAR_MISS/PROBING/SHADOW_ONLY 3/5/10영업일 성과 추적 */
export const NEAR_MISS_OUTCOME_LEDGER_FILE = path.join(DATA_DIR, 'near-miss-outcomes.json');
/** Gate3 timing readiness outcome ledger; shadow/counterfactual learning only, no live execution. */
export const GATE3_OUTCOME_LEDGER_FILE = path.join(DATA_DIR, 'gate3-outcomes.json');
/** ADR-0029 (PR-M): Counterfactual Twin Portfolio — 3 Twin (AGGR/DISC/EQUAL) 평행 포트폴리오 */
export const TWIN_PORTFOLIO_FILE       = path.join(DATA_DIR, 'twin-portfolio.json');
/** ADR-0031 (PR-O): Order Type Optimizer — 종목별 슬리피지 이력 학습 */
export const SLIPPAGE_HISTORY_FILE     = path.join(DATA_DIR, 'slippage-history.json');
/** 지난 7일 반성 리포트에서 추출한 주간 1줄 교훈 (누적) */
export const DISTILLED_WEEKLY_FILE     = path.join(DATA_DIR, 'knowledge', 'distilled-weekly.txt');
/** 반성 엔진 Gemini 호출 예산 사용량 — 월별 재집계 */
export const REFLECTION_BUDGET_FILE    = path.join(DATA_DIR, 'reflection-budget.json');
/** ADR-0047 (PR-Y2): Reflection Module Half-Life — 모듈별 일자별 영향 영속 */
export const REFLECTION_IMPACT_FILE     = path.join(DATA_DIR, 'reflection-impact.json');
/** Meta-Decision Journal — Gate 통과/최종 선택 프로세스 기록 (JSONL 월별) */
export function metaDecisionFile(yyyymm: string): string {
  return path.join(DATA_DIR, `meta-decisions-${yyyymm}.jsonl`);
}
/** Bias Heatmap — 10개 편향 발동 가능성 스코어 일별 이력 */
export const BIAS_HEATMAP_FILE         = path.join(DATA_DIR, 'bias-heatmap.json');
/** 실험 제안 레지스터 — 반성 엔진이 도출한 24h 자동/승인 실험 큐 */
export const EXPERIMENT_PROPOSALS_FILE = path.join(DATA_DIR, 'experiment-proposals.json');
/** P2 #17 — 수동 오버라이드 3/5/7회 경보 dedupe 상태 (day 별 최근 발송 티어 기록) */
export const MANUAL_OVERRIDE_ALERT_FILE = path.join(DATA_DIR, 'manual-override-alert-state.json');
/** 채널별 카테고리 송수신 통계 — 일별 sent/skipped/failed/digested 카운트 */
export const CHANNEL_STATS_FILE         = path.join(DATA_DIR, 'channel-stats.json');
/**
 * KIS 엔드포인트 영속 블랙리스트 (PR-24, ADR-0010).
 * 30분 윈도우 내 404 가 10회 누적된 trId 를 24시간 차단. 재배포 후에도 유지하여
 * 같은 죽은 엔드포인트를 처음부터 다시 두드리는 것을 막는다.
 */
export const KIS_ENDPOINT_BLACKLIST_FILE = path.join(DATA_DIR, 'kis-endpoint-blacklist.json');
/**
 * KRX 종목 마스터 — 부팅·24h TTL 만료 시 1회 다운로드 영속 (ADR-0011, PR-25-A).
 * AI 추천·자동매매 모두 종목코드 → 종목명·시장·섹터 매핑에 사용.
 */
export const KRX_STOCK_MASTER_FILE = path.join(DATA_DIR, 'krx-master.json');
/**
 * AI 추천 외부 호출 일일 예산 카운터 (ADR-0011, PR-25-A).
 * Google Search / Naver Finance / KRX master refresh 별 호출 수를 KST 자정 단위로 집계.
 */
export const AI_CALL_BUDGET_FILE = path.join(DATA_DIR, 'ai-call-budget.json');

/**
 * KRX 휴장일 patch 파일 (PR-D / ADR-0045).
 * 정적 STATIC_HOLIDAYS 위에 운영자가 추가한 차년도 휴장일을 영속.
 */
export const KRX_HOLIDAY_PATCH_FILE = path.join(DATA_DIR, 'krx-holiday-patch.json');
/**
 * Off-hours 스냅샷 — 성공한 /historical-data 응답의 디스크 영속 캐시 (PR-32).
 * 장외 시 gated miss 를 이 스냅샷으로 폴백해 UI 정보 불일치 원천 차단.
 */
export const OFFHOURS_SNAPSHOT_FILE = path.join(DATA_DIR, 'offhours-snapshot.json');
/**
 * Telegram 명령어 사용량 텔레메트리 (ADR-0017 §Stage 3, PR-48).
 * 명령어별 호출 횟수 + 마지막 사용 시각을 영속해 Top 5 개인화 + 폐기 후보 자동 리포트에 활용.
 */
export const COMMAND_USAGE_FILE = path.join(DATA_DIR, 'command-usage.json');
/**
 * Stock master shadow DB — last-known-good 스냅샷 (ADR-0013).
 * Tier 1/2 검증 통과한 응답만 저장. Tier 3/4 (shadow 자체·seed) 는 갱신하지 않는다.
 */
export const STOCK_MASTER_SHADOW_FILE = path.join(DATA_DIR, 'stock-master-shadow.json');
/**
 * AI 추천 universe 직전 정상 스냅샷 (ADR-0016, PR-37).
 * Tier 1 GOOGLE_OK 성공 시에만 mode 별 별도 파일로 저장. 주말/휴일/Google 미설정 시
 * Tier 2 진입점. mode 정규 4값 + 클라이언트 변형(SMALL_MID_CAP) 까지 안전 저장.
 */
export function aiUniverseSnapshotFile(mode: string): string {
  const safe = mode.replace(/[^A-Z_]/gi, '_').toUpperCase();
  return path.join(DATA_DIR, `ai-universe-snapshot-${safe}.json`);
}
/**
 * Stock master 소스별 health score (0-100) + rolling stats 영속 (ADR-0013).
 * 운영자가 어떤 소스가 신뢰 가능한지 한눈에 파악하도록 source 별 누적 + ring buffer.
 */
export const STOCK_MASTER_HEALTH_FILE = path.join(DATA_DIR, 'stock-master-health.json');
/**
 * /api/market-indicators 응답 last-known-good 스냅샷 (ADR-0065, PR-γ).
 * 11 필드 (vix/us10yYield/usShortRate/samsungIri/vkospi/vkospiDayChange/vkospi5dTrend/
 * kospi/kosdaq/ewyReturn/mtumReturn) 별로 마지막 정상 응답 + 시각 영속. 일시 fetch 실패
 * 시 stale fallback 으로 채워 UI flicker 차단. 서버 재배포 후에도 즉시 복구.
 */
export const MARKET_INDICATORS_SNAPSHOT_FILE = path.join(DATA_DIR, 'market-indicators-snapshot.json');

/**
 * ADR-0427 — R3_EARLY Provisional Shadow Ledger 영속.
 *
 * ADR-0426 provisional shadow eligibility 후보를 *일반 shadow-trades.json 과 분리하여*
 * 별도 ledger 에 영속. virtual account holdings/cash 무관 — 학습 표본 metadata 만.
 * 사용자 §D — 일반 shadow buy 와 섞이지 않도록 query/filter 가 쉬운 구조.
 *
 * dedup key: `${scanId}:${symbol}:ADR-0426`. FIFO 2000 trim. atomic write.
 */
export const PROVISIONAL_SHADOW_LEDGER_FILE = path.join(DATA_DIR, 'provisional-shadow-ledger.json');
/**
 * Counterfactual Shadow Learning Ledger 영속 (ADR-0430).
 *
 * SELL_ONLY / HARD_BLOCK 상황에서 실매수·가상계좌 체결·일반 shadow·provisional
 * shadow 모두 차단되더라도 *학습 전용* counterfactual record 는 365일 별도 영속.
 * 사용자 §C 핵심 — Shadow Learning 은 SELL_ONLY 와 무관하게 365일 유지된다.
 *
 * **절대 분리** (사용자 §"절대 하지 말 것" #8/#9 정합):
 *   - shadow-trades.json (일반 shadow buy)        ≠ COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE
 *   - provisional-shadow-ledger.json (ADR-0427)   ≠ COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE
 *
 * dedup key: `${scanId}:${symbol}:ADR-0430` (또는 KST `YYYYMMDDHHmm` fallback).
 * FIFO 2000 trim. atomic write (tmp→rename). virtual account holdings/cash 무관.
 */
export const COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE = path.join(
  DATA_DIR,
  'counterfactual-shadow-learning-ledger.json',
);
/**
 * Counterfactual Universe Learning Ledger 영속 (ADR-0433).
 *
 * SELL_ONLY / HARD_BLOCK / R6_DEFENSE / VIX / FOMC / emergencyStop / volumeClock-closed
 * preflight abort 시 후보별 평가까지 도달하지 못한 *universe 컨텍스트* 자체를
 * learning-only snapshot 으로 보존. 사용자 §"이번 PR의 목표" 직접 정합 —
 * "이 시각에 어떤 universe/candidate pool 이 있었고, 왜 preflight 에서 차단됐는지"
 * 를 학습 데이터로 남긴다.
 *
 * **절대 분리** (사용자 §"절대 하지 말 것" #9/#10/#11 정합):
 *   - shadow-trades.json (일반 shadow buy)              ≠ COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE
 *   - provisional-shadow-ledger.json (ADR-0427)         ≠ COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE
 *   - counterfactual-shadow-learning-ledger.json (0430) ≠ COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE
 *
 * 책임 분리 (사용자 §I): ADR-0430 = 후보별 candidate-level entry / ADR-0433 = preflight 단계
 * universe-level snapshot. 동일 scanId 에 후보별 record 가 이미 존재하면 universe snapshot
 * 은 record 하지 않음 (호출자 측 dedup).
 *
 * dedup key: `${scanId}:ADR-0433:${preflightStage}` (또는 KST `YYYYMMDDHHmm` fallback).
 * FIFO 2000 trim. atomic write (tmp→rename). virtual account holdings/cash 무관.
 */
export const COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE = path.join(
  DATA_DIR,
  'counterfactual-universe-learning-ledger.json',
);
/**
 * TradeSignalStatus 상태머신 영속 (ADR-0077).
 * AI 추천 → 데이터 검증 → 리스크 승인 → 사용자 승인 → 자동매매 직전 6단계 상태 전이를
 * 영속해 운영자가 "이 종목이 어느 단계에서 멈췄는지" 즉시 추적 가능하게 한다.
 * FIFO 1000건 trim, atomic write (tmp → rename).
 */
export const TRADE_SIGNAL_STATUS_FILE = path.join(DATA_DIR, 'trade-signal-status.json');
/**
 * Data Verification Queue 영속 (ADR-0128).
 * batch + incremental 검증 실패 누적을 종목별로 누적해 3회+ 시 manual review queue
 * 에 격상. retry backoff (1·2회 +24h, 3회+ 수동 검토 대기) + atomic write tmp→rename
 * + FIFO trim 500. ENV `VERIFICATION_QUEUE_DISABLED=true` 시 record* no-op.
 */
export const VERIFICATION_QUEUE_FILE = path.join(DATA_DIR, 'verification-queue.json');
/**
 * 자가점검 헬스 루프 영속 (ADR-0131).
 * Tier 1/2/3 헬스 루프의 마지막 임계 bucket·count 스냅샷 + alertedKeys 영속.
 * 정상→정상 무알림 + 임계 변화 시에만 Telegram 발송 (한 임계당 24h dedupe).
 */
export const HEALTH_LOOP_STATE_FILE = path.join(DATA_DIR, 'health-loop-state.json');
/**
 * 인증키 만료 watchdog 영속 (ADR-0131).
 * KNOWN_CREDENTIALS 별 마지막 알림 임계(D-90/30/7/1/0) 영속해 임계 변화 시에만 알림.
 */
export const CREDENTIAL_EXPIRY_STATE_FILE = path.join(DATA_DIR, 'credential-expiry-state.json');
/**
 * 휴장 후 첫 거래일 가속 점검 영속 (ADR-0131).
 * 4/27~5/01 패턴 재발 방지 — 1차/2차 점검 결과 비교용 lastChecks 영속.
 */
export const POST_HOLIDAY_KICKSTART_STATE_FILE = path.join(DATA_DIR, 'post-holiday-kickstart-state.json');
/**
 * KIS OAuth2 토큰 디스크 영속 (ADR-0147).
 * 재부팅 시 디스크 hydrate → 23h TTL 안이면 OAuth2 호출 없이 재사용.
 * 정기 cron (KST 08:30 / 20:30) 자동 갱신 → 디스크 영속 → 다음 재부팅도 신선.
 *
 * data/ 디렉토리는 .gitignore 등재 (비밀 누출 차단).
 */
export const KIS_TOKEN_FILE = path.join(DATA_DIR, 'kis-tokens.json');

/**
 * ADR-0164 — peakEquity 영속 SSOT.
 * `server/trading/sizing/positionSizingEngine` 의 drawdown 자동 차단 (-10/-15/-25/-30% 4단계) 입력.
 * 부재 시 SSOT 가 빈 상태 fallback (currentEquity = peakEquity 로 가정 — drawdown 0).
 */
export const PEAK_EQUITY_FILE = path.join(DATA_DIR, 'peak-equity.json');

/**
 * ADR-0173 §1 — MissedLearningQueue 영속 SSOT.
 * 휴일·서버 장애·배포·API 실패 시 스킵된 학습 작업을 다음 영업일에 안전하게
 * 복구하는 큐. atomic write tmp→rename + FIFO 1000 trim + 손상 JSON 빈 배열 fallback.
 * KIS 주문 함수 import 절대 금지 — 학습 복구 전용 (정적 grep 가드).
 */
export const MISSED_LEARNING_QUEUE_FILE = path.join(DATA_DIR, 'missed-learning-queue.json');

/**
 * ADR-0173 §2 — ShadowLearningOnlyScan 신호 영속 SSOT.
 * 매매 금지일 (FOMC/VIX/R0/R1/Liquidity/Manual/KRX_HOLIDAY_REPLAY) 에 생성한
 * 가상 매수 판단 샘플 (15+ 필드) 영속. atomic write + FIFO 5000 trim.
 * 1/3/5/20일 후 future return resolve 결과 (Phase 2 cron) 가 동일 entry 에 갱신.
 */
export const SHADOW_LEARNING_ONLY_SIGNAL_FILE = path.join(DATA_DIR, 'shadow-learning-only-signals.json');

// ADR-0255: 종목별 Yahoo 갱신 신뢰도 ledger — 만성 stale 종목 진단용.
export const YAHOO_FRESHNESS_LEDGER_FILE = path.join(DATA_DIR, 'yahoo-freshness-ledger.json');

// ADR-0260: 결함 진화 ledger — 한 결함 패치가 다른 결함을 노출하는 패턴 학습.
export const DEFECT_EVOLUTION_LEDGER_FILE = path.join(DATA_DIR, 'defect-evolution-ledger.json');

// ADR-0250: 사용자 진단 단서 ledger — 결함 추적 성공 패턴 학습 데이터.
export const USER_DIAGNOSTIC_HINTS_FILE = path.join(DATA_DIR, 'user-diagnostic-hints.json');

/**
 * ADR-0395 P2 — ExecutionMode 영속 override.
 *
 * RUNTIME_EXECUTION_MODE (Kill Switch / 운영자 명령) → 본 파일 (운영자 영속 강등) → env.
 * 재배포 시 RUNTIME 메모리는 사라지지만 본 파일은 보존되어 강등 상태 유지.
 *
 * 형식: { mode: 'OFF'|'PAPER'|'LIVE', reason?: string, setBy?: string, setAt: string }
 * 기록자: state.ts setExecutionModeOverride 만 (단일 진입점).
 */
export const EXECUTION_MODE_OVERRIDE_FILE = path.join(DATA_DIR, 'execution_mode_override.json');
/** Operator macro no-new-entry override (R6/VIX/FOMC), time-boxed and persisted for Railway process sharing. */
export const MACRO_ENTRY_OVERRIDE_FILE = path.join(DATA_DIR, 'macro_entry_override.json');
/** ADR-458 — Approved Gate Reclassification Dry-Run Ledger (shadow-only, no live order impact). */
export const GATE_RECLASSIFICATION_DRY_RUN_FILE = path.join(DATA_DIR, 'gate-reclassification-dryrun.json');
/** ADR-457/458 — Human-edited approval plan source for dry-run consumption. */
export const GATE_RECLASSIFICATION_APPROVAL_PLAN_FILE = path.join(DATA_DIR, 'gate-reclassification-approval-plan.json');


/** ADR-459 — approved gate reclassification controlled rollout 운영 상태 기록. */
export const GATE_RECLASSIFICATION_ROLLOUT_FILE = path.join(DATA_DIR, 'gate-reclassification-rollout.json');

/**
 * Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002 — 15:30 KST runtime debug snapshot 영속 SSOT.
 *
 * 사용자 명시 framing (Patch-001):
 *   "어차피 장 종료 이후에 찍는 스냅샷도 크게 다르지 않다.
 *    15시 19분에 찍는 스냅샷은 철회한다. 17시에 스냅샷을 찍고,
 *    17시에 찍는 스냅샷은 sell only 용이 아니고 장중 스냅샷과 동일하게 취급한다."
 *
 * 사용자 명시 framing (Patch-002):
 *   "스냅샷을 단순 조회용으로만 쓰지 않고, SnapshotInvestorFlowReplayAdapter 를
 *    추가하여 snapshot 에 저장된 frozen per-symbol supply rows 를 실제 preflight
 *    merge 경로에 주입할 수 있게 한다."
 *
 * Lifecycle 정책 (사용자 명시 절대 변경 금지):
 *   - 매 평일 15:30 KST 자동 capture (ScheduleClass='TRADING_DAY_ONLY' KRX 휴장일 silent skip)
 *   - **단일 latest overwrite 모델** — FIFO revision 누적 X, latest 1 개만 유지
 *   - **다음 거래일 개장 시 초기화 안 함** — snapshot 은 다음 평일 15:30 까지 유지
 *   - 다음 평일 15:30 성공 capture 가 직전 latest 를 atomic overwrite
 *   - 금요일 15:30 snapshot → 월요일 15:30 capture 가 덮어쓰기 (주말 내내 Fri snapshot 보존)
 *   - 월요일 장 시작 시 금요일 snapshot 삭제 절대 금지 (cron 미존재)
 *   - capture 실패 시 직전 latest 보존 (atomic write + preserve-on-failure)
 *
 * 저장:
 *   - 파일: `data/replay/latest-runtime-debug-snapshot.json` (단일 파일)
 *   - atomic write tmp → rename (race 안전)
 *   - 손상 JSON 시 null fallback (시스템 무중단)
 *
 * 절대 invariants:
 *   1. raw API payload 영속 0건 (sanitized fields 만)
 *   2. 민감정보 영속 0건 (token / accountNo / orderId / authorization 등)
 *   3. executionImpact: 'NONE' literal type 강제
 *   4. replayOnly: true literal 강제
 *   5. diagnosticOnly: true literal 강제
 *   6. sellOnlySemanticApplied: false literal 강제 (15:30 = 장중 runtime state 동일 취급)
 *   7. priceSemantics: 'REFERENCE_ONLY_NOT_FOR_TRADE_DECISION' literal 강제
 *   8. providerCallsAllowed: false literal 강제 (replay mode)
 *   9. 외부 API 호출 0건 (영속 read/write 만, KIS/KRX/Yahoo/Naver 신규 호출 금지)
 *   10. KIS 주문 함수 5종 import 0건
 *   11. capture 실패 시 직전 latest 보존 (preserveOnFailure)
 */
export const REPLAY_DIR = path.join(DATA_DIR, 'replay');
export const LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE = path.join(REPLAY_DIR, 'latest-runtime-debug-snapshot.json');
export const LATEST_INTRADAY_PROGRAM_FLOW_SNAPSHOT_FILE = path.join(REPLAY_DIR, 'latest-intraday-program-flow-snapshot.json');

export function ensureReplayDir(): void {
  ensureDataDir();
  if (!fs.existsSync(REPLAY_DIR)) fs.mkdirSync(REPLAY_DIR, { recursive: true });
}

// Legacy Patch-MARKET-CLOSE-SNAPSHOT-001 (15:19) — 사용자 명시로 철회 (Patch-AFTER-HOURS-002).
// 파일 시스템에 남아있을 수 있는 이전 디렉토리 정리용 path 만 유지 (호환성 0 — 미사용).
export const INTRADAY_SNAPSHOTS_DIR = path.join(DATA_DIR, 'intraday-snapshots');

export function ensureIntradaySnapshotsDir(): void {
  ensureDataDir();
  if (!fs.existsSync(INTRADAY_SNAPSHOTS_DIR)) fs.mkdirSync(INTRADAY_SNAPSHOTS_DIR, { recursive: true });
}

export function ensureReflectionsDir(): void {
  ensureDataDir();
  if (!fs.existsSync(REFLECTIONS_DIR)) fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
}
export function ensureKnowledgeDir(): void {
  ensureDataDir();
  const dir = path.join(DATA_DIR, 'knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Railway 배포 시 파일시스템 초기화 경고
  if (process.env.RAILWAY_STATIC_URL && !process.env.PERSIST_DATA_DIR) {
    console.warn(
      '[AutoTrade] ⚠️  Railway 감지됨 — PERSIST_DATA_DIR 미설정. ' +
      '배포마다 data/ 가 초기화됩니다. Railway Volume을 /app/data에 마운트한 뒤 ' +
      'PERSIST_DATA_DIR=/app/data 를 환경변수에 추가하세요.'
    );
  }
}

/**
 * Railway Volume 마운트 검증 — 기동 시 DATA_DIR에 write/read 테스트.
 * 실패 시 재시작마다 데이터가 소실되므로 CRITICAL 알림 발송 필요.
 *
 * @returns true = 마운트 정상, false = 미마운트/쓰기 실패
 */
export function verifyVolumeMount(): { ok: boolean; error?: string; timestamp?: string } {
  ensureDataDir();
  const mountTestFile = path.join(DATA_DIR, '.mount_test');
  try {
    const timestamp = new Date().toISOString();
    fs.writeFileSync(mountTestFile, timestamp);
    const content = fs.readFileSync(mountTestFile, 'utf-8');
    if (content !== timestamp) {
      return { ok: false, error: `write/read mismatch: wrote=${timestamp}, read=${content}` };
    }
    return { ok: true, timestamp };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
