// @responsibility macroStateRepo 영속화 저장소 모듈
import fs from 'fs';
import { MACRO_STATE_FILE, ensureDataDir } from './paths.js';
import type { SectorEnergyResult } from '../../src/types/sectorEnergy.js';
import type { FssRecordsAgeInfo } from './fssRepo.js';

export interface MacroState {
  mhs: number;        // Macro Health Score (0~100)
  regime: string;     // 'GREEN' | 'YELLOW' | 'RED'
  updatedAt: string;  // ISO
  // 아이디어 10: Bear Regime 보조 지표 (optional — 클라이언트에서 전달 시 저장)
  vkospi?: number;                  // 한국 변동성 지수
  foreignFuturesSellDays?: number;  // 외국인 선물 연속 순매도 일수
  iri?: number;                     // IRI 위험 지표 델타 (pt) — bearRegimeAlert IRI 라인 표시용 (cron writer 부재 시 'N/A')
  // 아이디어 11: IPS 변곡점 엔진 보조 지표 (optional)
  vix?: number;                     // VIX 공포지수
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING'; // MHS 추세
  vkospiRising?: boolean;           // VKOSPI 상승 추세
  bearRegimeTriggeredCount?: number; // Bear Regime 발동 조건 수 — ipsAlert FSS 음수 +20% 가산점 (cron writer 부재 시 0 fallback)
  bearDefenseMode?: boolean;        // Bear 방어 모드 여부
  oeciCliKorea?: number;            // OECD 경기선행지수 한국 — ipsAlert TMA 감속 신호 (cron writer 부재 시 100 fallback)
  exportGrowth3mAvg?: number;       // 수출 증가율 3개월 이동평균 (%)
  dxyBullish?: boolean;             // DXY 달러 강세 여부
  kospiBelow120ma?: boolean;        // KOSPI 120일선 하회 여부
  ips?: number;                     // 마지막 IPS 점수 (캐시)
  fss?: number;                     // 마지막 FSS 누적 점수 (캐시)
  fssAlertLevel?: 'NORMAL' | 'CAUTION' | 'HIGH_ALERT'; // FSS 경보 단계
  // ─── RegimeVariables 7축 매핑용 (optional — 클라이언트 전달 시 저장) ──────
  vkospiDayChange?: number;         // VKOSPI 당일 변화율
  vkospi5dTrend?: number;           // VKOSPI 5일 추세 (양수=상승)
  usdKrw?: number;                  // 원달러 환율
  usdKrw20dChange?: number;         // 원달러 20일 변화율
  usdKrwDayChange?: number;         // 원달러 당일 변화율
  /** ADR-0071: usdKrw 가 어느 소스에서 왔는지 (Yahoo 'PRIMARY' / ECOS 'SECONDARY'). */
  usdKrwSource?: 'PRIMARY' | 'SECONDARY' | null;
  /** ADR-0071: Yahoo vs ECOS 격차 % (한쪽 미수집 시 null). */
  usdKrwDivergencePct?: number | null;
  /** ADR-0071: 분기 결과 tier — AGREED/WARN/CRITICAL/PRIMARY_ONLY/SECONDARY_ONLY/NO_DATA. */
  usdKrwDivergenceTier?: string;
  foreignNetBuy5d?: number;         // 외국인 순매수 5일 누적 (억원)
  /**
   * ADR-0136: 격상 *boolean → boolean | null*. null = STALE/MISSING 으로 평가
   * 자체 불가 (페르소나 의사결정에서 *데이터 결손* 과 *시그널 부재* 구분).
   * `regimeBridge.buildRegimeVars` 에서 `?? false` fallback 으로 RegimeVariables
   * 시그니처 (boolean) 후방호환 유지.
   */
  passiveActiveBoth?: boolean | null;
  /**
   * ADR-0136: FSS 레코드 신선도 진단 — `/fss_status` 텔레그램 명령 + 후속
   * 의사결정 wiring 의 데이터 입력. `marketDataRefresh.refreshMarketRegimeVars`
   * 가 매 사이클 갱신.
   */
  fssRecordsAge?: FssRecordsAgeInfo;
  kospiAbove20MA?: boolean;         // KOSPI 20일선 위
  kospiAbove60MA?: boolean;         // KOSPI 60일선 위
  kospi20dReturn?: number;          // KOSPI 20일 수익률
  kospiDayReturn?: number;          // KOSPI 당일 수익률
  leadingSectorRS?: number;         // 선행 섹터 상대강도 (0~100)
  sectorCycleStage?: 'EARLY' | 'MID' | 'LATE' | 'TURNING'; // 섹터 사이클
  marginBalance5dChange?: number;   // 신용잔고 5일 변화율
  shortSellingRatio?: number;       // 공매도 비율 (%)
  /** Phase 1 — 어느 fallback 단계에서 데이터를 얻었는지 (KRX_DIRECT/KRX_OTP/KIS_ESTIMATE). */
  shortSellingSource?: 'KRX_DIRECT' | 'KRX_OTP' | 'KIS_ESTIMATE';
  /** Phase 1 — 마지막 조회 성공 시각 (ISO) — /health 신선도 표시용. */
  shortSellingFetchedAt?: string;
  spx20dReturn?: number;            // S&P500 20일 수익률
  dxy5dChange?: number;             // 달러인덱스 5일 변화율
  // ─── 글로벌 스캔 에이전트 선행 레이어 필드 ──────────────────────────────────
  vixHistory?: number[];            // VIX 일별 종가 이력 (최신 → 인덱스 마지막, 최대 5개)
  ewyDayChange?: number;            // EWY 전일 대비 변화율 (%) — Layer 13 외국인 수급 선행
  // ─── FRED 거시 지표 (marketDataRefresh.ts 자동 갱신) ────────────────────────
  yieldCurve10y2y?: number;         // T10Y2Y: 장단기 금리차 (%) — 음수 시 침체 6~18개월 선행
  hySpread?: number;                // BAMLH0A0HYM2: US HY 스프레드 (%) — 신용 위험 프록시
  sofr?: number;                    // SOFR: 달러 단기 기준금리 프록시 (%)
  financialStress?: number;         // STLFSI4: 세인트루이스 금융스트레스 지수 (0 기준, 양수 = 스트레스)
  wtiCrude?: number;                // DCOILWTICO: WTI 유가 (USD/배럴) — 수출주/정유 영향
  // ─── 레짐 승급 보조 필드 (marketDataRefresh 자동 갱신) ──────────────────────
  kospiAboveMA20Pct?: number;       // KOSPI가 MA20 대비 몇 % 위에 있는지
  foreignContinuousBuyDays?: number; // 외국인 연속 순매수 일수
  // ─── ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 SSOT ─────────────────
  /**
   * marketDataRefresh 가 evaluateSectorEnergy() 결과를 영속화한 스냅샷.
   * entryEngine 의 Gate Score 산출 시점에 read 만 — applySectorScoreBoost() 입력.
   * 갱신 실패/입력 부재 시 undefined → 보너스 0 (안전 fallback).
   *
   * sectorEnergyEngine 결과는 캘린더일 1회 단위 변동 — 1분 cron 매번 갱신 부담은
   * 회피하고, marketDataRefresh 의 일일 사이클 (장 마감 후)에서만 갱신한다.
   */
  sectorEnergyResult?: SectorEnergyResult;
  /** sectorEnergyResult 마지막 갱신 시각 (ISO) — /regime 메시지 신선도 표시용. */
  sectorEnergyUpdatedAt?: string;
  /**
   * ADR-0125 (PR-1 후속): sectorEnergy 데이터 품질 — buildSectorEnergyInputsWithMeta
   * 결과의 dataQuality 영속. applySectorScoreBoost 가 read 후 OK/PARTIAL/STALE/FAILED
   * 분기로 boost 강도 분기.
   *   - OK     → boost full (기본)
   *   - PARTIAL→ boost × 0.5 → Math.round
   *   - STALE  → boost 0 (단, sectorEnergyResult 는 이전 캐시 보존됨 — reference 표시)
   *   - FAILED → boost 0
   */
  sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
  /** ADR-0125: 12 섹터 중 유효 (returns.length>0) 섹터 수 — /scan_blockers 진단용. */
  sectorEnergyValidSectorCount?: number;
  /** ADR-0125: dataQuality 분류 사유 (debug용). 빈 배열 가능. */
  sectorEnergyReasons?: string[];
  /**
   * MHS 4-axis 분해 (interestRate / liquidity / economy / risk).
   * macroIndexEngine.computeMacroIndex 의 idx.axis 결과 — 사용자 진단 (4/29):
   * "MHS 70 을 벗어난 적이 없다" — axis 분해 노출로 변동성 가시화.
   * 각 axis 는 0~25 범위, 합산 = mhs.
   */
  mhsAxis?: {
    interestRate: number;
    liquidity: number;
    economy: number;
    risk: number;
  };
  /** mhsAxis 마지막 갱신 시각 — `marketDataRefresh` 사이클 종료 시점. */
  mhsAxisUpdatedAt?: string;
}

export function loadMacroState(): MacroState | null {
  ensureDataDir();
  if (!fs.existsSync(MACRO_STATE_FILE)) {
    const defaultState: MacroState = {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(defaultState, null, 2));
    return defaultState;
  }
  try { return JSON.parse(fs.readFileSync(MACRO_STATE_FILE, 'utf-8')); } catch { return null; }
}

export function saveMacroState(state: MacroState): void {
  ensureDataDir();
  fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(state, null, 2));
}
