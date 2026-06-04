// @responsibility watchlistRepo 영속화 저장소 모듈
import fs from "fs";
import { WATCHLIST_FILE, ensureDataDir } from "./paths.js";
import { sendTelegramAlert } from "../alerts/telegramClient.js";
import {
  evaluateWatchlistSaturationAlert,
  recordWatchlistSaturationAlertSent,
  buildWatchlistSaturationMessage,
  formatWatchlistSaturationSentLog,
  shouldSendWatchlistSaturationTelegram,
  formatWatchlistSaturationSuppressedLog,
  formatWatchlistSaturationStatusLog,
  buildWatchlistSaturationDedupeKey,
  resolveWatchlistSaturationTelegramCooldownMs,
} from "./watchlistSaturationPolicy.js";
import { isEmergencyWatchlistCodeGuardEnabled } from "../dataQuality/emergencyDataQualityGuards.js";
import { normalizeKrxCode } from "../utils/symbolNormalizer.js";
import {
  getStockByCode,
  isTradableKrxEquity,
  isSpecialSecurityName,
} from "./krxStockMasterRepo.js";
import type { GateEvaluationSnapshot } from "../quantFilter.js";

/**
 * 워치리스트 섹션 — 신호 품질에 따라 매매 파라미터를 차등 적용
 *
 *   SWING     — 스윙 주도주 (Discovery Pipeline, Gate 상위, MANUAL)
 *              최대 8개 · 보유 3~15일 · 표준 포지션 · ATR 동적 손절 · 만료 7영업일
 *   CATALYST  — 촉매 기반 (DART 공시, 내부자 매수)
 *              최대 5개 · 보유 1~5일 · 60% 축소 포지션 · 고정 -5% 손절 · 만료 3일
 *   MOMENTUM  — 모멘텀 관찰 (autoPopulateWatchlist AUTO, 거래량 상위)
 *              최대 20개 · 매매 안 함 · SWING 승격 시만 매수 · 만료 2영업일
 */
export type WatchlistSection = "SWING" | "CATALYST" | "MOMENTUM";

/** 알림 임계 (HIGH priority 텔레그램 발송 기준). soft cap 보다 클 수 있음. */
export const MOMENTUM_ALERT_THRESHOLD = 30;

// PR-3 #8: 섹션별 하드 상한 — watchlistManager.SECTION_MAX 와 동일 값.
// 순환 import 를 피하기 위해 상수를 복제해 놓는다. 값이 바뀌면 양쪽 동기 필요.
//
// 기존에는 16:00 KST cleanupWatchlist 스케줄에서만 상한을 강제했기 때문에, 사이
// 시점에 addToWatchlist 가 연속 호출되면 MOMENTUM 이 50 → 91 까지 방치되는 사례가
// 발생했다 (2026-04-23 Telegram 경보 이력). saveWatchlist 시점에 즉시 trim.
const DEFAULT_SECTION_HARD_MAX: Record<WatchlistSection, number> = {
  SWING: 8,
  CATALYST: 5,
  MOMENTUM: 50,
};

/**
 * ADR-0028 §모순9: soft cap — 능동 정리 시작 임계.
 * hard cap 도달 *전에* composite score 하위 entry 를 능동 trim 해
 * "30~50 deadzone" (위험 인지는 됐는데 시스템 액션 0) 회귀를 차단.
 *
 * 기본값:
 *  - SWING 6  (hard 8 의 75%)
 *  - CATALYST 4 (hard 5 의 80%)
 *  - MOMENTUM 40 (hard 50 의 80% — Patch-WATCHLIST-SATURATION-COOLDOWN-001:
 *    30~39 구간은 ADVISORY/용량 주의 — 강제 cleanup 없음. soft cap 40 이상부터 능동 정리.)
 *
 * env 오버라이드: WATCHLIST_SOFT_CAP_{SECTION}, WATCHLIST_HARD_CAP_{SECTION}.
 * `WATCHLIST_SOFT_CAP_DISABLED=true` → soft cap 능동 정리 비활성 (기존 동작 복원).
 */
const DEFAULT_SECTION_SOFT_CAP: Record<WatchlistSection, number> = {
  SWING: 6,
  CATALYST: 4,
  MOMENTUM: 40,
};

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * 섹션별 soft/hard cap 해석 SSOT — env 오버라이드 + soft<=hard 정합 보호.
 * 호출 시점마다 env 를 읽어 운영 중 환경변수 변경 즉시 반영.
 */
