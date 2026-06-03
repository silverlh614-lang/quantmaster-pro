/**
 * @responsibility 종목 단위 KIS 원시 데이터 + 파생 지표 단일 컨테이너 (UnifiedSourceSnapshot의 perSymbol 단위)
 *
 * ADR-0519: SymbolDataCollector 가 KIS 4개 엔드포인트를 1회 수집하여 구성한다.
 * 모든 Gate(Gate0~Gate3)는 이 컨테이너를 읽기 전용으로 소비한다.
 * 이 파일은 타입 계약만 정의하며 런타임 로직을 포함하지 않는다.
 *
 * Import 경로:
 *   KIS 타입 — server/clients/kisClient/index.js (query.js re-export)
 *   KRX 마스터 — server/persistence/krxStockMasterRepo.js (StockMasterEntry)
 *
 * 절대 규칙:
 *   - KIS 원시 데이터는 collector 가 단 1회 수집, 이후 변경 불가 (불변식 #3)
 *   - L4(AI_ESTIMATED) 데이터는 이 컨테이너에 포함하지 않는다
 *   - 이 파일에 Gate 판정 로직·임계값을 추가하지 않는다 (engine-dev 영역)
 */

import type {
  KisStockFullQuote,
  KisInvestorFlow,
  KisStockDailyBar,
  KisStockProgramTrade,
} from '../../clients/kisClient/index.js';
// ADR-0529: DART 재무 정본 슬롯 payload 는 기존 Gate2 평가 타입을 재사용한다 (별도 정본 타입 신설 0).
import type { Gate2DartEvaluationFinancials } from '../gate2/gate2ExternalDataProvider/types.js';
// ADR-0556 D2: per-field freshness 의 공통 어휘는 신규 enum 신설 없이 기존 DataHealth(SSOT) 재사용.
import type { DataHealth } from '../../../src/types/shadowCase.js';

// ─── 수집 품질 등급 ──────────────────────────────────────────────────────────

/**
 * 종목 수집 완성도 등급.
 * FULL    — 4개 엔드포인트 전부 성공
 * PARTIAL — quote 필수 확보, 나머지 일부 실패
 * MINIMAL — quote만 확보 (dailyBars/investorFlow/programTrade 전부 실패)
 * MISSING — quote 포함 전부 실패 (Gate 소비 불가)
 */
export type SymbolDataQuality = 'FULL' | 'PARTIAL' | 'MINIMAL' | 'MISSING';

// ─── 기술적 지표 (Gate1 유동성 + Gate1/2 기술 + Gate2 모멘텀) ───────────────

/**
 * collector 가 dailyBars 로부터 파생 계산하는 기술적 지표.
 * 값이 null 인 경우: 데이터 부족(60일 미달) 또는 계산 불가.
 * Gate 는 null 을 자체 처리 기준에 따라 WARN 또는 FAIL 로 해석한다.
 */
export interface SymbolTechnicalIndicators {
  // Gate1 유동성 기준
  avgVolume20d: number | null;
  avgTradingValue20d: number | null;          // 단위: 원

  // Gate1 / Gate2 이동평균
  ma20: number | null;
  ma60: number | null;
  aboveMA20: boolean | null;
  aboveMA60: boolean | null;

  // Gate1 / Gate2 수익률
  return5d: number | null;                    // 5일 수익률 (소수, 예: 0.03 = 3%)
  return20d: number | null;                   // 20일 수익률

  // Gate2 상대 강도 및 모멘텀
  rsScore: number | null;                     // 0~100 상대강도 점수
  relativeReturn20d: number | null;           // 종목 20d 수익률 - 코스피 20d 수익률
  maAlignmentStatus: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | null;  // MA 배열 상태
}

// ─── 수급 신호 (Gate2 공급 분석) ─────────────────────────────────────────────

/**
 * 수급 신호 분류.
 * BULLISH       — 외국인 + 기관 순매수 동조
 * ACCUMULATING  — 기관 단독 순매수 또는 완만한 외국인 매수
 * NEUTRAL       — 뚜렷한 방향 없음
 * BEARISH       — 외국인 + 기관 순매도 동조
 * UNKNOWN       — 수급 데이터 미확보 (providerHealth MISSING/STALE)
 */
export type SymbolSupplySignalLabel =
  | 'BULLISH'
  | 'ACCUMULATING'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'UNKNOWN';

/**
 * injectPerSymbolSupplyContext 의 PerSymbolSupplyContext 와 역할 분리:
 *   SymbolSupplySignal — 단일 수집 원시값 + 파생 신호 (UnifiedSourceSnapshot 내부)
 *   PerSymbolSupplyContext — 정책 해석 결과 (Gate 소비 직전 hydration 레이어)
 *
 * 단위: 원 (양수 = 순매수, 음수 = 순매도)
 */
export interface SymbolSupplySignal {
  foreignNetBuy: number | null;
  institutionNetBuy: number | null;
  individualNetBuy: number | null;
  programNetBuy: number | null;

  supplySignal: SymbolSupplySignalLabel;

  /**
   * 수집 당시 provider 건강 상태.
   * VERIFIED  — KIS API 정상 응답
   * DEGRADED  — 부분 응답 (일부 필드 누락)
   * STALE     — TTL 초과 캐시 사용
   * MISSING   — 데이터 없음
   */
  providerHealth: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';
  source: 'KIS_API' | 'NONE';
}

