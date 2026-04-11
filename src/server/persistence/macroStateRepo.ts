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
}

export function loadMacroState(): MacroState | null {
  ensureDataDir();
  if (!fs.existsSync(MACRO_STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(MACRO_STATE_FILE, 'utf-8')); } catch { return null; }
}

export function saveMacroState(state: MacroState): void {
  ensureDataDir();
  fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(state, null, 2));
}