export function resolveSectionCaps(): {
  hard: Record<WatchlistSection, number>;
  soft: Record<WatchlistSection, number>;
  softDisabled: boolean;
} {
  const hard: Record<WatchlistSection, number> = {
    SWING: envInt("WATCHLIST_HARD_CAP_SWING", DEFAULT_SECTION_HARD_MAX.SWING),
    CATALYST: envInt(
      "WATCHLIST_HARD_CAP_CATALYST",
      DEFAULT_SECTION_HARD_MAX.CATALYST,
    ),
    MOMENTUM: envInt(
      "WATCHLIST_HARD_CAP_MOMENTUM",
      DEFAULT_SECTION_HARD_MAX.MOMENTUM,
    ),
  };
  const softRaw: Record<WatchlistSection, number> = {
    SWING: envInt("WATCHLIST_SOFT_CAP_SWING", DEFAULT_SECTION_SOFT_CAP.SWING),
    CATALYST: envInt(
      "WATCHLIST_SOFT_CAP_CATALYST",
      DEFAULT_SECTION_SOFT_CAP.CATALYST,
    ),
    MOMENTUM: envInt(
      "WATCHLIST_SOFT_CAP_MOMENTUM",
      DEFAULT_SECTION_SOFT_CAP.MOMENTUM,
    ),
  };
  // soft 가 hard 를 초과하면 능동 정리가 무의미해지므로 hard 로 클램핑.
  const soft: Record<WatchlistSection, number> = {
    SWING: Math.min(softRaw.SWING, hard.SWING),
    CATALYST: Math.min(softRaw.CATALYST, hard.CATALYST),
    MOMENTUM: Math.min(softRaw.MOMENTUM, hard.MOMENTUM),
  };
  return {
    hard,
    soft,
    softDisabled: process.env.WATCHLIST_SOFT_CAP_DISABLED === "true",
  };
}

function sectionOf(entry: WatchlistEntry): WatchlistSection {
  if (entry.section) return entry.section;
  // 레거시 track 필드 fallback (track='A' = MOMENTUM, 'B' = SWING)
  if (entry.track === "A") return "MOMENTUM";
  if (entry.track === "B") return "SWING";
  return "MOMENTUM";
}

/**
 * ADR-0028 §모순9: composite trim score — 단순 gateScore 가 아닌 다축 가중합.
 *
 * 기존 정책의 보수성·정태성 (어제 gateScore 9 로 들어왔지만 오늘 추세 잃은 entry 가
 * gateScore 만으로 보존되던 회귀) 차단을 위해 다음 4축 합성:
 *
 *   + gateScore                 (0~27, 기본 신뢰도)
 *   - staleness × 1.0/일          (addedAt 기준 일수, 오래될수록 ↓)
 *   - entryFailCount × 2.0       (진입 시도 실패 누적, 실패 ≥1회 강하게 페널티)
 *   - TTL 임박 -3                 (expiresAt 잔여 12h 미만)
 *   - leadershipBridge -0.5       (기존 정책 유지, 동적 편입 우선 드롭)
 *
 * 점수가 낮을수록 trim 우선순위 ↑. NaN/Infinity 안전 fallback.
 *
 * `WATCHLIST_SOFT_CAP_DISABLED=true` env 시 호출자(enforceSectionCaps soft 단계)는
 * 본 함수를 사용하지 않고 기존 단순 gateScore 정책으로 폴백 — 점진 적용 안전망.
 */
export const TTL_NEAR_EXPIRY_MS = 12 * 60 * 60 * 1000;

export function computeTrimScore(
  entry: WatchlistEntry,
  now: Date = new Date(),
): number {
  const gateScore = Number.isFinite(entry.gateScore)
    ? Number(entry.gateScore)
    : 0;
  const leadershipPenalty = entry.leadershipBridge ? 0.5 : 0;

  let stalenessDays = 0;
  if (entry.addedAt) {
    const addedTs = Date.parse(entry.addedAt);
    if (Number.isFinite(addedTs)) {
      stalenessDays = Math.max(
        0,
        (now.getTime() - addedTs) / (24 * 60 * 60 * 1000),
      );
    }
  }

  const failCount = Number.isFinite(entry.entryFailCount)
    ? Math.max(0, Number(entry.entryFailCount))
    : 0;

  let ttlPenalty = 0;
  if (entry.expiresAt) {
    const expTs = Date.parse(entry.expiresAt);
    if (Number.isFinite(expTs)) {
      const remainingMs = expTs - now.getTime();
      if (remainingMs > 0 && remainingMs < TTL_NEAR_EXPIRY_MS) ttlPenalty = 3;
    }
  }

  return (
    gateScore - stalenessDays - failCount * 2 - ttlPenalty - leadershipPenalty
  );
}

export interface EnforceCapsResult {
  trimmed: WatchlistEntry[];
  dropped: Record<WatchlistSection, number>;
  /** soft 단계에서 능동 정리된 카운트 (hard 도달 전 trim). */
  softDropped: Record<WatchlistSection, number>;
  /** hard 단계에서 강제 정리된 카운트 (기존 동작). */
  hardDropped: Record<WatchlistSection, number>;
  /** ADR-0028 §모순9: 알림 빌더용 메타 — 정리된 entry 의 출처 분포. */
  removedBySource: Record<"AUTO" | "MANUAL" | "DART", number>;
}

/**
 * 섹션별 두 단계 cap 강제:
 *   1. soft cap: composite score 하위 (gateScore - staleness - failCount×2 - TTL 임박 - bridge)
 *      를 정리해 능동 deadzone 차단. WATCHLIST_SOFT_CAP_DISABLED=true 시 비활성.
 *   2. hard cap: soft 정리 후에도 hard 초과 시 추가 강제 정리 (기존 동작).
 *
 * 두 단계 모두 동일 composite score 사용 — soft 가 활성일 때.
 * soft 비활성 시에는 hard 단계만 *기존 단순 gateScore* 정책으로 폴백.
 */
