/**
 * server/trading/reconciliationEngine.ts
 * 아이디어 6: 이중 기록 Reconciliation
 *
 * 매일 KST 23:30에 세 가지 진실 원천을 대조한다:
 *   A. shadow-log.json    — exitEngine이 기록한 청산 이벤트 (텔레그램 발송과 1:1 대응)
 *   B. trade-events-*.jsonl — TradeEvent SSOT (FULL_SELL 건수)
 *   C. shadow-trades.json — 최종 포지션 상태 (HIT_TARGET / HIT_STOP 건수)
 *
 * A↔B 불일치 또는 B↔C 불일치가 MISMATCH_THRESHOLD 초과 시:
 *   - 텔레그램 Critical 알림
 *   - DATA_INTEGRITY_BLOCKED = true → 신규 매수 게이팅
 */

import fs from 'fs';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import {
  SHADOW_LOG_FILE,
  NOTIFICATION_LOG_FILE,
  RECONCILE_STATE_FILE,
  tradeEventsFile,
  ensureDataDir,
} from '../persistence/paths.js';
import { getDataIntegrityBlocked, setDataIntegrityBlocked } from '../state.js';

// ─── 설정 ─────────────────────────────────────────────────────────────────────

/** 이 건수 이상 불일치 시 Critical 알림 + 게이팅 */
const MISMATCH_THRESHOLD = 2;

// ─── 인터페이스 ───────────────────────────────────────────────────────────────

export interface ReconcileItem {
  positionId: string;
  stockCode: string;
  stockName?: string;
  issue: string;  // 불일치 내용 설명
}

export interface ReconcileResult {
  date: string;           // YYYY-MM-DD KST
  ranAt: string;          // ISO
  shadowLogCloses: number;  // A: shadow-log SELL 이벤트 수
  tradeEventCloses: number; // B: TradeEvent FULL_SELL 수
  shadowTradeCloses: number; // C: shadow-trades 종결 상태 수
  notificationsLogged: number; // notification-log.json 기록 건수
  mismatchCount: number;
  mismatches: ReconcileItem[];
  integrityOk: boolean;
  blockedByReconcile: boolean;
}

// ─── 알림 로그 유틸 ──────────────────────────────────────────────────────────

/**
 * 텔레그램 발송 직후 호출하여 notification-log.json에 기록한다.
 * exitEngine, fillMonitor 등에서 청산·진입 알림 발송 시 호출.
 */
export function logNotification(entry: {
  type: 'ENTRY' | 'SELL' | 'PARTIAL_SELL';
  positionId: string;
  stockCode: string;
  stockName?: string;
  ts: string;
}): void {
  ensureDataDir();
  const logs: unknown[] = fs.existsSync(NOTIFICATION_LOG_FILE)
    ? (() => { try { return JSON.parse(fs.readFileSync(NOTIFICATION_LOG_FILE, 'utf-8')); } catch { return []; } })()
    : [];
  logs.push({ ...entry, loggedAt: new Date().toISOString() });
  fs.writeFileSync(NOTIFICATION_LOG_FILE, JSON.stringify(logs.slice(-1000), null, 2), 'utf-8');
}

// ─── shadow-log 분석 ──────────────────────────────────────────────────────────

const SHADOW_LOG_CLOSE_EVENTS = new Set([
  'HIT_STOP', 'HIT_TARGET', 'R6_EMERGENCY_EXIT', 'MA60_DEATH_FORCE_EXIT',
  'CASCADE_STOP_FINAL', 'CASCADE_STOP_BLACKLIST', 'TRAILING_STOP',
]);

