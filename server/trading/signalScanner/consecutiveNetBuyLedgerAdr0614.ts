// @responsibility ADR-0614 외국인/기관 순매수 연속·누적 관측 ledger. c.kisFlow piggyback(신규 fetch 0), per-stock rolling window, default OFF, Gate score 미배선.

import fs from 'fs';
import {
  CONSECUTIVE_NETBUY_LEDGER_FILE,
  ensureDataDir,
} from '../../persistence/paths.js';
import { evaluateInvestorFlowSemanticAvailability } from '../../supply/investorFlowSemanticAvailability.js';

// ── 정책 상수 (ADR-0614 (a)) ───────────────────────────────────────────────────
/** 종목당 보관 거래일 row 수 (rolling FIFO). */
export const CONSECUTIVE_NETBUY_WINDOW_DAYS = 10;
/** 글로벌 종목 캡 — 초과 시 가장 오래 갱신 안 된 종목 entry 제거. */
export const CONSECUTIVE_NETBUY_MAX_CODES = 600;

// ── 타입 (ADR-0614 (a)/(b)) ────────────────────────────────────────────────────

/** 종목별 일별 관측 row — 이미 fetch 된 kisFlow 값 append only (raw payload·민감정보 0). */
export interface ConsecutiveNetBuyLedgerRow {
  dateKey: string;             // 'YYYY-MM-DD' KST 거래일 (kisFlow.tradingDate ?? todayKst)
  stockCode: string;           // 6자리 정규화
  foreignNetBuy: number;
  institutionalNetBuy: number;
  provider: string;            // 출처 보존 (c.kisFlow.source 등)
  marketCap: number | null;    // 가용 시만, 부재 시 null (결손≠0, 불변식 #6)
  fetchedAt: string;           // ISO
  semanticStatus: 'OK';        // OK 일 때만 append
  executionImpact: 'NONE';     // literal 강제
  observationOnly: true;       // literal 강제
}

/** 연속/누적 신호 — 순수 산출(provider/now/fetch 0). Gate score/주문 미배선(관측 전용). */
export interface ConsecutiveNetBuySignal {
  stockCode: string;
  windowDays: number;
  consecutiveForeignDays: number;
  consecutiveInstitutionDays: number;
  consecutiveBothDays: number;
  cumulativeForeignNetBuy: number;
  cumulativeInstitutionalNetBuy: number;
  cumulativeNetBuy: number;
  netBuyVsMarketCapPct: number | null;  // 단위 정합 검증 전 항상 null (가짜 비율 금지, HANDOFF (b))
  bothConsecutive: boolean;             // consecutiveBothDays >= 2
  asOfDateKey: string;
  executionImpact: 'NONE';
  observationOnly: true;
}

type ConsecutiveNetBuyLedgerShape = Record<string, ConsecutiveNetBuyLedgerRow[]>;

// ── ENV SSOT (ADR-0157 정확비교 default OFF) ───────────────────────────────────

/**
 * 관측 전용 누적 활성화 SSOT. `CONSECUTIVE_NETBUY_OBSERVATION_ENABLED === 'true'` 정확 비교.
 * default OFF — OFF 시 append 호출자가 no-op(byte-equivalent) 하도록 universeScanner 가 gate.
 */
export function isConsecutiveNetBuyObservationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CONSECUTIVE_NETBUY_OBSERVATION_ENABLED === 'true';
}

// ── 정규화/검증 ────────────────────────────────────────────────────────────────

function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidRow(row: unknown): row is ConsecutiveNetBuyLedgerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isValidDateKey(r.dateKey)
    && typeof r.stockCode === 'string'
    && isFiniteNumber(r.foreignNetBuy)
    && isFiniteNumber(r.institutionalNetBuy)
    && typeof r.fetchedAt === 'string';
}

export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// ── 영속 I/O (기존 investorFlowCacheRepo 패턴 차용, atomic write) ───────────────

function loadAll(filePath = CONSECUTIVE_NETBUY_LEDGER_FILE): ConsecutiveNetBuyLedgerShape {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ConsecutiveNetBuyLedgerShape = {};
    for (const [code, rows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue;
      const safe = normalizeCode(code);
      const validRows = rows
        .filter(isValidRow)
        .map((r) => ({ ...r, stockCode: normalizeCode(r.stockCode) }));
      validRows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      if (validRows.length > 0) out[safe] = validRows;
    }
    return out;
  } catch {
    // 손상 JSON → 빈 객체 fallback (기존 repo 패턴, 시스템 무중단).
    return {};
  }
}

