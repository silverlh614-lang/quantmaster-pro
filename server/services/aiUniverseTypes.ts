/**
 * @responsibility AI 추천 universe 5-tier fallback 단일 타입 SSOT (ADR-0016, PR-37)
 *
 * ADR-0011 (PR-25-A/B/C: AI 추천 KIS/KRX 분리) + ADR-0013 (PR-33: multiSourceStockMaster
 * 4-tier) 의 직접 후속이다. 본 모듈은 타입 계약만 보유하며 SEED_UNIVERSE/MODE_QUERIES
 * 같은 값 export 는 `aiUniverseService.ts` 가 그대로 유지한다.
 *
 * Tier 정의:
 * - Tier 1: GOOGLE_OK            — Google CSE 매칭 ≥ 3건 (snapshot 갱신 권한 보유)
 * - Tier 2: FALLBACK_SNAPSHOT    — 직전 정상 universe 디스크 스냅샷 (≤ 7일)
 * - Tier 3: FALLBACK_QUANT       — Yahoo OHLCV 기반 정량 후보 생성 (EgressGuard 통과 KR 만)
 * - Tier 4: FALLBACK_NAVER       — Naver Finance 모바일 endpoint 단독 (펀더멘털 only)
 * - Tier 5: FALLBACK_SEED        — 하드코딩 KOSPI/KOSDAQ leader seed (최후 보루)
 *
 * 절대 규칙 #3: KIS/KRX 자동매매 quota 침범 금지. Yahoo 호출은 EgressGuard(PR-29) +
 * SymbolMarketRegistry(PR-26) · marketGate(PR-26/27) 통과한 KR 심볼만.
 */

/** AI 추천 mode — 4 정규 mode + 클라이언트 변형 SMALL_MID_CAP 은 momentumRecommendations 에서 흡수. */
export type AiUniverseMode = 'MOMENTUM' | 'QUANT_SCREEN' | 'BEAR_SCREEN' | 'EARLY_DETECT';

/**
 * universe 응답의 출처 단일 SSOT. 클라이언트가 사용자에게 정확한 사유를 안내할 수 있도록
 * 폴백 사슬의 각 단계 + 진입 실패 사유를 우선순위 단일 값으로 요약한다.
 */
export type AiUniverseSourceStatus =
  /** Tier 1 — Google CSE 매칭 성공 (snapshot 갱신 권한) */
  | 'GOOGLE_OK'
  /** Tier 2 — 직전 정상 universe 스냅샷 사용 (≤ 7일) */
  | 'FALLBACK_SNAPSHOT'
  /** Tier 3 — Yahoo OHLCV 정량 스크리너 (EgressGuard 통과 KR 심볼만) */
  | 'FALLBACK_QUANT'
  /** Tier 4 — Naver Finance 모바일 단독 (펀더멘털 only, 뉴스·촉매 없음) */
  | 'FALLBACK_NAVER'
  /** Tier 5 — 하드코딩 KOSPI/KOSDAQ leader seed (최후 보루) */
  | 'FALLBACK_SEED'
  /** GOOGLE_SEARCH_API_KEY/CX 미설정 — Tier 2~5 로 자동 진행 */
  | 'NOT_CONFIGURED'
  /** google_search bucket 일일 한도 초과 — Tier 2~5 로 진행 */
  | 'BUDGET_EXCEEDED'
  /** HTTP / fetch 오류 — Tier 2~5 로 진행 */
  | 'ERROR'
  /** Google 결과는 있었으나 KRX 마스터 매칭 0건 (or 마스터 비어있음) */
  | 'NO_MATCHES';

/**
 * 시장 데이터 모드 단일 SSOT. `server/utils/marketClock.ts` 의 isMarketOpen /
 * isMarketDataPublished / isKstWeekend 를 wrap 하는 `classifyMarketDataMode(now)` 가
 * 다음 phase(engine-dev) 에서 본 타입을 반환하도록 구현한다.
 *
 * UI(WatchlistCard·OffHoursBanner·RecommendationWarningsBanner)·Telegram 안내 문구·
 * snapshot 갱신 정책이 모두 본 enum 단일 값으로 분기한다.
 */