export function enforceSectionCaps(
  list: WatchlistEntry[],
  now: Date = new Date(),
): EnforceCapsResult {
  const { hard, soft, softDisabled } = resolveSectionCaps();
  const softDropped: Record<WatchlistSection, number> = {
    SWING: 0,
    CATALYST: 0,
    MOMENTUM: 0,
  };
  const hardDropped: Record<WatchlistSection, number> = {
    SWING: 0,
    CATALYST: 0,
    MOMENTUM: 0,
  };
  const removedBySource: Record<"AUTO" | "MANUAL" | "DART", number> = {
    AUTO: 0,
    MANUAL: 0,
    DART: 0,
  };

  const bySection: Record<WatchlistSection, WatchlistEntry[]> = {
    SWING: [],
    CATALYST: [],
    MOMENTUM: [],
  };
  for (const entry of list) bySection[sectionOf(entry)].push(entry);

  // 점수 함수 — soft 비활성 시 *기존 동작* 정확 보존 (gateScore - bridge×0.5).
  const scoreFn = softDisabled
    ? (e: WatchlistEntry): number =>
        (e.gateScore ?? 0) - (e.leadershipBridge ? 0.5 : 0)
    : (e: WatchlistEntry): number => computeTrimScore(e, now);

  const trackRemoved = (entries: WatchlistEntry[]): void => {
    for (const e of entries) {
      const src = (e.addedBy ?? "AUTO") as "AUTO" | "MANUAL" | "DART";
      removedBySource[src] = (removedBySource[src] ?? 0) + 1;
    }
  };

  for (const section of ["SWING", "CATALYST", "MOMENTUM"] as const) {
    const arr = bySection[section];
    const hardMax = hard[section];
    const softMax = soft[section];

    // 1) Soft cap 능동 정리 — soft 활성 + hardMax 미초과 + softMax 초과 시
    if (!softDisabled && arr.length > softMax && arr.length <= hardMax) {
      arr.sort((a, b) => scoreFn(b) - scoreFn(a));
      const kept = arr.slice(0, softMax);
      const removed = arr.slice(softMax);
      bySection[section] = kept;
      softDropped[section] = removed.length;
      trackRemoved(removed);
      continue;
    }

    // 2) Hard cap 강제 정리 — 기존 동작 (soft 비활성 또는 hard 초과 시)
    if (arr.length > hardMax) {
      arr.sort((a, b) => scoreFn(b) - scoreFn(a));
      const kept = arr.slice(0, hardMax);
      const removed = arr.slice(hardMax);
      bySection[section] = kept;
      hardDropped[section] = removed.length;
      trackRemoved(removed);
    }
  }

  const dropped: Record<WatchlistSection, number> = {
    SWING: softDropped.SWING + hardDropped.SWING,
    CATALYST: softDropped.CATALYST + hardDropped.CATALYST,
    MOMENTUM: softDropped.MOMENTUM + hardDropped.MOMENTUM,
  };

  return {
    trimmed: [...bySection.SWING, ...bySection.CATALYST, ...bySection.MOMENTUM],
    dropped,
    softDropped,
    hardDropped,
    removedBySource,
  };
}

