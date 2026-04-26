// @responsibility macroStateRepo 영속화 저장소 모듈
import fs from 'fs';
import { MACRO_STATE_FILE, ensureDataDir } from './paths.js';

export interface MacroState {
  mhs: number;        // Macro Health Score (0~100)
  regime: string;     // 'GREEN' | 'YELLOW' | 'RED'
  updatedAt: string;  // ISO
  // 아이디어 10: Bear Regime 보조 지표 (optional — 클라이언트에서 전달 시 저장)
  vkospi?: number;                  // 한국 변동성 지수
  foreignFuturesSellDays?: number;  // 외국인 선물 연속 순매도 일수
  iri?: number;                     // IRI 위험 지표 델타 (pt)
  // 아이디어 11: IPS 변곡점 엔진 보조 지표 (optional)
  vix?: number;                     // VIX 공포지수
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING'; // MHS 추세
  vkospiRising?: boolean;           // VKOSPI 상승 추세
  bearRegimeTriggeredCount?: number; // Bear Regime 발동 조건 수
  bearDefenseMode?: boolean;        // Bear 방어 모드 여부
  oeciCliKorea?: number;            // OECD 경기선행지수 한국
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
  foreignNetBuy5d?: number;         // 외국인 순매수 5일 누적 (억원)
  passiveActiveBoth?: boolean;      // 패시브+액티브 동시 외국인 순매수
  kospiAbove20MA?: boolean;         // KOSPI 20일선 위
  kospiAbove60MA?: boolean;         // KOSPI 60일선 위
  kospi20dReturn?: number;          // KOSPI 20일 수익률
  kospiDayReturn?: number;          // KOSPI 당일 수익률
  leadingSectorRS?: number;         // 선행 섹터 상대강도 (0~100)
  sectorCycleStage?: 'EARLY' | 'MID' | 'LATE' | 'TURNING'; // 섹터 사이클
  marginBalance5dChange?: number;   // 신용잔고 5일 변화율
  shortSellingRatio?: number;       // 공매도 비율 (%)
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
