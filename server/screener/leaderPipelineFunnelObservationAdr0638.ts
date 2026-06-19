// @responsibility ADR-0638 주도주 파이프라인 funnel 관측 — dynamic-universe 캐시 신선도 + Stage1 leader 탈락 사유(OVEREXTENDED/OVERHEAT/Other) per-scan aggregate. 순수 fetch 0, default OFF, ledger.

import fs from 'fs';
import type { DynamicStock } from './dynamicUniverseExpander.js';
import { LEADER_REFRESH_TTL_DAYS, purgeExpired, loadDynamicUniverse } from './dynamicUniverseExpander.js';
import {
  isLeaderSource,
  todayKst,
  type LeaderSourceDistribution,
} from './leaderUniverseInjectionAdr0617.js';
import { LEADER_PIPELINE_FUNNEL_LEDGER_FILE, ensureDataDir } from '../persistence/paths.js';

// ── ENV SSOT (ADR-0157 정확비교 default OFF) ───────────────────────────────────

/**
 * 주도주 파이프라인 funnel 관측 활성화 SSOT. `LEADER_PIPELINE_FUNNEL_OBS_ENABLED === 'true'`.
 * default OFF — OFF 시 universeScanner Stage1 루프 카운터·분기·ledger write 0(byte-identical).
 *   ENV 1줄 즉시 롤백. 두 번째 flag enum/중복 정의 금지 — 본 함수가 단일 SSOT.
 */
export function isLeaderPipelineFunnelObservationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.LEADER_PIPELINE_FUNNEL_OBS_ENABLED === 'true';
}

// ── (1) 캐시 신선도 ────────────────────────────────────────────────
/**
 * dynamic-universe.json leader-source entry 의 age/stale 관측.
 *  나이 기준 = addedAt(ISO) 기준 경과 시간. stale = LEADER_REFRESH_TTL_DAYS(3거래일/달력일) 초과
 *  (dynamicUniverseExpander.LEADER_REFRESH_TTL_DAYS 재사용 — 두 번째 TTL 상수 신설 금지).
 *
 * 불변식 #6: cacheStale/cacheEmpty 는 데이터 신선도 결함일 뿐 bearish marketSignal 아님.
 *   본 관측은 (b) 캐시 빔/stale 가설 판별 데이터일 뿐, 약세 신호로 변환하면 안 된다.
 */
export interface LeaderCacheFreshnessObservation {
  totalEntryCount: number;             // dynamic-universe.json 총 entry(purgeExpired 후)
  leaderEntryCount: number;            // source ∈ LEADER_SOURCES 인 entry 수
  leaderEntryDist: LeaderSourceDistribution; // FOREIGN/INST/MARKET_CAP 분포
  oldestLeaderAddedAt: string | null;  // ISO. leaderEntryCount===0 → null
  newestLeaderAddedAt: string | null;  // ISO. 〃
  oldestLeaderAgeHours: number | null; // now − oldestLeaderAddedAt (시간). null 시 산출 불가
  staleLeaderCount: number;            // age > TTL(3거래일/달력일) 인 leader entry 수
  cacheEmpty: boolean;                 // leaderEntryCount === 0
  cacheStale: boolean;                 // leaderEntryCount>0 && staleLeaderCount === leaderEntryCount
}

// ── (2) leader funnel (Stage1 진입~탈락 교차) ──────────────────────
/** Stage1 탈락 사유별 leader 카운트. evaluateStage1FilterTracked().reason 교집합. */
export interface LeaderStage1CutBreakdown {
  byOverextended: number;  // reason === 'OVEREXTENDED'
  byOverheat: number;      // reason === 'OVERHEAT'
  byOther: number;         // 그 외 모든 reason(MIN_PRICE/HIGH_RISK/LOW_VOLUME/... 합산)
}

export interface LeaderPipelineFunnelObservation {
  scanDateKey: string;     // 'YYYY-MM-DD' KST (todayKst 재사용 — leaderUniverseInjectionAdr0617.todayKst)
  enabled: boolean;        // flag 상태(관측 시점)

  cacheFreshness: LeaderCacheFreshnessObservation;