export interface WatchlistEntry {
  code: string; // 종목코드 6자리
  name: string;
  entryPrice: number; // 관심 진입가
  stopLoss: number; // 절대가 손절선
  targetPrice: number; // 목표가
  addedAt: string; // ISO
  gateScore?: number; // 스크리닝 신뢰도 점수 (0~27)
  stage1Score?: number; // Gate1 diagnostics: upstream Stage1 score snapshot.
  stage2Score?: number; // Gate1 diagnostics: upstream Stage2 score snapshot.
  totalGateScore?: number; // Gate1 diagnostics: final discovery total score snapshot.
  watchlistPriorityScore?: number; // Gate1 diagnostics: watchlist priority snapshot.
  symbolFeatures?: {
    price?: number;
    ma20?: number;
    ma60?: number;
    return5d?: number;
    return20d?: number;
    volume?: number;
    avgVolume?: number;
    projectedVolume?: number;
    rsi14?: number;
    atr?: number;
    atr20avg?: number;
    kospi20dReturn?: number;
    sector?: string;
    gateScore?: number;
    stage1Score?: number;
    stage2Score?: number;
    totalGateScore?: number;
    watchlistPriorityScore?: number;
  };
  addedBy: "AUTO" | "MANUAL" | "DART"; // 자동 발굴 vs 수동 추가 vs DART 공시
  memo?: string; // 진입 근거 ("외국인 5일 연속 순매수, 52주 신고가 돌파")
  sector?: string; // 섹터 정보 (섹터별 성과 분석용)
  rrr?: number; // Risk-Reward Ratio (목표가-진입가) / (진입가-손절가)
  conditionKeys?: string[]; // 진입 당시 통과한 Gate 조건 키 목록
  /** Gate evaluation snapshot. Undefined means legacy watchlist data and is counted as gate1Unknown. */
  gateEvaluation?: GateEvaluationSnapshot & {
    rawScore?: number;
    availableMaxScore?: number;
    normalizedGateScore?: number;
    conditionKeys?: string[];
    outputs?: unknown;
  };
  /** Gate raw score snapshot. Diagnostic only. */
  gateRawScore?: number;
  /** Gate available max score snapshot. Diagnostic only. */
  availableMaxScore?: number;
  /** Gate normalized score snapshot. Diagnostic only; never replaces live decisions. */
  normalizedGateScore?: number;
  /** Gate output trace. Diagnostic only. */
  conditionResultsTrace?: unknown;
  profileType?: "A" | "B" | "C" | "D"; // 종목 프로파일 (A=대형주도 B=중형성장 C=소형모멘텀 D=촉매)
  entryRegime?: string; // 진입 시 레짐 (AI 파이프라인 메타)
  expiresAt?: string; // 자동 만료 시각 ISO — 섹션별 차등 (SWING 7일 / CATALYST 3일 / MOMENTUM 2일)
  entryFailCount?: number; // 진입 시도 실패 횟수 (임계값 초과 시 자동 제거)
  isFocus?: boolean; // Focus Watchlist 포함 여부 (SWING 섹션 = true)
  // Regret Asymmetry Filter
  cooldownUntil?: string; // 쿨다운 종료 시각 ISO — 직전 5일 +15% 초과 급등 시 설정
  recentHigh?: number; // 쿨다운 진입 시점의 현재가 — 되돌림(-5~-8%) 판단 기준
  // 3-섹션 구조 — Track A/B 대체
  section?: WatchlistSection; // SWING=매수대상 / CATALYST=촉매단기 / MOMENTUM=관찰전용
  /** @deprecated section 필드로 대체. 하위 호환용. */
  track?: "A" | "B";
  /**
   * Phase 4-④: LeadershipBridge 로 자동 편입된 다이내믹 MOMENTUM 종목 표시.
   * 기본 MOMENTUM(base layer) 과 구분해 4h TTL 로 자동 만료시킨다.
   */
  leadershipBridge?: boolean;
  /**
   * ADR-0004 / PreMarket: 마지막 preMarketOrderPrep 루프에서 이 종목이 스킵된 사유.
   * 값 예: 'SKIP_NO_DATA' | 'SKIP_STALE' | 'SKIP_DATA_ERROR' | 'GATE_SKIP' | 'GUARD_*'
   * 장전 Telegram 브리핑·대시보드에서 "왜 주문 안 들어갔는가" 단일 원천.
   */
  lastSkipReason?: string;
  /** lastSkipReason 이 기록된 시각 (ISO). */
  lastSkipAt?: string;
  /**
   * ADR-0113: Corporate Action 감지로 entryPrice 가 자동 재설정된 종목 마커.
   * applyEntryPriceDrift 가 drift > 150% 감지 시 currentPrice 로 entryPrice 갱신.
   * 후속 PR 에서 24h 신호 스캔 격리 입력으로 활용.
   *
   * **ADR-0115 deprecated**: entryPrice 자동 재설정 정책 폐기됨. 본 마커는 ADR-0113
   * 레거시 동작 (ENV ENTRY_PRICE_AUTO_CORRECT_DISABLED=false 명시 시) 에만 부착.
   */
  corporateActionAdjusted?: boolean;
  /** corporateActionAdjusted 갱신 시각 (ISO). */
  corporateActionAdjustedAt?: string;
  /**
   * ADR-0116: 진입 시점 RAW 가격 (불변 원장).
   * 분할/병합 후에도 *절대* 수정 금지. entryPrice 와 별도 보강 layer.
   * 신규 진입 (autoPopulateWatchlist) 시 entryPrice 와 동일 값 영속.
   * P3 Corporate Action Ledger 후속 PR 에서 adjusted = entryPriceRaw / factor 산출.
   */
  entryPriceRaw?: number;
  /**
   * ADR-0116: cumulativeAdjustmentFactor (분할/병합 누적 보정 계수, 1.0 default).
   * priceAdjustment.ts SSOT 사용.
   */
  cumulativeAdjustmentFactor?: number;
  /**
   * ADR-0117: DataQuality 격리 마커. drift sanity 위반 (DATA_HOLD) 시 true.
   * isDataQuarantined=true 인 종목은 drift 업데이트 금지 + Gate/Sizing 차단.
   */
  isDataQuarantined?: boolean;
  /**
   * ADR-0117: 격리 메타. status='OK' 가 아닐 때 호출자 거래 차단 의무
   * (shouldBlockTradingByDataQuality SSOT 사용). 본 PR 단계에서는 호출자가 영속만,
   * 후속 PR 에서 진단 UI / 텔레그램 리포트에 노출.
   */
  dataQuality?: import("../types/dataQuality.js").DataQualityInfo;
  /**
   * ADR-0411 — Yahoo 시계열 신뢰성 손상 (`KIS_PRIMARY_YAHOO_STALE_DETECTED`) 마커.
   * 사용자 micro-correction: WATCHLIST_HOLD 정책 (STRONG → BUY 강등 대신 신규 진입 자동 보류).
   * 이유: 14 시계열 evaluator 가 PROVIDER_DEGRADED 강등되면 score=0 → 잔여 점수 (per/supply_confluence/
   * earnings_quality) max 합 ~3.0 이라 R3_EARLY NORMAL 임계 (4점) 미달 → 자연 진입 차단.
   * 본 마커는 운영자 진단·텔레그램 라벨링용 (TECHNICAL_PROVIDER_DEGRADED).
   */
  technicalProviderDegraded?: boolean;
  /** technicalProviderDegraded 마킹 시각 ISO. */
  technicalProviderDegradedAt?: string;
  /**
   * ADR-0449 — Pre-Breakout WAIT 누적 카운트 (옵셔널 후방호환).
   * `entryFailCount` 와 분리 — failCount 는 진짜 실패 (CRITICAL), waitCount 는 진입가 미도달
   * 정상 대기 (NON_CRITICAL, ADR-0115 보호). 누적 ≥ 3 시 WAIT_COOLDOWN 격상.
   */
  waitCount?: number;
  /** ADR-0449 — Gate 재검증 탈락 누적 카운트. WAIT_GATE_RECHECK_FAILED 분기에서만 증가. */
  recheckFailCount?: number;
  /** ADR-0449 — 마지막 WAIT 시각 (ISO) — cooldown 만료 판정 입력. */
  lastWaitAt?: string;
  /**
   * Gate 1/2/3 per-layer diagnostic summary (diagnostic only; never used for live execution decisions).
   * Written by kisIntradayCorrection after evaluateServerGate(); propagated through
   * createBuyTask → shadowGateAuditStore for audit purposes.
   */
  gateLayerSummary?: import('../quantFilter.js').GateLayerSummary;
}

