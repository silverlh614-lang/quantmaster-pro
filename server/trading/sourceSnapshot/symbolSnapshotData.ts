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

  // 수집 메타
  dataQuality: SymbolDataQuality;
  fetchedAt: string;         // ISO 8601
  fetchDurationMs: number;   // 4개 엔드포인트 총 수집 소요 시간 (ms)
}
