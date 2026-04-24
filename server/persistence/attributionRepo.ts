/**
 * @responsibility 27조건 귀인 레코드 저장 + 복합키(tradeId,fillId) dedup + 스키마 마이그레이션
 *
 * 클라이언트가 거래 종료(closeTrade) 시 POST /api/attribution/record 로 전송한
 * 27개 조건 점수 스냅샷과 최종 수익률을 보관한다.
 *
 * PR-19: 부분매도별 qtyRatio 가중 attribution 지원. 전량 청산 1건 = `qtyRatio=1.0`,
 * 부분매도는 `fillId` 고유성으로 복수 레코드 병존 가능.
 *
 * signalCalibrator / conditionAuditor 가 이 레코드를 읽어
 * 조건별 성과를 보완적으로 분석할 수 있다.
 *
 * 보관 한도: 최근 500건 (saveAttributionRecords 내 자동 트리밍)
 *
 * 스키마 버전:
 *   CURRENT_ATTRIBUTION_SCHEMA_VERSION 이 쓰기 시 자동 부여된다.
 *   과거 버전 레코드는 자동 migration 으로 현 스키마로 맞추거나, migration 불가 시
 *   `schemaVersion === CURRENT` 필터를 통해 집계/캘리브레이션에서 격리된다.
 */

import fs from 'fs';
import { ATTRIBUTION_FILE, SHADOW_FILE, ensureDataDir } from './paths.js';

// ── 스키마 버전 ──────────────────────────────────────────────────────────────

/**
 * 현재 귀인 레코드 스키마 버전.
 *   - v0: 과거 (schemaVersion 필드 없음, Phase 1 이전)
 *   - v1: Phase 1 — schemaVersion 도입, Gate 24 semantic separation 반영
 *   - v2: PR-19 — 부분매도별 fillId/attributionType/qtyRatio 도입
 */
export const CURRENT_ATTRIBUTION_SCHEMA_VERSION = 2 as const;

// ── 타입 ──────────────────────────────────────────────────────────────────────

/**
 * 귀인 레코드 유형.
 *   - FULL_CLOSE: 전량 청산 (기본). 기존 v1 레코드는 마이그레이션 시 이 값으로.
 *   - PARTIAL:    부분매도 중간 실현. fillId 로 유일성, qtyRatio 로 비중 가중.
 */
export type AttributionType = 'FULL_CLOSE' | 'PARTIAL';

export interface ServerAttributionRecord {
  /** 스키마 버전 — 미지정(레거시) 레코드는 v0 으로 취급된다. */
  schemaVersion?: number;
  tradeId:         string;
  /**
   * PR-19: 부분매도 fill 의 고유 ID. PARTIAL 타입에서 필수. FULL_CLOSE 는 선택.
   * appendAttributionRecord 는 (tradeId, fillId) 복합키로 dedup 한다.
   */
  fillId?:         string;
  /** PR-19: FULL_CLOSE(전량청산) vs PARTIAL(부분매도). 미지정 시 FULL_CLOSE 취급. */
  attributionType?: AttributionType;
  /**
   * PR-19: 이 레코드가 반영하는 포지션 비중 (0.0~1.0).
   *   - 전량 청산: 1.0 (기본).
   *   - 부분매도: 매도 수량 / originalQuantity.
   * computeAttributionStats 는 조건별 기여도를 이 값으로 가중한다.
   */
  qtyRatio?:       number;
  stockCode:       string;
  stockName:       string;
  /** 거래 종료 시각 — PARTIAL 의 경우 fill.confirmedAt (ISO) */
  closedAt:        string;
  returnPct:       number;
  isWin:           boolean;
  /** 진입 시점 레짐 — 클라이언트에서 전달 시 설정 (optional) */
  entryRegime?:    string;
  /** 진입 시 캡처된 27개 조건 점수 스냅샷 (conditionId → score 0~10) */
  conditionScores: Record<number, number>;
  holdingDays:     number;
  sellReason?:     string;
  /**
   * 아이디어 5 (Phase 3): EXPIRED 이후 60/90일 재평가에서 targetPrice 달성.
   * true 면 타이밍 조건(20 터틀, 21 피보나치, 22 엘리엇, 26 다이버전스)의
   * 가중치/boost 기여에 0.7× 페널티가 적용된다.
   */
  lateWin?:        boolean;
}