/**
 * ETF/ETN/ELW/SPAC/리츠/우선주(특수종목) 제외 — watchlist 단일 funnel.
 *
 * 정책 (false-exclude 가 false-include 보다 위험 — 보통주 오제외 0 이 최우선):
 *   1. KRX master 가 있으면 권위 — `getStockByCode` → `isTradableKrxEquity`.
 *      master 에 있고 tradable 이면 KEEP, tradable=false(특수종목)면 EXCLUDE.
 *   2. master miss(cold-start) — name-pattern fallback (`isSpecialSecurityName`,
 *      krxStockMasterRepo SSOT 재사용). 패턴 일치 시에만 EXCLUDE.
 *   3. 그 외(master miss + name 보통주) — 안전 기본값 KEEP.
 *
 * 패턴 정의는 krxStockMasterRepo SSOT 한 곳뿐 — watchlistRepo 는 복붙 0 (drift 방지).
 */
export function isSpecialSecurityWatchlistEntry(entry: {
  code?: string;
  name?: string;
}): boolean {
  const code = typeof entry.code === "string" ? entry.code : "";
  const master = code ? getStockByCode(code) : null;
  if (master) {
    // master 권위 — tradable 이면 보통주(KEEP), 아니면 특수종목(EXCLUDE).
    return !isTradableKrxEquity(master);
  }
  // master miss / cold-start — 종목명 패턴 fallback. 미일치 시 KEEP(보통주 오제외 금지).
  return isSpecialSecurityName(typeof entry.name === "string" ? entry.name : "");
}

/**
 * 특수종목 제외 활성 여부 — default ON (사용자 요청: 매매 후보·watchlist 에서 제외).
 * `WATCHLIST_EXCLUDE_SPECIAL_SECURITIES=false` 1줄로 즉시 기존 동작(미제외) 롤백.
 * 스크리너 유니버스는 이미 무조건 제외(isTradableKrxEquity) 이므로 본 default 와 정합.
 */
export function isSpecialSecurityExclusionEnabled(): boolean {
  return process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES !== "false";
}

/** 특수종목 entry 를 watchlist 에서 제거 (플래그 비활성 시 원본 그대로 반환). */
function filterSpecialSecurities(list: WatchlistEntry[]): WatchlistEntry[] {
  if (!isSpecialSecurityExclusionEnabled()) return list;
  const kept: WatchlistEntry[] = [];
  let dropped = 0;
  for (const entry of list) {
    if (isSpecialSecurityWatchlistEntry(entry)) {
      dropped++;
      console.warn(
        `[Watchlist/SpecialSecurity] ETF/특수종목 자동 제외 — code="${entry.code}" name="${entry.name ?? "N/A"}"`,
      );
      continue;
    }
    kept.push(entry);
  }
  if (dropped > 0) {
    console.log(
      `[WATCHLIST_SPECIAL_SECURITY_EXCLUDED] dropped=${dropped} kept=${kept.length} ` +
        `executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE ` +
        `tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false`,
    );
  }
  return kept;
}

export function loadWatchlist(): WatchlistEntry[] {
  ensureDataDir();
  if (!fs.existsSync(WATCHLIST_FILE)) return [];
  try {
    const list = JSON.parse(
      fs.readFileSync(WATCHLIST_FILE, "utf-8"),
    ) as WatchlistEntry[];
    // 단일 funnel — 모든 소비처(매매 후보 + 표시 + auto-fill diff)가 특수종목 비노출.
    // 보유 포지션 청산은 shadowTradeRepo/exitEngine 경로라 본 필터와 무관(매수만 차단).
    return filterSpecialSecurities(Array.isArray(list) ? list : []);
  } catch {
    return [];
  }
}

