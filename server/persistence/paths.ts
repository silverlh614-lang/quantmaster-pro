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
export const SHADOW_FILE             = path.join(DATA_DIR, 'shadow-trades.json');
/** data/trade-events-YYYYMM.jsonl — 월별 롤링 append-only 이벤트 로그 */
export function tradeEventsFile(yyyymm: string): string {
  return path.join(DATA_DIR, `trade-events-${yyyymm}.jsonl`);
}
export const SHADOW_LOG_FILE         = path.join(DATA_DIR, 'shadow-log.json');
export const MACRO_STATE_FILE        = path.join(DATA_DIR, 'macro-state.json');
export const CONDITION_WEIGHTS_FILE  = path.join(DATA_DIR, 'condition-weights.json');
export const BLACKLIST_FILE          = path.join(DATA_DIR, 'blacklist.json');
export const FSS_RECORDS_FILE        = path.join(DATA_DIR, 'fss-records.json');
export const DART_ALERTS_FILE        = path.join(DATA_DIR, 'dart-alerts.json');
export const RECOMMENDATIONS_FILE    = path.join(DATA_DIR, 'recommendations.json');
export const SCREENER_FILE           = path.join(DATA_DIR, 'screener-cache.json');
export const PENDING_ORDERS_FILE     = path.join(DATA_DIR, 'pending-orders.json');
export const PENDING_SELL_ORDERS_FILE = path.join(DATA_DIR, 'pending-sell-orders.json');
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
export const REAL_TRADE_FLAG_FILE    = path.join(DATA_DIR, 'real-trade-ready.flag');
export const DART_FAST_SEEN_FILE     = path.join(DATA_DIR, 'dart-fast-seen.json');
export const ORCHESTRATOR_STATE_FILE = path.join(DATA_DIR, 'orchestrator-state.json');
export const TRANCHE_FILE            = path.join(DATA_DIR, 'tranche-schedule.json');
/**  워크포워드 검증 — 과최적화 감지 시 동결 상태 저장 */
export const WALK_FORWARD_STATE_FILE = path.join(DATA_DIR, 'walk-forward-state.json');
/** 조건 감사 — 조건별 ACTIVE/PROBATION/SUSPENDED 이력 저장 */
export const CONDITION_AUDIT_FILE    = path.join(DATA_DIR, 'condition-audit.json');
/**  이상 감지 — 마지막 경보 상태 저장 (중복 알림 억제) */
export const ANOMALY_STATE_FILE      = path.join(DATA_DIR, 'anomaly-state.json');
/** 귀인 분석 — 클라이언트에서 전송된 거래 종료 기록 (최근 500건) */
export const ATTRIBUTION_FILE        = path.join(DATA_DIR, 'attribution-records.json');
/** 글로벌 스캔 에이전트 — 매일 KST 06:00 간밤 시장 분석 결과 */
export const GLOBAL_SCAN_FILE        = path.join(DATA_DIR, 'global-scan-report.json');
/** 뉴스-수급 시차 학습 DB — 공급망/ETF 경보 이벤트 + T+1·T+3·T+5 추적 결과 */
export const NEWS_SUPPLY_FILE        = path.join(DATA_DIR, 'news-supply-log.json');
/** 마지막 reconcile 결과 — /reconcile last 조회용. dry-run/apply 모두 기록. */
export const RECONCILE_LAST_FILE     = path.join(DATA_DIR, 'reconcile-last.json');
/** 스케줄러 실행 이력 — /scheduler history 조회용. 최근 N건 in-memory ring. 디스크 저장 X. */
/** 반실패 패턴 DB — 손절된 포지션 진입 스냅샷 (코사인 유사도 경고 기반) */
export const FAILURE_PATTERN_FILE    = path.join(DATA_DIR, 'failure-patterns.json');
/** DART LLM 임팩트 상태 — 악재 소화 완료 종목 캐시 */
export const DART_LLM_STATE_FILE     = path.join(DATA_DIR, 'dart-llm-state.json');
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
/** 지난 7일 반성 리포트에서 추출한 주간 1줄 교훈 (누적) */
export const DISTILLED_WEEKLY_FILE     = path.join(DATA_DIR, 'knowledge', 'distilled-weekly.txt');
/** 반성 엔진 Gemini 호출 예산 사용량 — 월별 재집계 */
export const REFLECTION_BUDGET_FILE    = path.join(DATA_DIR, 'reflection-budget.json');
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