  /** 캐시상 leader source 보유 코드 수 = leaderSourceMap 중 isLeaderSource. */
  cacheLeaderCodeCount: number;
  /** 그중 실제 스캔 유니버스(scanUniverse)에 진입해 quote 평가까지 도달한 leader 코드 수
   *  (seenCodes 중복·quote null 제외 — Stage1 루프 진입분). */
  leaderCodesEnteredStage1: number;
  /** Stage1 통과(candidates 진입)한 leader 코드 수. */
  leaderCodesPassedStage1: number;
  /** Stage1 탈락 leader 사유별 분해(= enteredStage1 − passedStage1 의 reason 귀속). */
  leaderStage1Cut: LeaderStage1CutBreakdown;
  /** 최종 후보 풀에 남은 leader 수 — ADR-0617 observation.leadersInPoolCount 재사용(중복 산출 금지).
   *  flag(0638) ON 이어도 0617 보존 flag OFF 면 top-N 컷 후 값. 두 관측 정합 cross-check 용. */
  leaderPreservedIntoPool: number;

  /** 결론 지향: 가장 많이 leader 를 컷한 사유. cut 합계 0 → null. */
  dominantLeaderCutReason: 'OVEREXTENDED' | 'OVERHEAT' | 'OTHER' | null;

  executionImpact: 'NONE';   // 관측 전용 — 항상 NONE(발굴/컷/정렬/score 0줄 변경)
  observationOnly: true;
}

/** ledger 1행. */
export type LeaderPipelineFunnelLedgerRow = LeaderPipelineFunnelObservation & { appendedAt: string };

export const LEADER_PIPELINE_FUNNEL_WINDOW_SCANS = 60 as const;

// ── 순수 산출 ──────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function emptySourceDist(): LeaderSourceDistribution {
  return { FOREIGN_NET_BUY: 0, INST_NET_BUY: 0, MARKET_CAP: 0 };
}

function tallyLeaderDist(stocks: readonly DynamicStock[]): LeaderSourceDistribution {
  const dist = emptySourceDist();
  for (const s of stocks) {
    if (s.source === 'FOREIGN_NET_BUY') dist.FOREIGN_NET_BUY += 1;
    else if (s.source === 'INST_NET_BUY') dist.INST_NET_BUY += 1;
    else if (s.source === 'MARKET_CAP') dist.MARKET_CAP += 1;
  }
  return dist;
}