function saveAll(ledger: ConsecutiveNetBuyLedgerShape, filePath = CONSECUTIVE_NETBUY_LEDGER_FILE): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* SDS-ignore: tmp cleanup best-effort, idempotent */ }
  }
}

/** 가장 오래 갱신 안 된 종목 (최신 row 의 fetchedAt 오름차순) 부터 글로벌 캡 초과분 제거. */
function trimGlobalCodeCap(ledger: ConsecutiveNetBuyLedgerShape): void {
  const codes = Object.keys(ledger);
  if (codes.length <= CONSECUTIVE_NETBUY_MAX_CODES) return;
  const lastFetchedAt = (code: string): string => {
    const rows = ledger[code];
    return rows.length > 0 ? rows[rows.length - 1].fetchedAt : '';
  };
  const sortedByStale = [...codes].sort((a, b) => lastFetchedAt(a).localeCompare(lastFetchedAt(b)));
  const removeCount = codes.length - CONSECUTIVE_NETBUY_MAX_CODES;
  for (const code of sortedByStale.slice(0, removeCount)) delete ledger[code];
}

// ── append (ADR-0614 (c)/(d)) ──────────────────────────────────────────────────

export interface AppendConsecutiveNetBuyInput {
  stockCode: string;
  /** 이미 스캔에서 fetch 된 투자자 흐름 — 신규 호출 0 (piggyback). */
  kisFlow: unknown;
  /** kisFlow.tradingDate ?? todayKst() (호출자 해석). */
  tradingDate: string;
  /** 출처 보존 (c.kisFlow.source 등). 부재 시 'KIS_API'. */
  provider?: string;
  /** 가용 경로 확인 전 null (가짜 값 금지). */
  marketCap?: number | null;
  now?: Date;
  filePath?: string;
}

/**
 * 관측 row append (semantic OK 일 때만, dateKey×stockCode upsert last-write-wins).
 *
 * - single 통로: `evaluateInvestorFlowSemanticAvailability(kisFlow)` 경유 — available && OK 일 때만
 *   기록. 부재/DEGRADED/FIELD_MISSING → null 반환(미기록, 결손≠신호, 불변식 #6).
 * - per-stock rolling FIFO(WINDOW_DAYS) + 글로벌 종목 캡 trim. atomic write.
 * - 신규 fetch 0 — kisFlow 는 이미 fetch 된 값. (불변식 #1 격리는 call-site try/catch 책임.)
 *
 * @returns append 된 row, 미기록 시 null.
 */