/**
 * ADR-0028 §모순9: Watchlist Auto-Trim 알림 빌더 — 능동 정리 결과를 출처 분포 +
 * 다음 액션 안내와 함께 표기. 기존 단순 "N개 드롭" 메시지 → soft/hard 단계 + 출처별
 * 분포 + composite score 정책 명시로 운영자가 *왜 정리됐는지* 즉시 인지.
 */
export function buildWatchlistAutoTrimAlert(input: {
  result: EnforceCapsResult;
  hard: Record<WatchlistSection, number>;
  soft: Record<WatchlistSection, number>;
  softDisabled: boolean;
}): string {
  const { result, hard, soft, softDisabled } = input;
  const totalSoft =
    result.softDropped.SWING +
    result.softDropped.CATALYST +
    result.softDropped.MOMENTUM;
  const totalHard =
    result.hardDropped.SWING +
    result.hardDropped.CATALYST +
    result.hardDropped.MOMENTUM;
  const total = totalSoft + totalHard;

  const lines: string[] = [
    `✂️ <b>[Watchlist Auto-Trim]</b>`,
    `섹션 상한 자동 정리 — 총 ${total}개 (soft ${totalSoft} / hard ${totalHard})`,
  ];

  for (const sec of ["SWING", "CATALYST", "MOMENTUM"] as const) {
    const sd = result.softDropped[sec];
    const hd = result.hardDropped[sec];
    if (sd === 0 && hd === 0) continue;
    const parts: string[] = [];
    if (sd > 0) parts.push(`soft -${sd}/${soft[sec]}`);
    if (hd > 0) parts.push(`hard -${hd}/${hard[sec]}`);
    lines.push(`  ${sec}: ${parts.join(", ")}`);
  }

  // 출처 분포 — 어느 출처(AUTO/MANUAL/DART) 가 정리됐는지
  const sources = (["AUTO", "MANUAL", "DART"] as const)
    .filter((s) => result.removedBySource[s] > 0)
    .map((s) => `${s} ${result.removedBySource[s]}`)
    .join(" · ");
  if (sources) lines.push(`출처 분포: ${sources}`);

  // 정책 안내 — 운영자가 "왜 이게 빠졌나" 즉시 인지
  lines.push(
    softDisabled
      ? `기준: gateScore 상위 유지, LeadershipBridge 우선 드롭 (soft cap 비활성)`
      : `기준: composite score = gateScore - staleness/일 - failCount×2 - TTL 임박 - bridge`,
  );

  return lines.join("\n");
}

// Patch-WATCHLIST-SATURATION-COOLDOWN-001 — `buildWatchlistOverflowAlert` 폐기.
// severity 분류(ADVISORY/WARNING/CRITICAL) + cooldown 상태머신 + 메시지 빌더는
// `./watchlistSaturationPolicy.ts` SSOT 로 이관 — 반복 발송 억제 + "포화" 표현 분리.

export function buildWatchlistAutoManagementSummaryMessage(input: {
  result: EnforceCapsResult;
  hard: Record<WatchlistSection, number>;
  soft: Record<WatchlistSection, number>;
  softDisabled: boolean;
}): string {
  const { result, hard, soft, softDisabled } = input;
  const totalSoft =
    result.softDropped.SWING +
    result.softDropped.CATALYST +
    result.softDropped.MOMENTUM;
  const totalHard =
    result.hardDropped.SWING +
    result.hardDropped.CATALYST +
    result.hardDropped.MOMENTUM;
  const total = totalSoft + totalHard;
  const lines: string[] = [
    `\uD83D\uDCCB <b>[Watchlist \uC790\uB3D9 \uAD00\uB9AC \uC644\uB8CC]</b>`,
    `\uC815\uB9AC: ${total}\uAC1C (soft ${totalSoft} / hard ${totalHard})`,
  ];

  for (const sec of ["SWING", "CATALYST", "MOMENTUM"] as const) {
    const sd = result.softDropped[sec];
    const hd = result.hardDropped[sec];
    if (sd === 0 && hd === 0) continue;
    const parts: string[] = [];
    if (sd > 0) parts.push(`soft -${sd}/${soft[sec]}`);
    if (hd > 0) parts.push(`hard -${hd}/${hard[sec]}`);
    lines.push(`${sec}: \uC815\uB9AC ${sd + hd}\uAC1C (${parts.join(", ")})`);
  }

  lines.push(
    `\uAE30\uC900: \uAE30\uC874 cleanup candidate / stale / failCount / \uC870\uAC74\uBBF8\uB2EC \uBC18\uBCF5`,
    softDisabled
      ? `soft cap \uBE44\uD65C\uC131: hard cap \uBCF4\uD638\uB9CC \uC801\uC6A9`
      : `soft cap \uC790\uB3D9 \uAD00\uB9AC \uC801\uC6A9`,
    `\uB9E4\uB9E4 \uC601\uD5A5: \uC5C6\uC74C`,
    `\uB2E4\uC74C \uC54C\uB9BC: hard cap \uC811\uADFC \uB610\uB294 \uC815\uB9AC \uC2E4\uD328 \uC2DC`,
    `executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE`,
    `tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false`,
    `notificationOnly=true watchlistDisplayOnly=true`,
  );
  return lines.join("\n");
}