/** addedAt(ISO) 파싱 — 부재/손상 시 NaN. */
function parseAddedAt(addedAt: string | undefined): number {
  if (!addedAt) return NaN;
  const t = Date.parse(addedAt);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * 캐시 신선도 산출 — purgeExpired(loadDynamicUniverse()) 입력. fetch 0.
 * @param dynamicStocks 만료 정리(purgeExpired) 후의 동적 유니버스 entry.
 * @param now 주입(결정성). 미지정 시 new Date().
 * @internal engine-dev: cacheEmpty/cacheStale 분기·age 산출 테스트 고정.
 */
export function computeLeaderCacheFreshness(
  dynamicStocks: readonly DynamicStock[],
  now: Date = new Date(),
): LeaderCacheFreshnessObservation {
  const nowMs = now.getTime();
  const ttlMs = LEADER_REFRESH_TTL_DAYS * MS_PER_DAY;
  const leaders = dynamicStocks.filter((s) => isLeaderSource(s.source));

  let oldestMs = NaN;
  let newestMs = NaN;
  let oldestIso: string | null = null;
  let newestIso: string | null = null;
  let staleLeaderCount = 0;

  for (const s of leaders) {
    const addedMs = parseAddedAt(s.addedAt);
    if (Number.isFinite(addedMs)) {
      if (!Number.isFinite(oldestMs) || addedMs < oldestMs) {
        oldestMs = addedMs;
        oldestIso = s.addedAt;
      }
      if (!Number.isFinite(newestMs) || addedMs > newestMs) {
        newestMs = addedMs;
        newestIso = s.addedAt;
      }
      if (nowMs - addedMs > ttlMs) staleLeaderCount += 1;
    } else {
      // addedAt 파싱 불가 entry 는 신선도 미상 → 보수적으로 stale 로 귀속(갱신 필요 신호).
      staleLeaderCount += 1;
    }
  }

  const leaderEntryCount = leaders.length;
  const oldestLeaderAgeHours = Number.isFinite(oldestMs)
    ? Math.max(0, (nowMs - oldestMs) / MS_PER_HOUR)
    : null;

  return {
    totalEntryCount: dynamicStocks.length,
    leaderEntryCount,
    leaderEntryDist: tallyLeaderDist(leaders),
    oldestLeaderAddedAt: oldestIso,
    newestLeaderAddedAt: newestIso,
    oldestLeaderAgeHours,
    staleLeaderCount,
    cacheEmpty: leaderEntryCount === 0,
    cacheStale: leaderEntryCount > 0 && staleLeaderCount === leaderEntryCount,
  };
}

/**
 * funnel 산출 — Stage1 루프가 누적한 카운터 + cacheFreshness + 0617 leadersInPoolCount 조립. fetch 0.
 * @internal engine-dev: funnel 합 정합(entered ≥ passed + cut)·dominantLeaderCutReason 테스트 고정.
 */
export function computeLeaderPipelineFunnelObservation(input: {
  cacheFreshness: LeaderCacheFreshnessObservation;
  cacheLeaderCodeCount: number;
  leaderCodesEnteredStage1: number;
  leaderCodesPassedStage1: number;
  leaderStage1Cut: LeaderStage1CutBreakdown;
  leaderPreservedIntoPool: number;
  enabled?: boolean;
  now?: Date;
}): LeaderPipelineFunnelObservation {
  const now = input.now ?? new Date();
  const cut = input.leaderStage1Cut;
  let dominantLeaderCutReason: LeaderPipelineFunnelObservation['dominantLeaderCutReason'] = null;
  const cutTotal = cut.byOverextended + cut.byOverheat + cut.byOther;
  if (cutTotal > 0) {
    if (cut.byOverextended >= cut.byOverheat && cut.byOverextended >= cut.byOther) {
      dominantLeaderCutReason = 'OVEREXTENDED';
    } else if (cut.byOverheat >= cut.byOther) {
      dominantLeaderCutReason = 'OVERHEAT';
    } else {
      dominantLeaderCutReason = 'OTHER';
    }
  }

  return {
    scanDateKey: todayKst(now),
    enabled: input.enabled ?? isLeaderPipelineFunnelObservationEnabled(),
    cacheFreshness: input.cacheFreshness,
    cacheLeaderCodeCount: input.cacheLeaderCodeCount,
    leaderCodesEnteredStage1: input.leaderCodesEnteredStage1,
    leaderCodesPassedStage1: input.leaderCodesPassedStage1,
    leaderStage1Cut: { ...cut },
    leaderPreservedIntoPool: input.leaderPreservedIntoPool,
    dominantLeaderCutReason,
    executionImpact: 'NONE',
    observationOnly: true,
  };
}

// ── 영속 I/O (ADR-0614/0616/0617 패턴: atomic write + FIFO 캡 + 손상 JSON fallback) ────

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidLedgerRow(row: unknown): row is LeaderPipelineFunnelLedgerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isValidDateKey(r.scanDateKey)
    && typeof r.cacheLeaderCodeCount === 'number'
    && typeof r.appendedAt === 'string';
}

function loadAll(filePath = LEADER_PIPELINE_FUNNEL_LEDGER_FILE): LeaderPipelineFunnelLedgerRow[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    const rows = parsed.filter(isValidLedgerRow);
    rows.sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
    return rows;
  } catch {
    // 손상 JSON → 빈 배열 fallback (ADR-0614 패턴, 시스템 무중단).
    return [];
  }
}

function saveAll(
  rows: LeaderPipelineFunnelLedgerRow[],
  filePath = LEADER_PIPELINE_FUNNEL_LEDGER_FILE,
): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* SDS-ignore: tmp cleanup best-effort, idempotent */ }
  }
}

/**
 * ledger append — atomic tmp→rename + scanDateKey upsert + FIFO(60) + 손상 JSON fallback.
 * 신규 fetch 0(입력은 이미 산출된 observation). 호출자(universeScanner)가 flag·try/catch 격리.
 * @internal engine-dev: atomic rename·손상 fallback·FIFO 캡·scanDateKey upsert 테스트 고정.
 */
