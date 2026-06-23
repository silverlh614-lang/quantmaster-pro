// @responsibility ADR-0650 눌림목 레인 forward-return 관측 row/sourceType 타입 계약 SSOT — 관측 전용, executionImpact=NONE, 주문/provider 호출 0.
/**
 * pullbackLaneObservationTypes.ts — ADR-0650 관측 라인 타입 계약 (architect pin).
 *
 * 본 파일은 **타입 계약 단일 SSOT** 만 노출한다(부수효과 0·import 0 of 본 모듈로 인한 런타임 동작).
 * 구현(repo 본문·성숙 cron 정규화·carry·display)은 engine-dev/learning 인계 — HANDOFF_0650.md.
 *
 * ## 4단계 배선 (ADR-0650)
 *   D1 영속화 — PullbackLaneObservationRow 를 신규 pullbackLaneObservationRepo 에 멱등 영속.
 *   D2 성숙   — unifiedForwardOutcomeLabeler 의 PULLBACK_LANE sourceType 으로 forward 1D/3D/5D 채움.
 *   D3 carry  — entryLane='PULLBACK' + breakoutChaseLaneFired 를 관측 row 로 전파.
 *   D4 표시   — /gate_audit 에 눌림목 vs 추격 비교 섹션.
 *
 * ## 불변 계약
 *   - executionImpact: 'NONE' (컴파일 타임 표식) — 진입 selection·Gate 판정·주문 무관.
 *   - observationOnly: true — LIVE 매매 본체 0줄·현 SHADOW_ONLY live 0.
 *   - marketSignal=false 로 forward-outcome 행 정규화 (불변식 #6).
 *   - 성숙은 KIS 일봉(L1) read-only priceFetcher 재사용 — 두 번째 forward-return 공식 0 (ADR-0561/0625).
 */

/** ADR-0650 §D1 — 한 스캔당 한 종목 1행. 영속: pullbackLaneObservationRepo. */
export interface PullbackLaneObservationRow {
  /** 멱등 키 구성원 1 — sourceSnapshotId(=scanId). */
  scanId: string;
  /** 멱등 키 구성원 2 — KRX 종목코드. */
  symbol: string;
  /** 스캔-시점 KST ISO (asOf — forward horizon 기준일). */
  asOf: string;

  // ── 스캔-시점 stamp carry (pullbackLaneShadowObservationAdr0648 산출) ───────────
  /** force-ON 가정 레인 B(눌림목) 임계 충족 — 눌림목 표본 식별. */
  pullbackLaneHypotheticalFired: boolean;
  /** 추격(레인 C) FIRED — 대조군 식별 (ADR-0650 §D3). */
  breakoutChaseLaneFired: boolean;
  /** 과열 가드(price/high5d>1.06) 거부 여부. */
  overheatGuardTriggered: boolean;
  /** price/high20d 실측(산출 불가 시 null). */
  posVsHigh20d: number | null;
  /** volume/avgVolume 실측(산출 불가 시 null). */
  volRatio: number | null;
  /** price ≥ ma20. */
  aboveMa20: boolean;

  // ── 진입시점 메타 (가용 시) ──────────────────────────────────────────────
  /** 진입시점 RRR(calcRRR 단일 통로 산출분 carry — 가용 시). 비교 §D4 입력. */
  entryRrr?: number;
  /** 진입 레인 태그 carry — 'PULLBACK' 이면 눌림목 레인 FIRED 후보 (watchlistRepo 동형). */
  entryLane?: 'PULLBACK';

  // ── 사후 성숙(unifiedForwardOutcomeLabeler §D2) ──────────────────────────
  /** forward 1영업일 수익률 % (미성숙 undefined). */
  forwardReturn1d?: number;
  /** forward 3영업일 수익률 % (미성숙 undefined). */
  forwardReturn3d?: number;
  /** forward 5영업일 수익률 % (미성숙 undefined). */
  forwardReturn5d?: number;
  /** 전 horizon 채워진 시점 ISO (RESOLVED 전환 시각·불변성 키). */
  maturedAt?: string;

  /** 성숙 상태 — RESOLVED 행은 재기입 skip (멱등 불변성). */
  maturity: 'PENDING' | 'RESOLVED';
  /** 컴파일 타임 관측 전용 표식 (executionImpact=NONE 계약). */
  observationOnly: true;
}

/**
 * ADR-0650 §D1 — 멱등 키 SSOT. 한 스캔(scanId)당 한 종목(symbol) 1행.
 * engine-dev: pullbackLaneObservationRepo.upsertObservation 이 본 키로 dedup·RESOLVED skip.
 */
export function pullbackLaneObservationKey(
  row: Pick<PullbackLaneObservationRow, 'scanId' | 'symbol'>,
): string {
  return `${row.scanId}:${row.symbol}`;
}

/**
 * ADR-0650 §D4 — /gate_audit 비교 표시 입력 계약 (눌림목 vs 추격).
 * gateAudit.cmd 빌더가 loadObservations() RESOLVED 행을 본 형태로 집계 → 표시.
 */
export interface PullbackVsChaseForwardComparison {
  /** 눌림목(entryLane=PULLBACK || pullbackLaneHypotheticalFired) 표본. */
  pullback: PullbackLaneForwardAggregate;
  /** 추격(breakoutChaseLaneFired) 표본. */
  chase: PullbackLaneForwardAggregate;
  /** D5 표본 N≥30 && 눌림목 avg5D ≥ 추격 avg5D → 'HOLD'(유지) / else 'INSUFFICIENT_OR_ROLLBACK'. */
  verdict: 'HOLD' | 'INSUFFICIENT_OR_ROLLBACK';
  /** 표시 힌트 — 자동 flag 변경 0 (thresholdAutoChanged=false). */
  verdictHint: string;
}

/** §D4 — 레인별 forward-return·RRR 평균 집계 (RESOLVED 행 기준). */
export interface PullbackLaneForwardAggregate {
  nD1: number; nD3: number; nD5: number;
  avgForwardReturn1d: number | null;
  avgForwardReturn3d: number | null;
  avgForwardReturn5d: number | null;
  /** 평균 진입 RRR (entryRrr 가용 행 기준·없으면 null). */
  avgEntryRrr: number | null;
}

/**
 * ADR-0650 §D4 — 판정 SSOT 상수. N≥30 & 눌림목 avg5D ≥ 추격 avg5D → 유지.
 * gateAudit 빌더·테스트 공유 (하드코딩 금지·드리프트 차단).
 */
export const PULLBACK_VERDICT_MIN_SAMPLE = 30;