function countWatchlistSections(list: readonly WatchlistEntry[]): Record<WatchlistSection, number> {
  const counts: Record<WatchlistSection, number> = { SWING: 0, CATALYST: 0, MOMENTUM: 0 };
  for (const entry of list) counts[sectionOf(entry)] += 1;
  return counts;
}

function formatWatchlistAutoCleanupSummaryLog(input: {
  section: WatchlistSection;
  beforeCount: number;
  afterCount: number;
  trimmedCount: number;
  hardCap: number;
  telegramEligible: boolean;
}): string {
  return (
    `[WATCHLIST_AUTO_CLEANUP_SUMMARY] section=${input.section} ` +
    `beforeCount=${input.beforeCount} afterCount=${input.afterCount} ` +
    `trimmedCount=${input.trimmedCount} skippedCount=0 ` +
    `cleanupSucceeded=${input.trimmedCount > 0} telegramEligible=${input.telegramEligible} ` +
    `remainingSlots=${Math.max(0, input.hardCap - input.afterCount)} ` +
    `executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE ` +
    `tradingLogicChanged=false gateLogicChanged=false orderLogicChanged=false ` +
    `notificationOnly=true watchlistDisplayOnly=true`
  );
}

export function saveWatchlist(list: WatchlistEntry[]): void {
  ensureDataDir();

  // ADR-0184 (PR-B12-A) — invalid KRX code filter (site 2 watchlist sanity).
  // `0070X0` 같은 잘못된 code 가 watchlist 에 영원히 박제되던 결함 영구 차단.
  // default ON. ENV `EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED=true` 시 legacy 동작.
  // ADR-0440 — `normalizeKrxCode` SSOT (`server/utils/symbolNormalizer`) 직접 import,
  // deprecated wrapper 경유 폐기. `.valid` 명시로 NormalizedKrxSymbol 격상 반영.
  const filtered: WatchlistEntry[] = [];
  let droppedInvalidCodes = 0;
  if (isEmergencyWatchlistCodeGuardEnabled()) {
    for (const entry of list) {
      if (normalizeKrxCode(entry.code).valid) {
        filtered.push(entry);
      } else {
        droppedInvalidCodes++;
        console.warn(
          `[Watchlist/CodeGuard] invalid KRX code 자동 필터링 — code="${entry.code}" name="${entry.name ?? "N/A"}" (ADR-0184)`,
        );
      }
    }
  } else {
    filtered.push(...list);
  }
  list = filtered;

  // ETF/특수종목 제외 (default ON, WATCHLIST_EXCLUDE_SPECIAL_SECURITIES=false 롤백).
  // saveWatchlist 단계에서도 차단 — auto-fill(autoPopulateWatchlist)·DART poller·수동 add 등
  // 모든 영속 경로가 특수종목을 박제하지 못하게 하고, 기존 특수종목 entry 도 다음 save 시 정리.
  list = filterSpecialSecurities(list);

  // PR-3 #8 + ADR-0028 §모순9: 섹션별 soft/hard 두 단계 cap 강제.
  // soft cap 도달 시 composite score 하위를 능동 정리해 deadzone 차단.
  const capEvaluationNow = new Date();
  const beforeSectionCounts = countWatchlistSections(list);
  const result = enforceSectionCaps(list, capEvaluationNow);
  const { trimmed, dropped } = result;
  const totalDropped = dropped.SWING + dropped.CATALYST + dropped.MOMENTUM;

  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(trimmed, null, 2));
  const afterSectionCounts = countWatchlistSections(trimmed);

  const momentumCount = trimmed.filter(
    (entry) =>
      entry.section === "MOMENTUM" || (!entry.section && entry.track === "A"),
  ).length;

  const { hard, soft, softDisabled } = resolveSectionCaps();

  // ADR-0108 (사용자 요청 4/29 "노이즈 너무 심함"):
  //   - Auto-Trim cooldown 15분 → 8시간 (1일 1~2회 발송, 운영자 인지 부담 ↓)
  //   - 발송 임계 강화: totalDropped >= 3 (단순 1~2개 trim 은 무음)
  //   - 포화 cooldown 30분 → 12시간 + soft cap 90% 임박 시에만 발송 (단순 alert 임계 통과 발송 차단)
  //   - ENV 우회: WATCHLIST_TRIM_ALERT_DISABLED=true / WATCHLIST_OVERFLOW_ALERT_DISABLED=true
  const trimAlertEnabled = process.env.WATCHLIST_TRIM_ALERT_DISABLED !== "true";
  for (const section of ["SWING", "CATALYST", "MOMENTUM"] as const) {
    const afterCount = afterSectionCounts[section];
    const trimmedCount = dropped[section];
    const telegramEligible =
      trimmedCount >= 3 ||
      afterCount >= hard[section] ||
      hard[section] - afterCount <= 3;
    console.log(formatWatchlistAutoCleanupSummaryLog({
      section,
      beforeCount: beforeSectionCounts[section],
      afterCount,
      trimmedCount,
      hardCap: hard[section],
      telegramEligible,
    }));
  }
  if (trimAlertEnabled && totalDropped >= 3) {
    void sendTelegramAlert(
      buildWatchlistAutoManagementSummaryMessage({ result, hard, soft, softDisabled }),
      {
        priority: "NORMAL",
        dedupeKey: "watchlist-autotrim",
        cooldownMs: 8 * 60 * 60 * 1000, // 8시간
      },
    ).catch(console.error);
  }

  // Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM watchlist 포화 알림 반복 발송 억제.
  // severity 분류(ADVISORY/WARNING/CRITICAL) + runtime cooldown 상태머신은
  // watchlistSaturationPolicy SSOT 가 담당. count < alertCap 이면 classification=null.
  // 신규 KIS 호출 0건 — 출처 분포는 in-memory `trimmed` 에서만 집계.
  const momentumSourceDist: Record<"AUTO" | "MANUAL" | "DART", number> = {
    AUTO: 0,
    MANUAL: 0,
    DART: 0,
  };
  for (const entry of trimmed) {
    const isMomentum =
      entry.section === "MOMENTUM" || (!entry.section && entry.track === "A");
    if (!isMomentum) continue;
    const src = (entry.addedBy ?? "AUTO") as "AUTO" | "MANUAL" | "DART";
    momentumSourceDist[src] = (momentumSourceDist[src] ?? 0) + 1;
  }
  const { classification: saturation, decision: saturationDecision } =
    evaluateWatchlistSaturationAlert({
      section: "MOMENTUM",
      count: momentumCount,
      alertCap: MOMENTUM_ALERT_THRESHOLD,
      softCap: soft.MOMENTUM,
      hardCap: hard.MOMENTUM,
      autoCount: momentumSourceDist.AUTO,
      manualCount: momentumSourceDist.MANUAL,
      dartCount: momentumSourceDist.DART,
    }, capEvaluationNow);
  if (saturation) {
    console.log(formatWatchlistSaturationStatusLog(saturation));
    if (
      saturationDecision.shouldEmit &&
      saturationDecision.emitReason &&
      shouldSendWatchlistSaturationTelegram(saturation)
    ) {
      console.log(
        formatWatchlistSaturationSentLog(saturation, saturationDecision.emitReason),
      );
      void sendTelegramAlert(buildWatchlistSaturationMessage(saturation), {
        priority: saturation.severity === "CRITICAL" ? "HIGH" : "NORMAL",
        dedupeKey: buildWatchlistSaturationDedupeKey(saturation, capEvaluationNow),
        cooldownMs: resolveWatchlistSaturationTelegramCooldownMs(saturation),
        category: "watchlist_saturation",
        notificationSeverity: "ACTION_REQUIRED",
        notificationEventType: "WATCHLIST_SOFT_CAP",
        executionImpact: "NONE",
        marketSignal: false,
        providerIssue: false,
        kisImpact: "NONE",
        actionRequired: true,
        tradeEvent: false,
        noiseEvent: {
          eventType: "WATCHLIST_SATURATION",
          channel: "CH4_JOURNAL",
          status: saturation.capStatus,
          session: saturation.section,
          dedupeHint: saturation.countBucket,
          executionImpact: "NONE",
        },
      }).catch(console.error);
      recordWatchlistSaturationAlertSent(saturation, capEvaluationNow);
    } else {
      // Telegram 발송 억제 — Railway 에는 compact 로그만.
      console.log(
        formatWatchlistSaturationSuppressedLog(saturation, saturationDecision),
      );
    }
  }
}