export function appendLeaderPipelineFunnelLedger(
  obs: LeaderPipelineFunnelObservation,
  now: Date = new Date(),
  filePath: string = LEADER_PIPELINE_FUNNEL_LEDGER_FILE,
): LeaderPipelineFunnelLedgerRow {
  const row: LeaderPipelineFunnelLedgerRow = { ...obs, appendedAt: now.toISOString() };
  const rows = loadAll(filePath);
  const byDate = new Map<string, LeaderPipelineFunnelLedgerRow>();
  for (const existing of rows) byDate.set(existing.scanDateKey, existing);
  byDate.set(row.scanDateKey, row);
  const merged = [...byDate.values()].sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
  const trimmed = merged.slice(Math.max(0, merged.length - LEADER_PIPELINE_FUNNEL_WINDOW_SCANS));
  saveAll(trimmed, filePath);
  return row;
}

/** ledger 전체 조회(추세 분석·진단 섹션). 손상 fallback → []. */
export function loadLeaderPipelineFunnelLedger(
  filePath: string = LEADER_PIPELINE_FUNNEL_LEDGER_FILE,
): LeaderPipelineFunnelLedgerRow[] {
  return loadAll(filePath);
}

/** ledger 최신행 1개 조회(scan_blockers 섹션 — 없으면 null). */
export function loadLatestLeaderPipelineFunnelRow(
  filePath: string = LEADER_PIPELINE_FUNNEL_LEDGER_FILE,
): LeaderPipelineFunnelLedgerRow | null {
  const rows = loadAll(filePath);
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

/** 테스트 전용 — ledger 파일 초기화. */
export function __resetLeaderPipelineFunnelLedgerForTests(
  filePath: string = LEADER_PIPELINE_FUNNEL_LEDGER_FILE,
): void {
  try { fs.unlinkSync(filePath); } catch { /* SDS-ignore: 미존재 파일 idempotent */ }
}

// ── /scan_blockers 1섹션 formatter (출력 budget ADR-0478 — 5~7줄) ──────────────

/**
 * 최신 funnel 관측 1행 → /scan_blockers 섹션 문자열(5줄). flag OFF/ledger 미존재 → null(섹션 미출력).
 * 관측 전용 표시 — cacheStale/cacheEmpty 를 약세 신호로 변환하지 않는다(불변식 #6).
 */
export function formatLeaderPipelineFunnelSection(
  row: LeaderPipelineFunnelLedgerRow | null,
  enabled: boolean = isLeaderPipelineFunnelObservationEnabled(),
): string | null {
  if (!enabled) return null;
  if (!row) return null;

  const cf = row.cacheFreshness;
  let cacheState: string;
  if (cf.cacheEmpty) {
    cacheState = 'EMPTY';
  } else if (cf.cacheStale) {
    cacheState = 'STALE';
  } else {
    const ageLabel = cf.oldestLeaderAgeHours === null
      ? '?'
      : `${Math.round(cf.oldestLeaderAgeHours)}h`;
    cacheState = `entry ${cf.leaderEntryCount} (FOREIGN ${cf.leaderEntryDist.FOREIGN_NET_BUY}/INST ${cf.leaderEntryDist.INST_NET_BUY}/CAP ${cf.leaderEntryDist.MARKET_CAP}) · oldest ${ageLabel} · stale ${cf.staleLeaderCount}`;
  }

  const cut = row.leaderStage1Cut;
  const hint = cf.cacheEmpty || cf.cacheStale
    ? '판정→(b) 캐시 빔/stale (발굴 cron 점검)'
    : row.dominantLeaderCutReason === 'OVEREXTENDED'
      ? '판정→(a) OVEREXTENDED 추격금지 설계 동작 중'
      : '판정→데이터 축적 중';

  return [
    '🦁 Leader Funnel (관측·ADR-0638)',
    `캐시: ${cacheState}`,
    `funnel: cache ${row.cacheLeaderCodeCount} → enter ${row.leaderCodesEnteredStage1} → pass ${row.leaderCodesPassedStage1} · cut OVEREXTENDED ${cut.byOverextended} / OVERHEAT ${cut.byOverheat} / other ${cut.byOther}`,
    `풀 보존 leader: ${row.leaderPreservedIntoPool} · 주컷사유: ${row.dominantLeaderCutReason ?? 'NONE'}`,
    hint,
  ].join('\n');
}