function loadShadowLogCloses(dateKst: string): Map<string, { stockCode: string; stockName?: string }> {
  const result = new Map<string, { stockCode: string; stockName?: string }>();
  if (!fs.existsSync(SHADOW_LOG_FILE)) return result;
  try {
    const logs: any[] = JSON.parse(fs.readFileSync(SHADOW_LOG_FILE, 'utf-8'));
    for (const e of logs) {
      if (!SHADOW_LOG_CLOSE_EVENTS.has(e.event)) continue;
      const tsKst = new Date(new Date(e.ts).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
      if (tsKst !== dateKst) continue;
      const key = e.id ?? `${e.stockCode}__${e.signalTime?.slice(0, 10) ?? 'unknown'}`;
      result.set(key, { stockCode: e.stockCode, stockName: e.stockName });
    }
  } catch { /* 손상된 로그 스킵 */ }
  return result;
}

// ─── trade-events-*.jsonl 분석 ────────────────────────────────────────────────

function loadTradeEventCloses(yyyymm: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const file = tradeEventsFile(yyyymm);
  if (!fs.existsSync(file)) return result;
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'FULL_SELL') result.set(e.positionId, true);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result;
}

// ─── notification-log 분석 ────────────────────────────────────────────────────

function loadNotificationLogCount(dateKst: string): number {
  if (!fs.existsSync(NOTIFICATION_LOG_FILE)) return 0;
  try {
    const logs: any[] = JSON.parse(fs.readFileSync(NOTIFICATION_LOG_FILE, 'utf-8'));
    return logs.filter(e => {
      const tsKst = new Date(new Date(e.ts ?? e.loggedAt).getTime() + 9 * 3_600_000)
        .toISOString().slice(0, 10);
      return tsKst === dateKst && (e.type === 'SELL' || e.type === 'PARTIAL_SELL');
    }).length;
  } catch { return 0; }
}

// ─── 메인 Reconciliation 함수 ─────────────────────────────────────────────────