// ─── ADR-0128: DataQuality 격리 마커 helper (verification batch / incremental 사용) ───
/**
 * 워치리스트 entry 에 DataQuality 격리 마커 부착.
 * `safePctChangeStrict` 위반 시 verification batch / incremental 가 호출.
 *
 * @returns true = 마커 부착됨, false = entry 없음 (no-op)
 */
export function markDataQuarantine(
  stockCode: string,
  dataQuality: import("../types/dataQuality.js").DataQualityInfo,
): boolean {
  const list = loadWatchlist();
  const idx = list.findIndex((e) => e.code === stockCode);
  if (idx < 0) return false;
  const prev = list[idx]!;
  list[idx] = { ...prev, isDataQuarantined: true, dataQuality };
  // 직접 영속 — saveWatchlist 의 cap trim 우회 (격리 갱신은 단일 entry mutate).
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2));
  return true;
}

/**
 * 워치리스트 entry 의 DataQuality 격리 마커 해제 (verification batch OK 시).
 *
 * @returns true = 마커 해제됨, false = entry 없음 또는 이미 격리 안 됨
 */
export function clearDataQuarantineMark(stockCode: string): boolean {
  const list = loadWatchlist();
  const idx = list.findIndex((e) => e.code === stockCode);
  if (idx < 0) return false;
  const prev = list[idx]!;
  if (!prev.isDataQuarantined && !prev.dataQuality) return false;
  const next: WatchlistEntry = { ...prev };
  delete next.isDataQuarantined;
  delete next.dataQuality;
  list[idx] = next;
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2));
  return true;
}
