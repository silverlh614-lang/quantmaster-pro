// @responsibility ADR-0648 눌림목 레인 force-ON hypothetical shadow 관측 stamp (진단 전용·marketSignal=false).
/**
 * pullbackLaneShadowObservationAdr0648.ts — 눌림목 진입 레인(ADR-0648) shadow-first 관측.
 *
 * flag(GATE_PULLBACK_ENTRY_LANE_ENABLED) OFF 에서도 force-ON 가정으로 눌림목 레인 임계
 * 충족 여부와 대조군(추격 레인 FIRED·과열 가드 trigger)을 산출한다. 추격(레인 C) 대비
 * 눌림목(레인 B)의 forward 1D/3D/5D return 우월성을 flip 결정 전에 데이터로 검증하기 위한
 * 관측 ledger 행(ADR-0476 패턴). live entry-selection 무변경 — 행에만 기록.
 *
 * 본 모듈은 순수 함수만 노출한다(부수효과 0). 호출자가 try/catch 로 감싸 불변식 #1/#2 격리.
 */

/** 눌림목 레인 force-ON hypothetical 관측 입력(이미 존재하는 quote 필드만 — 신규 fetch 0). */
export interface PullbackLaneShadowQuoteInput {
  price?: number;
  high5d?: number;
  high20d?: number;
  ma20?: number;
  volume?: number;
  avgVolume?: number;
}

/** 단일 후보 force-ON hypothetical stamp (진단 전용 — 매매 무관). forwardReturn* 은 cron 사후 채움. */
export interface PullbackLaneShadowStamp {
  /** force-ON 가정(flag 무관) 레인 B 임계 충족 여부. */
  pullbackLaneHypotheticalFired: boolean;
  /** price/high20d 실측값 (산출 불가 시 null). */
  pullbackLanePosVsHigh20d: number | null;
  /** volume/avgVolume 실측값 (산출 불가 시 null). */
  pullbackLaneVolRatio: number | null;
  /** price ≥ ma20 (boolean). */
  pullbackLaneAboveMa20: boolean;
  /** 추격(레인 C) FIRED 였는지 — 대조군. */
  breakoutChaseLaneFired: boolean;
  /** 과열 가드(price/high5d > 1.06) 거부 여부. */
  overheatGuardTriggered: boolean;
  /** forward-return cron 사후 채움 — 추격 대비 대조용. */
  pullbackLaneForwardReturn1d?: number;
  pullbackLaneForwardReturn3d?: number;
  pullbackLaneForwardReturn5d?: number;
}

function ratio(num: number | undefined, den: number | undefined): number | null {
  if (typeof num !== 'number' || typeof den !== 'number') return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num / den;
}

/**
 * force-ON hypothetical stamp 산출. flag 와 무관하게 항상 눌림목 레인 임계를 평가한다.
 * evaluators.ts D1/D2 임계와 동일(0.92~0.99 / aboveMA20 / 0.5~0.9, 과열 1.06).
 */
export function buildPullbackLaneShadowStamp(q: PullbackLaneShadowQuoteInput): PullbackLaneShadowStamp {
  const posVsHigh20d = ratio(q.price, q.high20d);
  const posVsHigh5d  = ratio(q.price, q.high5d);
  const volRatio     = ratio(q.volume, q.avgVolume);
  const aboveMa20    = typeof q.price === 'number' && typeof q.ma20 === 'number'
    && q.ma20 > 0 && q.price >= q.ma20;

  const pullbackLaneHypotheticalFired =
    posVsHigh20d !== null && volRatio !== null &&
    posVsHigh20d >= 0.92 && posVsHigh20d <= 0.99 &&
    aboveMa20 &&
    volRatio >= 0.5 && volRatio <= 0.9;

  // 대조군: 추격(레인 C) 강/약 돌파 FIRED 였는지 (과열 가드 적용 전 기준 — 분포 비교용).
  const breakoutChaseLaneFired =
    posVsHigh5d !== null && volRatio !== null &&
    ((posVsHigh5d >= 1.01 && volRatio >= 1.5) || (posVsHigh5d >= 0.99 && volRatio >= 1.2));

  const overheatGuardTriggered = posVsHigh5d !== null && posVsHigh5d > 1.06;

  return {
    pullbackLaneHypotheticalFired,
    pullbackLanePosVsHigh20d: posVsHigh20d,
    pullbackLaneVolRatio: volRatio,
    pullbackLaneAboveMa20: aboveMa20,
    breakoutChaseLaneFired,
    overheatGuardTriggered,
  };
}

/** 스캔 전체 force-ON hypothetical 집계 (scan_blockers 1줄 요약 + flip 근거). 진단 전용. */
export interface PullbackLaneShadowSummary {
  totalSamples: number;
  pullbackHypotheticalFired: number;
  breakoutChaseFired: number;
  overheatGuardTriggered: number;
  /** 추격은 FIRED 가 아닌데 눌림목 force-ON 은 FIRED — 눌림목 레인이 추가 포착한 후보 수. */
  pullbackOnlyFired: number;
}

export function buildPullbackLaneShadowSummary(stamps: PullbackLaneShadowStamp[]): PullbackLaneShadowSummary {
  const summary: PullbackLaneShadowSummary = {
    totalSamples: stamps.length,
    pullbackHypotheticalFired: 0,
    breakoutChaseFired: 0,
    overheatGuardTriggered: 0,
    pullbackOnlyFired: 0,
  };
  for (const s of stamps) {
    if (s.pullbackLaneHypotheticalFired) summary.pullbackHypotheticalFired += 1;
    if (s.breakoutChaseLaneFired) summary.breakoutChaseFired += 1;
    if (s.overheatGuardTriggered) summary.overheatGuardTriggered += 1;
    if (s.pullbackLaneHypotheticalFired && !s.breakoutChaseLaneFired) summary.pullbackOnlyFired += 1;
  }
  return summary;
}

/** /scan_blockers 1줄 요약 (marketSignal=false, 진단 전용). 샘플 0 → null(섹션 생략). */
export function formatPullbackLaneShadowLine(summary: PullbackLaneShadowSummary | undefined): string | null {
  if (!summary || summary.totalSamples <= 0) return null;
  return (
    `🩹 눌림목레인(ADR-0648 shadow·진단): 가정FIRED ${summary.pullbackHypotheticalFired}` +
    ` / 추격FIRED ${summary.breakoutChaseFired} / 과열거부 ${summary.overheatGuardTriggered}` +
    ` / 눌림목단독 ${summary.pullbackOnlyFired} (n=${summary.totalSamples}, marketSignal=false)`
  );
}