export async function runDailyReconciliation(
  opts: { silent?: boolean } = {}
): Promise<ReconcileResult> {
  ensureDataDir();

  const nowKst   = new Date(Date.now() + 9 * 3_600_000);
  const dateKst  = nowKst.toISOString().slice(0, 10);
  const yyyymm   = dateKst.slice(0, 7).replace('-', '');

  // A: shadow-log 청산 이벤트
  const shadowLogCloses  = loadShadowLogCloses(dateKst);

  // B: TradeEvent FULL_SELL
  const tradeEventCloses = loadTradeEventCloses(yyyymm);

  // C: shadow-trades 종결 상태 (오늘 청산된 것 — SELL fill KST 기준)
  const shadowTrades = loadShadowTrades();
  const shadowTradeClosedIds = new Set<string>(
    shadowTrades
      .filter(t =>
        (t.fills ?? []).some((f: any) =>
          f.type === 'SELL' &&
          new Date(new Date(f.timestamp).getTime() + 9 * 3_600_000).toISOString().slice(0, 10) === dateKst
        )
      )
      .map(t => t.id)
  );

  // D: notification-log 알림 발송 건수 (있을 때만 참고)
  const notificationsLogged = loadNotificationLogCount(dateKst);

  // ── 불일치 탐지 ──────────────────────────────────────────────────────────────
  const mismatches: ReconcileItem[] = [];

  // B에는 있는데 A에 없는 포지션 (shadow-log가 누락)
  for (const [posId] of tradeEventCloses) {
    if (!shadowLogCloses.has(posId)) {
      const trade = shadowTrades.find(t => t.id === posId);
      mismatches.push({
        positionId: posId,
        stockCode: trade?.stockCode ?? '?',
        stockName: trade?.stockName,
        issue: 'TradeEvent에 FULL_SELL 있으나 shadow-log에 청산 이벤트 없음',
      });
    }
  }

  // A에는 있는데 B에 없는 포지션 (TradeEvent가 누락 — 레거시 포지션 제외)
  for (const [posId, info] of shadowLogCloses) {
    if (!tradeEventCloses.has(posId)) {
      mismatches.push({
        positionId: posId,
        stockCode: info.stockCode,
        stockName: info.stockName,
        issue: 'shadow-log에 청산 이벤트 있으나 TradeEvent FULL_SELL 없음 (레거시 또는 누락)',
      });
    }
  }

  // C shadow-trades 종결 수 vs B TradeEvent FULL_SELL 수 불일치
  const cCount = shadowTradeClosedIds.size;
  const bCount = tradeEventCloses.size;
  if (Math.abs(cCount - bCount) > MISMATCH_THRESHOLD) {
    mismatches.push({
      positionId: 'AGGREGATE',
      stockCode: 'ALL',
      issue: `shadow-trades 오늘 청산 ${cCount}건 vs TradeEvent FULL_SELL ${bCount}건 (차이 ${Math.abs(cCount - bCount)})`,
    });
  }

  const mismatchCount = mismatches.length;
  const integrityOk   = mismatchCount <= MISMATCH_THRESHOLD;

  // ── 게이팅 상태 업데이트 ─────────────────────────────────────────────────────
  const wasBlocked = getDataIntegrityBlocked();
  if (!integrityOk) {
    setDataIntegrityBlocked(true);
  } else if (wasBlocked) {
    // 정합성 회복 시 게이팅 해제
    setDataIntegrityBlocked(false);
  }

  const result: ReconcileResult = {
    date: dateKst,
    ranAt: new Date().toISOString(),
    shadowLogCloses: shadowLogCloses.size,
    tradeEventCloses: bCount,
    shadowTradeCloses: cCount,
    notificationsLogged,
    mismatchCount,
    mismatches,
    integrityOk,
    blockedByReconcile: !integrityOk,
  };

  // ── 결과 저장 ─────────────────────────────────────────────────────────────────
  fs.writeFileSync(RECONCILE_STATE_FILE, JSON.stringify(result, null, 2), 'utf-8');

  // ── 텔레그램 알림 ─────────────────────────────────────────────────────────────
  if (!opts.silent) {
    if (!integrityOk) {
      const lines = [
        `🚨 <b>[Reconciliation 정합성 오류]</b>`,
        `📅 ${dateKst}`,
        ``,
        `shadow-log 청산: ${shadowLogCloses.size}건`,
        `TradeEvent FULL_SELL: ${bCount}건`,
        `shadow-trades 오늘 청산: ${cCount}건`,
        `알림 로그 발송: ${notificationsLogged}건`,
        ``,
        `<b>불일치 ${mismatchCount}건</b> — 신규 매수 자동 차단`,
        ...mismatches.slice(0, 5).map(m => `• ${m.stockCode}(${m.stockName ?? '?'}): ${m.issue}`),
        ...(mismatches.length > 5 ? [`...외 ${mismatches.length - 5}건`] : []),
      ];
      await sendTelegramAlert(lines.join('\n'), {
        priority: 'CRITICAL',
        dedupeKey: `reconcile_fail_${dateKst}`,
      }).catch(console.error);
    } else {
      // 정상 — 요약 알림 (선택적)
      const summary = [
        `✅ <b>[Reconciliation 정합성 OK]</b>`,
        `📅 ${dateKst}`,
        `shadow-log: ${shadowLogCloses.size} / TradeEvent: ${bCount} / shadow-trades: ${cCount}`,
        `알림 로그: ${notificationsLogged}건`,
      ].join('\n');
      await sendTelegramAlert(summary, {
        priority: 'LOW',
        dedupeKey: `reconcile_ok_${dateKst}`,
      }).catch(console.error);
    }
  }

  console.log(
    `[Reconciliation] ${dateKst} — A:${shadowLogCloses.size} B:${bCount} C:${cCount} ` +
    `불일치:${mismatchCount} ${integrityOk ? '✅' : '🚨 BLOCKED'}`
  );

  return result;
}

/** 마지막 Reconciliation 결과 로드 */
export function loadLastReconcileResult(): ReconcileResult | null {
  if (!fs.existsSync(RECONCILE_STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(RECONCILE_STATE_FILE, 'utf-8')); } catch { return null; }
}