/** 조건별 집계 결과 (GET /api/attribution/stats 응답 형태) */
export interface AttributionConditionStat {
  conditionId:        number;
  totalTrades:        number;
  winRate:            number;  // %
  avgReturn:          number;  // %
  /** score ≥ 7인 거래의 평균 수익률 */
  avgReturnWhenHigh:  number;
  /** score < 5인 거래의 평균 수익률 */
  avgReturnWhenLow:   number;
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export function loadAttributionRecords(): ServerAttributionRecord[] {
  ensureDataDir();
  if (!fs.existsSync(ATTRIBUTION_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ATTRIBUTION_FILE, 'utf-8')) as ServerAttributionRecord[];
  } catch {
    return [];
  }
}

export function saveAttributionRecords(records: ServerAttributionRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(ATTRIBUTION_FILE, JSON.stringify(records, null, 2));
}

/**
 * 동일 레코드 판정 — PR-19 복합키 규칙.
 *   - FULL_CLOSE (fillId 없음): tradeId 만 일치하면 동일 — 기존 v1 동작 유지.
 *   - PARTIAL (fillId 있음): (tradeId, fillId) 둘 다 일치해야 동일.
 */
function isSameKey(a: ServerAttributionRecord, b: ServerAttributionRecord): boolean {
  if (a.tradeId !== b.tradeId) return false;
  // fillId 하나라도 없으면 FULL_CLOSE 규약으로 처리.
  const aHas = !!a.fillId;
  const bHas = !!b.fillId;
  if (!aHas && !bHas) return true;
  if (aHas && bHas) return a.fillId === b.fillId;
  // 하나는 있고 하나는 없으면 서로 다른 키 (FULL_CLOSE 와 PARTIAL 병존 가능).
  return false;
}

export function appendAttributionRecord(record: ServerAttributionRecord): void {
  // 신규 저장 시 현재 스키마 버전 강제 기록 — 과거 v0 혼입 방지.
  const versioned: ServerAttributionRecord = {
    ...record,
    schemaVersion: record.schemaVersion ?? CURRENT_ATTRIBUTION_SCHEMA_VERSION,
    // 기본값 주입 (타입 미지정은 FULL_CLOSE / 비중 미지정은 1.0).
    attributionType: record.attributionType ?? (record.fillId ? 'PARTIAL' : 'FULL_CLOSE'),
    qtyRatio: record.qtyRatio ?? 1.0,
  };
  const records = loadAttributionRecords();
  const filtered = records.filter((r) => !isSameKey(r, versioned));
  filtered.push(versioned);
  saveAttributionRecords(filtered.slice(-500));
}

/**
 * Phase 1 B5 — 스키마 버전 마이그레이션 유틸리티.
 *
 * - v0 (schemaVersion 누락): conditionScores 형태가 유효하면 승격.
 * - v1: PR-19 로 attributionType='FULL_CLOSE' + qtyRatio=1.0 주입 후 v2 로 승격.
 * - conditionScores 가 없거나 객체가 아닌 레코드는 "격리 대상" 으로 분류.
 *
 * 반환: { migrated, quarantined } 수.
 *
 * 집계 경로 (computeAttributionStats) 는 오직 CURRENT 버전만 읽어 NaN 전염을 차단한다.
 */
export function migrateAttributionRecords(): { migrated: number; quarantined: number; total: number } {
  const records = loadAttributionRecords();
  let migrated = 0;
  let quarantined = 0;

  const normalized: ServerAttributionRecord[] = [];
  for (const rec of records) {
    const version = rec.schemaVersion ?? 0;
    const hasScores = rec.conditionScores && typeof rec.conditionScores === 'object';
    if (!hasScores || !rec.tradeId || typeof rec.returnPct !== 'number') {
      quarantined++;
      continue; // 격리: 집계에서 제외
    }
    if (version < CURRENT_ATTRIBUTION_SCHEMA_VERSION) {
      // v0 / v1 레코드에 PR-19 필드 기본값 주입.
      normalized.push({
        ...rec,
        schemaVersion: CURRENT_ATTRIBUTION_SCHEMA_VERSION,
        attributionType: rec.attributionType ?? 'FULL_CLOSE',
        qtyRatio: rec.qtyRatio ?? 1.0,
      });
      migrated++;
    } else {
      normalized.push(rec);
    }
  }

  if (migrated > 0 || quarantined > 0) {
    saveAttributionRecords(normalized);
  }
  return { migrated, quarantined, total: records.length };
}