export type MarketDataMode =
  /** 평일 09:00~15:30 KST 정규장 — LIVE 배지 (주황 pulse) */
  | 'LIVE_TRADING_DAY'
  /** 평일 장 마감 후 ~ 다음날 09:00 (단, 18:00 이전엔 통계 미확정) — "장외" 배지 (파랑 정적) */
  | 'AFTER_MARKET'
  /** 토·일 — "주말 — 직전 거래일 데이터" 배너 + Tier 2 우선 */
  | 'WEEKEND_CACHE'
  /** 한국 공휴일 (DATA_FETCH_FORCE_OFF env 또는 marketClock 휴일 확장) — Tier 2 우선 */
  | 'HOLIDAY_CACHE'
  /** Tier 1~2 모두 실패 + Tier 3+ 진입 — ⚠️ "외부 소스 다중 실패" 경고 배너 */
  | 'DEGRADED';

/**
 * universe 발굴 진단 정보. AiUniverseResult.diagnostics 로 동봉되어 클라이언트의
 * RecommendationWarningsBanner / Telegram /learning_status 패턴 응답에 활용된다.
 *
 * 기존 `AiUniverseResult.diagnostics` (aiUniverseService.ts) 와 호환되는 superset.
 * engine-dev 가 다음 phase 에서 service 파일 import 를 본 타입으로 교체한다.
 */
export interface AiUniverseDiagnostics {
  /** 시도된 Google CSE 쿼리 수 (mode 별 MODE_QUERIES 기준) */
  googleQueries: number;
  /** Google 결과 hit 수 (KRX 매칭 전) */
  googleHits: number;
  /** Google hit 중 KRX 마스터 미매칭 수 */
  masterMisses: number;
  /** Naver Finance enrichment 성공 카운트 */
  enrichSucceeded: number;
  /** Naver Finance enrichment 실패 카운트 */
  enrichFailed: number;
  /** google_search bucket 한도 도달 여부 */
  budgetExceeded: boolean;
  /** 출처 단일 값 — 클라이언트 우선순위 사유 */
  sourceStatus: AiUniverseSourceStatus;
  /** Tier 1 외 응답 사용 여부 (Tier 2~5 모두 true) */
  fallbackUsed: boolean;
  /** 응답 시점의 시장 모드 — UI/Telegram 안내 문구 분기 */
  marketMode: MarketDataMode;
  /**
   * 응답 데이터의 거래일 기준 (YYYY-MM-DD KST). Tier 2 (snapshot) / Tier 3 (Yahoo
   * stale 캐시) 응답에서 의미. Tier 1 은 오늘, Tier 4/5 는 null.
   */
  tradingDateRef: string | null;
  /** Tier 2 사용 시 snapshot 노화일. Tier 1/3/4/5 는 null. */
  snapshotAgeDays: number | null;
  /**
   * 폴백 사슬 시도 순서 — ['GOOGLE_OK'] (정상) 또는 ['NOT_CONFIGURED','FALLBACK_SNAPSHOT']
   * (Google 미설정 → snapshot 사용) 등. 운영자 진단용.
   */
  tierAttempts: AiUniverseSourceStatus[];
}

/**
 * 직전 정상 universe 디스크 스냅샷. Tier 1 (GOOGLE_OK) 응답이 candidates ≥ 3 일 때만
 * 갱신된다 (ADR-0013 동일 패턴 — Tier 2~5 응답은 갱신 거부 = 오염 방지).
 *
 * 영속 위치: `data/ai-universe-snapshot-{MODE}.json` (mode 별 별도 파일, atomic write).
 */
export interface AiUniverseSnapshot {
  mode: AiUniverseMode;
  /** Tier 1 성공 시각 — epoch ms */
  generatedAt: number;
  /** 스냅샷이 대표하는 정상 거래일 — YYYY-MM-DD KST */
  tradingDate: string;
  /** 갱신 시점의 시장 모드 — 진단/UI 라벨용 */
  marketMode: MarketDataMode;
  /** 갱신은 Tier 1 성공만 — 항상 'GOOGLE_OK' */
  sourceStatus: 'GOOGLE_OK';
  /** universe 후보 — 외부 의존 최소화를 위해 코어 필드만 보존 */
  candidates: AiUniverseSnapshotCandidate[];
  /** 갱신 시점의 진단 카피 (참고용) */
  diagnostics: AiUniverseDiagnostics;
}

/**
 * 스냅샷용 candidate — 런타임 `AiUniverseCandidate` 와 분리해 디스크 의존을 단순화.
 * Naver snapshot 은 `JSON-serializable` 형태로만 보존하고 enrichment 는 사용 시점에 재시도.
 */
export interface AiUniverseSnapshotCandidate {
  code: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  /** Tier 1 시점의 displayLink[] — 추후 source 다양성 분석용 */
  sources: string[];
  /** 옵셔널 — Naver 모바일 enrichment 결과 (null 이면 사용 시점 재시도) */
  snapshot?: unknown;
}