// ─── DART 재무 정본 슬롯 (Gate2 펀더멘털, L2 분기 cadence) ────────────────────

/**
 * DART 재무 정본 슬롯의 데이터 cadence.
 * L2(분기 공시) 데이터가 L1(KIS intraday) 신선도로 오인되지 않도록 명시 구분한다 (ADR-0529).
 * QUARTERLY_CACHED — gate2ExternalCache 의 cache-first last-good-value (분기 cadence refresh).
 * MISSING          — 정본 DART 미수집 (Gate 는 기존 read 경로로 fallback).
 */
export type SymbolDartCadence = 'QUARTERLY_CACHED' | 'MISSING';

/**
 * SymbolSnapshotData.dartFinancials 슬롯.
 * payload 는 Gate2DartEvaluationFinancials 재사용 (DART 값·Gate2 판정 byte-equivalent, ADR-0529).
 * 정본 메타(cadence/source/cacheHit/fetchedAt)로 L2 신선도를 L1 과 분리 표기한다.
 * 불변 계약: 이 슬롯은 cache-first read 결과만 담으며, collector 가 별도 fetch 로직을 신설하지 않는다.
 */
export interface SymbolDartFinancialsSlot {
  financials: Gate2DartEvaluationFinancials | null;
  cadence: SymbolDartCadence;
  source: 'GATE2_EXTERNAL_CACHE' | 'DART' | 'NONE';
  cacheHit: boolean;
  fetchedAt: string;   // 슬롯 채움 시각 (ISO 8601) — DART 공시일이 아닌 정본 read 시각
}

// ─── per-field freshness 통합 (ADR-0556 묶음0, DataHealth 공통 어휘) ──────────

/**
 * ADR-0556 D2/D4: factory 의 필드별 freshness/providerIssue 통합 산출.
 *
 * 신규 enum 신설 0 — 공통 어휘는 기존 `DataHealth`(src/types/shadowCase.ts:29) SSOT 를 재사용한다.
 * 각 도메인 내부 freshness(`SymbolSupplySignal.providerHealth`/`SymbolDataQuality`/
 * `SymbolDartCadence`)는 그대로 보존되고, 본 요약은 그것을 `DataHealth` 로 *매핑*한 표시/요약 등급이다.
 *
 * 불변식 #6 (provider 장애 ≠ market signal): 어떤 필드가 providerIssue 라도 `marketSignal` 은
 * 항상 false 다. providerHealth 메타는 데이터이지 시장(약세) 신호가 아니다
 * (`executionPermissionResolver.ts:208 providerIssueIsolated` 패턴 보존).
 */
export interface SymbolFieldFreshness {
  /** 필드별 freshness 등급 (DataHealth 매핑). 부재 필드는 'MISSING'. */
  quote: DataHealth;
  technicalIndicators: DataHealth;
  supply: DataHealth;
  dartFinancials: DataHealth;

  /**
   * 한 개 이상의 필드가 STALE/MISSING/DEGRADED 로 격리되었는지 여부.
   * true 여도 marketSignal 은 변환되지 않는다 (불변식 #6).
   */
  providerIssue: boolean;

  /**
   * 불변식 #6 격리 surface — 항상 false.
   * provider 장애(providerIssue=true)를 약세(bearish) market signal 로 변환 금지.
   */
  marketSignal: false;
}

// ─── 종목 단위 수집 결과 컨테이너 (최상위 타입) ──────────────────────────────

/**
 * SymbolSnapshotData — UnifiedSourceSnapshot.perSymbol 의 단위 레코드.
 *
 * 불변 계약:
 *   1. fetchedAt 이후 이 구조체의 필드는 변경하지 않는다 (스냅샷 의미론).
 *   2. quote 가 null 이면 dataQuality 는 반드시 'MISSING' 이다.
 *   3. Gate 는 이 구조체를 읽기 전용으로만 소비한다.
 */
export interface SymbolSnapshotData {
  // 식별
  code: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX';

  // KIS 원시 데이터 (4개 엔드포인트, 종목당 1회 수집)
  quote: KisStockFullQuote | null;           // FHKST01010100
  investorFlow: KisInvestorFlow | null;      // FHKST01010300
  dailyBars: KisStockDailyBar[];             // FHKST03010100 (최대 60일)
  programTrade: KisStockProgramTrade | null; // FHPPG04650201

  // 파생 지표 (collector 가 dailyBars 로부터 구성, Gate 는 읽기만)
  technicalIndicators: SymbolTechnicalIndicators | null;
  supplySignal: SymbolSupplySignal | null;

  // DART 재무 정본 슬롯 (L2, 분기 cadence — ADR-0529). null/미지정 = 정본 미수집 → Gate fallback.
  dartFinancials?: SymbolDartFinancialsSlot | null;

  /**
   * ADR-0556 묶음0: 필드별 freshness/providerIssue 통합 요약 (DataHealth 공통 어휘).
   * USE_UNIFIED_SOURCE_SNAPSHOT flag ON 경로에서만 산출 — flag OFF 시 undefined (byte-equivalent).
   * 각 도메인 내부 freshness enum 은 보존되며, 본 필드는 그 매핑 표시/요약일 뿐이다.
   */
  freshness?: SymbolFieldFreshness;

  // 수집 메타
  dataQuality: SymbolDataQuality;
  fetchedAt: string;         // ISO 8601
  fetchDurationMs: number;   // 4개 엔드포인트 총 수집 소요 시간 (ms)
}
