/**
 * scanPresets.ts — 시간대별 Pre-Filter 3-Presets
 *
 * 기존 autoPopulateWatchlist의 하드컷은 단일 임계값 기준이라 시간대 편차를 무시했다.
 *   - 09:00~10:00: 거래량/누적 데이터가 아직 얕아 volume 조건은 거의 항상 탈락
 *   - 12:30~14:00: 점심 저변동 구간 — VCP(변동성 압축) 신호가 상대적으로 강해지므로 가중
 *   - 14:30~15:20: 마감 근접 — 눌림목·종가 근접 거래량이 더 가치 있음
 *
 * 이 모듈은 각 구간에 맞는 한 장의 "커브"를 MORNING/MIDDAY/CLOSE 프리셋으로 제공한다.
 * stockScreener.autoPopulateWatchlist가 이 프리셋의 값을 읽어 동작.
 */

export type ScanPresetPhase = 'MORNING' | 'MIDDAY' | 'CLOSE' | 'OFFHOURS';

export interface ScanPreset {
  phase: ScanPresetPhase;
  /** 당일 변동률 하한 (%). 이보다 낮으면 탈락. */
  changePercentMin: number;
  /** 당일 변동률 상한 (%). 이보다 높으면 과열 탈락. */
  changePercentMax: number;
  /** 5일 누적 수익률 상한 (%). 이보다 높으면 FOMO 회피. */
  return5dMax: number;
  /**
   * 평균 대비 거래량 배수 하한. null이면 "거래량 조건 없음".
   * 예: 1.5 → quote.volume ≥ quote.avgVolume × 1.5 필요.
   */
  minVolumeMultiplier: number | null;
  /** VCP(Compression Score) 점수 가중 — 기본 1.0. MIDDAY는 상향. */
  vcpWeightMultiplier: number;
  /**
   * 눌림목·마감근접 스코어 가중. CLOSE에서 상향.
   * 현재는 가중으로만 사용되고 실질 필터는 아니다 (추후 확장 여지).
   */
  pullbackWeightMultiplier: number;
  /** 사람이 읽을 수 있는 요약. */
  label: string;
}

// ── 3단 프리셋 정의 ──────────────────────────────────────────────────────────

/**
 * MORNING 09:00~10:00
 * - 거래량 누적 미비 → volume 조건 제거
 * - changePercent -1 ~ +10 (기존 -3 ~ +8 보다 상단 확대, 하단 축소)
 * - VCP 가중 기본
 */
const MORNING: ScanPreset = {
  phase: 'MORNING',
  changePercentMin: -1,
  changePercentMax: 10,
  return5dMax: 25,
  minVolumeMultiplier: null,
  vcpWeightMultiplier: 1.0,
  pullbackWeightMultiplier: 1.0,
  label: '시초가 구간 (09:00~10:00) — volume 완화, +10%까지 허용',
};

/**
 * MIDDAY 12:30~14:00
 * - 점심 저변동 구간 — VCP 가중 상향
 * - 거래량 1.2배 최소 (평균 대비)
 */
const MIDDAY: ScanPreset = {
  phase: 'MIDDAY',
  changePercentMin: -2,
  changePercentMax: 8,
  return5dMax: 20,
  minVolumeMultiplier: 1.2,
  vcpWeightMultiplier: 1.3,
  pullbackWeightMultiplier: 1.0,
  label: '점심 저변동 구간 (12:30~14:00) — VCP 가중 상향',
};

/**
 * CLOSE 14:30~15:20
 * - 눌림목 + 마감근접 거래량 기준 — 거래량 배수 완화
 * - 과열 후보를 더 적극적으로 수용 (changePercentMax 12)
 */
const CLOSE: ScanPreset = {
  phase: 'CLOSE',
  changePercentMin: -3,
  changePercentMax: 12,
  return5dMax: 22,
  minVolumeMultiplier: 1.0,
  vcpWeightMultiplier: 1.1,
  pullbackWeightMultiplier: 1.4,
  label: '마감 근접 (14:30~15:20) — 눌림목·종가 거래량 가중',
};

/**
 * 장외 / 기타 구간 — 기존 기본값 유지 (하위 호환).
 */
const OFFHOURS: ScanPreset = {
  phase: 'OFFHOURS',
  changePercentMin: -3,
  changePercentMax: 8,
  return5dMax: 20,
  minVolumeMultiplier: null,
  vcpWeightMultiplier: 1.0,
  pullbackWeightMultiplier: 1.0,
  label: '장외/기타 — 기본 커브',
};

// ── KST 시간대 판정 ──────────────────────────────────────────────────────────

/**
 * KST(UTC+9) 기준 HHMM 정수를 반환. 09:30 → 930, 14:05 → 1405.
 * 테스트에서 now를 주입할 수 있도록 파라미터화.
 */
function kstHhmm(now: Date = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 100 + kst.getUTCMinutes();
}

/**
 * 현재(또는 주입된) 시각에 해당하는 프리셋 반환.
 * 경계:
 *   09:00 ≤ t < 10:00 → MORNING
 *   12:30 ≤ t < 14:00 → MIDDAY
 *   14:30 ≤ t < 15:20 → CLOSE
 *   그 외 → OFFHOURS (10:00~12:30, 14:00~14:30, 15:20~)
 */
export function getCurrentScanPreset(now: Date = new Date()): ScanPreset {
  const t = kstHhmm(now);
  if (t >= 900  && t < 1000) return MORNING;
  if (t >= 1230 && t < 1400) return MIDDAY;
  if (t >= 1430 && t < 1520) return CLOSE;
  return OFFHOURS;
}

/** 외부에서 특정 프리셋을 직접 참조하고 싶을 때. */
export const SCAN_PRESETS = { MORNING, MIDDAY, CLOSE, OFFHOURS } as const;