export function appendConsecutiveNetBuyObservation(
  input: AppendConsecutiveNetBuyInput,
): ConsecutiveNetBuyLedgerRow | null {
  const semantic = evaluateInvestorFlowSemanticAvailability(input.kisFlow);
  if (!semantic.available || semantic.status !== 'OK') return null;

  const flow = input.kisFlow as Record<string, unknown>;
  const foreignNetBuy = flow.foreignNetBuy;
  const institutionalNetBuy = flow.institutionalNetBuy;
  // semantic OK 가 alias 기반일 수 있으나 본 ledger 는 표준 필드만 신뢰 — 표준키 부재 시 미기록.
  if (!isFiniteNumber(foreignNetBuy) || !isFiniteNumber(institutionalNetBuy)) return null;

  const dateKey = isValidDateKey(input.tradingDate) ? input.tradingDate : todayKst(input.now);
  const safe = normalizeCode(input.stockCode);
  const provider = input.provider
    ?? (typeof flow.source === 'string' ? flow.source : 'KIS_API');

  const row: ConsecutiveNetBuyLedgerRow = {
    dateKey,
    stockCode: safe,
    foreignNetBuy,
    institutionalNetBuy,
    provider,
    marketCap: isFiniteNumber(input.marketCap) ? input.marketCap : null,
    fetchedAt: (input.now ?? new Date()).toISOString(),
    semanticStatus: 'OK',
    executionImpact: 'NONE',
    observationOnly: true,
  };

  const filePath = input.filePath ?? CONSECUTIVE_NETBUY_LEDGER_FILE;
  const ledger = loadAll(filePath);
  const rows = ledger[safe] ?? [];
  // dateKey upsert (last-write-wins) — byDate Map 패턴, 재스캔/재시작 안전.
  const byDate = new Map<string, ConsecutiveNetBuyLedgerRow>();
  for (const existing of rows) byDate.set(existing.dateKey, existing);
  byDate.set(dateKey, row);
  const merged = [...byDate.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  // per-stock rolling window FIFO trim (가장 오래된 dateKey 제거).
  ledger[safe] = merged.slice(Math.max(0, merged.length - CONSECUTIVE_NETBUY_WINDOW_DAYS));
  trimGlobalCodeCap(ledger);
  saveAll(ledger, filePath);
  return row;
}

// ── 조회 ───────────────────────────────────────────────────────────────────────

export function loadConsecutiveNetBuyWindow(
  stockCode: string,
  filePath = CONSECUTIVE_NETBUY_LEDGER_FILE,
): ConsecutiveNetBuyLedgerRow[] {
  return loadAll(filePath)[normalizeCode(stockCode)] ?? [];
}

export function countConsecutiveNetBuyCodes(filePath = CONSECUTIVE_NETBUY_LEDGER_FILE): number {
  return Object.keys(loadAll(filePath)).length;
}

// ── 순수 산출 (ADR-0614 (b)) ───────────────────────────────────────────────────

/** 최신 dateKey 부터 역순, netBuy>0 깨지는 첫 지점(===0/<0)까지 연속 카운트. append 된 인접 거래일 기준. */
function countConsecutivePositive(
  rows: readonly ConsecutiveNetBuyLedgerRow[],
  pick: (row: ConsecutiveNetBuyLedgerRow) => number,
): number {
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (pick(rows[i]) > 0) count += 1;
    else break;
  }
  return count;
}

/**
 * window(시간 오름차순 row 배열) 입력 → 연속/누적 신호 순수 산출. provider/now/fetch 0.
 *
 * - consecutiveXDays: 최신일부터 netBuy>0 연속 (append 된 인접 거래일 기준, ADR-0614 (b)).
 * - cumulative*: window 단순 합.
 * - netBuyVsMarketCapPct: **항상 null** — kisFlow netBuy(주식 수량) ↔ marketCap(금액) 단위
 *   불일치 + marketCap 미보유. 정합 검증 전 가짜 비율 산출 금지(HANDOFF (b)).
 */
export function computeConsecutiveNetBuySignal(
  stockCode: string,
  window: readonly ConsecutiveNetBuyLedgerRow[],
): ConsecutiveNetBuySignal {
  const rows = [...window].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const consecutiveForeignDays = countConsecutivePositive(rows, (r) => r.foreignNetBuy);
  const consecutiveInstitutionDays = countConsecutivePositive(rows, (r) => r.institutionalNetBuy);
  const consecutiveBothDays = countConsecutivePositive(
    rows,
    (r) => Math.min(r.foreignNetBuy, r.institutionalNetBuy),
  );
  const cumulativeForeignNetBuy = rows.reduce((sum, r) => sum + r.foreignNetBuy, 0);
  const cumulativeInstitutionalNetBuy = rows.reduce((sum, r) => sum + r.institutionalNetBuy, 0);
  const asOfDateKey = rows.length > 0 ? rows[rows.length - 1].dateKey : '';

  return {
    stockCode: normalizeCode(stockCode),
    windowDays: rows.length,
    consecutiveForeignDays,
    consecutiveInstitutionDays,
    consecutiveBothDays,
    cumulativeForeignNetBuy,
    cumulativeInstitutionalNetBuy,
    cumulativeNetBuy: cumulativeForeignNetBuy + cumulativeInstitutionalNetBuy,
    // 단위 정합(주 수량 vs 금액) 미검증 + marketCap 미보유 → 영구 null. 후속 ADR 승격 대상.
    netBuyVsMarketCapPct: null,
    bothConsecutive: consecutiveBothDays >= 2,
    asOfDateKey,
    executionImpact: 'NONE',
    observationOnly: true,
  };
}

/** 테스트 전용 — ledger 파일 초기화. */
export function __resetConsecutiveNetBuyLedgerForTests(filePath = CONSECUTIVE_NETBUY_LEDGER_FILE): void {
  try { fs.unlinkSync(filePath); } catch { /* SDS-ignore: 미존재 파일 idempotent */ }
}