/**
 * 집계 안전을 위한 필터 — 오직 현행 스키마 레코드만 돌려준다.
 * 캘리브레이션 / 통계 / 주간 리포트가 공통으로 사용.
 */
export function loadCurrentSchemaRecords(): ServerAttributionRecord[] {
  return loadAttributionRecords().filter(
    (r) => (r.schemaVersion ?? 0) === CURRENT_ATTRIBUTION_SCHEMA_VERSION,
  );
}

/**
 * Phase 2차 C5 — shadow-trades.json 에서 귀인 집계에서 격리해야 하는 tradeId 집합.
 * shadowTradeRepo 를 직접 import 하지 않고 파일 레벨로 읽어서 순환 의존을 회피.
 * 파일이 없거나 파싱 실패 시 빈 Set 반환 — 격리 로직은 안전 기본값.
 *
 * 격리 대상:
 *   1) incidentFlag — 치명 버그 시각 이후 생성된 Shadow 샘플
 *   2) exitRuleTag === 'MANUAL_EXIT' — 사용자 수동 청산 (외부 요인/편향 혼입)
 *      자동 규칙 성과 평가에 수동 결정 결과가 섞이면 조건 가중치가 왜곡된다.
 */
export function collectFlaggedTradeIds(): Set<string> {
  try {
    if (!fs.existsSync(SHADOW_FILE)) return new Set();
    const raw = JSON.parse(fs.readFileSync(SHADOW_FILE, 'utf-8')) as Array<{
      id?: string;
      incidentFlag?: string;
      exitRuleTag?: string;
    }>;
    const ids = new Set<string>();
    for (const t of raw) {
      if (!t?.id) continue;
      if (t.incidentFlag) ids.add(t.id);
      if (t.exitRuleTag === 'MANUAL_EXIT') ids.add(t.id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

// ── 집계 유틸 ─────────────────────────────────────────────────────────────────

/** 단순 평균 */
function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/** 가중 평균 — Σ(val×w) / Σ(w). 총 가중합이 0 이면 0. */
function weightedAvg(pairs: Array<{ value: number; weight: number }>): number {
  let num = 0, den = 0;
  for (const p of pairs) { num += p.value * p.weight; den += p.weight; }
  return den > 0 ? num / den : 0;
}

/** 가중 승률 — Σ(weight | value > 0) / Σ(weight). %. */
function weightedWinPct(pairs: Array<{ value: number; weight: number }>): number {
  let winWeight = 0, totalWeight = 0;
  for (const p of pairs) {
    totalWeight += p.weight;
    if (p.value > 0) winWeight += p.weight;
  }
  return totalWeight > 0 ? (winWeight / totalWeight) * 100 : 0;
}

/**
 * 저장된 귀인 레코드를 조건별로 집계하여 성과 통계를 반환한다.
 * score >= 7 → "고점수" / score < 5 → "저점수" 구간으로 분리.
 *
 * PR-19: 각 레코드는 qtyRatio 로 가중된다. 전량 청산 1건 = 1.0 (기존 동일 동작),
 * 50% 부분매도 1건 = 0.5 기여. 이렇게 하면 동일 trade 의 여러 부분매도 합이
 * 최대 1.0 을 초과하지 않아 조건별 통계가 과대 계상되지 않는다.
 */
export function computeAttributionStats(): AttributionConditionStat[] {
  // 현행 스키마만 집계 — 혼합 스키마로 인한 NaN/왜곡 방지
  // Phase 2차 C5: incidentFlag 가 붙은 Shadow 거래는 결과 집계에서도 격리.
  const flaggedTradeIds = collectFlaggedTradeIds();
  const records = loadCurrentSchemaRecords().filter(r => !flaggedTradeIds.has(r.tradeId));
  if (records.length === 0) return [];

  const condMap: Record<
    number,
    { pairs: Array<{ value: number; weight: number }>;
      highPairs: Array<{ value: number; weight: number }>;
      lowPairs: Array<{ value: number; weight: number }>;
      totalWeight: number;
    }
  > = {};

  for (const rec of records) {
    const weight = rec.qtyRatio ?? 1.0;
    for (const [condIdStr, score] of Object.entries(rec.conditionScores)) {
      const condId = Number(condIdStr);
      if (!condMap[condId]) condMap[condId] = { pairs: [], highPairs: [], lowPairs: [], totalWeight: 0 };
      condMap[condId].pairs.push({ value: rec.returnPct, weight });
      condMap[condId].totalWeight += weight;
      if (score >= 7) condMap[condId].highPairs.push({ value: rec.returnPct, weight });
      if (score < 5)  condMap[condId].lowPairs.push({ value: rec.returnPct, weight });
    }
  }

  return Object.entries(condMap)
    .map(([condId, data]) => ({
      conditionId:       Number(condId),
      // totalTrades 는 가중 합을 정수로 반올림 — "가중 trade 수" 의미.
      totalTrades:       Math.round(data.totalWeight),
      winRate:           parseFloat(weightedWinPct(data.pairs).toFixed(1)),
      avgReturn:         parseFloat(weightedAvg(data.pairs).toFixed(2)),
      avgReturnWhenHigh: parseFloat(weightedAvg(data.highPairs).toFixed(2)),
      avgReturnWhenLow:  parseFloat(weightedAvg(data.lowPairs).toFixed(2)),
    }))
    .sort((a, b) => a.conditionId - b.conditionId);
}

// ── 부분매도 attribution emitter (PR-19) ────────────────────────────────────
//
// 생산자(exitEngine 또는 UI) 가 기존 trade 의 attribution 베이스(condition scores)
// 위에 부분매도 PARTIAL 레코드를 추가할 때 사용하는 편의 함수. baseline 은 다음
// 우선순위로 자동 선택한다:
//   1) 동일 tradeId 의 기존 FULL_CLOSE 레코드 (있으면 conditionScores 재사용)
//   2) 호출자가 명시적으로 전달한 conditionScores
// 둘 다 없으면 null 을 반환한다 (noop).

export interface EmitPartialAttributionInput {
  tradeId: string;
  fillId: string;
  stockCode: string;
  stockName: string;
  /** fill.confirmedAt (ISO) */
  closedAt: string;
  /** 이 fill 의 pnlPct (%) */
  returnPct: number;
  /** 이 fill.qty / originalQuantity (0~1) */
  qtyRatio: number;
  holdingDays: number;
  entryRegime?: string;
  sellReason?: string;
  /** 호출자가 직접 제공하는 conditionScores. 없으면 기존 FULL_CLOSE 레코드에서 조회. */
  conditionScoresOverride?: Record<number, number>;
}

/**
 * 부분매도 PARTIAL attribution 레코드를 기록한다. 생산자 경로에서 선택적으로 사용.
 *
 * 반환:
 *   - 저장된 레코드 (성공)
 *   - null: conditionScores baseline 없어 기록 스킵
 */
export function emitPartialAttribution(input: EmitPartialAttributionInput): ServerAttributionRecord | null {
  let scores = input.conditionScoresOverride;
  if (!scores) {
    const existing = loadAttributionRecords()
      .find((r) => r.tradeId === input.tradeId && (!r.attributionType || r.attributionType === 'FULL_CLOSE'));
    if (existing?.conditionScores) scores = existing.conditionScores;
  }
  if (!scores || Object.keys(scores).length === 0) return null;

  const rec: ServerAttributionRecord = {
    schemaVersion: CURRENT_ATTRIBUTION_SCHEMA_VERSION,
    tradeId: input.tradeId,
    fillId: input.fillId,
    attributionType: 'PARTIAL',
    qtyRatio: Math.max(0, Math.min(1, input.qtyRatio)),
    stockCode: input.stockCode,
    stockName: input.stockName,
    closedAt: input.closedAt,
    returnPct: input.returnPct,
    isWin: input.returnPct > 0,
    entryRegime: input.entryRegime,
    conditionScores: scores,
    holdingDays: input.holdingDays,
    sellReason: input.sellReason,
  };
  appendAttributionRecord(rec);
  return rec;
}
