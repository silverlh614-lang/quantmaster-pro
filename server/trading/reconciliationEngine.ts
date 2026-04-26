// @responsibility reconciliationEngine 매매 엔진 모듈
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
import { loadShadowTrades, getRemainingQty } from '../persistence/shadowTradeRepo.js';
import {
  SHADOW_LOG_FILE,
  NOTIFICATION_LOG_FILE,
  RECONCILE_STATE_FILE,
  tradeEventsFile,
  ensureDataDir,
} from '../persistence/paths.js';
import { getDataIntegrityBlocked, setDataIntegrityBlocked } from '../state.js';
import { KIS_IS_REAL, isKisBalanceQueryAllowed, kisGet } from '../clients/kisClient.js';

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

// ─── KIS 잔고 vs Shadow DB 정합성 검증 ───────────────────────────────────────
//
// exitEngine 이 매도 주문을 접수하면 shadow DB 의 fill 수량을 "선반영" 한다.
// 접수~CCLD 확인 사이 최대 150초 공백이 있어, 이 구간 shadow 의 내부 포지션
// 수량은 KIS 실잔고와 괴리된다. PROVISIONAL fill 상태로 대부분 해결되지만,
// 장애/재부팅/누락된 CCLD 갱신 등 예상 밖 경로가 남는다.
//
// 이 함수는 KIS `/inquire-balance` 로 실보유 수량을 조회하여 LIVE shadow 의 fills
// SSOT 기반 잔량과 대조한다. 2주 이상 차이나면 Telegram HIGH 알림.

export interface KisShadowMismatch {
  stockCode: string;
  stockName?: string;
  shadowQty: number;
  kisHldgQty: number;
  delta: number;  // kis - shadow (음수 = shadow 가 더 많이 가지고 있다고 기록)
}

export interface KisShadowReconcileResult {
  ranAt: string;
  skipped: boolean;
  skipReason?: string;
  shadowPositions: number;    // LIVE shadow open position 수
  kisHoldings: number;         // KIS 보유 종목 수
  mismatches: KisShadowMismatch[];
  totalQtyDelta: number;       // Σ|delta|
}

/**
 * KIS 실잔고 vs Shadow LIVE 포지션의 수량 정합성을 대조한다.
 * 점검/장외 시간대엔 자동 스킵 (isKisBalanceQueryAllowed).
 * LIVE (KIS_IS_REAL=true) 가 아니면 전체 스킵 — SHADOW 모드는 KIS 잔고와 괴리가 설계상 정상.
 */
export async function reconcileKisVsShadow(
  opts: { silent?: boolean; quantityTolerance?: number } = {},
): Promise<KisShadowReconcileResult> {
  const qtyTolerance = opts.quantityTolerance ?? 2;
  const ranAt = new Date().toISOString();

  if (!KIS_IS_REAL || !process.env.KIS_APP_KEY) {
    return { ranAt, skipped: true, skipReason: 'SHADOW 모드 또는 KIS 미설정', shadowPositions: 0, kisHoldings: 0, mismatches: [], totalQtyDelta: 0 };
  }
  if (!isKisBalanceQueryAllowed()) {
    return { ranAt, skipped: true, skipReason: 'KIS 잔고 조회 불가 시간대 (점검/장외)', shadowPositions: 0, kisHoldings: 0, mismatches: [], totalQtyDelta: 0 };
  }

  // LIVE 오픈 포지션만 대상 — HIT_TARGET/HIT_STOP 은 이미 청산된 것이므로 제외.
  const shadowAll = loadShadowTrades();
  const openStatuses = new Set(['PENDING', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'ACTIVE', 'EUPHORIA_PARTIAL']);
  const liveOpen = shadowAll.filter(t => (t.mode ?? 'LIVE') === 'LIVE' && openStatuses.has(t.status));

  // KIS 실보유 조회
  const trId = KIS_IS_REAL ? 'TTTC8434R' : 'VTTC8434R';
  let data: { output1?: Array<{ pdno: string; prdt_name?: string; hldg_qty: string }> } | null = null;
  try {
    data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01',
      FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '01',
      CTX_AREA_FK100: '', CTX_AREA_NK100: '',
    }, 'LOW');
  } catch (e) {
    return { ranAt, skipped: true, skipReason: `KIS 조회 실패: ${e instanceof Error ? e.message : String(e)}`, shadowPositions: liveOpen.length, kisHoldings: 0, mismatches: [], totalQtyDelta: 0 };
  }
  if (!data) {
    return { ranAt, skipped: true, skipReason: 'KIS 조회 응답 비어있음', shadowPositions: liveOpen.length, kisHoldings: 0, mismatches: [], totalQtyDelta: 0 };
  }

  const kisHoldings = (data.output1 ?? []).filter(h => Number(h.hldg_qty ?? 0) > 0);
  const kisQtyByCode = new Map<string, { qty: number; name?: string }>();
  for (const h of kisHoldings) {
    const code = String(h.pdno ?? '').padStart(6, '0');
    kisQtyByCode.set(code, { qty: Number(h.hldg_qty ?? 0), name: h.prdt_name });
  }

  const shadowQtyByCode = new Map<string, { qty: number; name: string }>();
  for (const t of liveOpen) {
    const code = String(t.stockCode ?? '').padStart(6, '0');
    const q = getRemainingQty(t);
    const prev = shadowQtyByCode.get(code);
    shadowQtyByCode.set(code, { qty: (prev?.qty ?? 0) + q, name: prev?.name ?? t.stockName });
  }

  const mismatches: KisShadowMismatch[] = [];
  const allCodes = new Set<string>([...kisQtyByCode.keys(), ...shadowQtyByCode.keys()]);
  for (const code of allCodes) {
    const shadowQty = shadowQtyByCode.get(code)?.qty ?? 0;
    const kisHldgQty = kisQtyByCode.get(code)?.qty ?? 0;
    const delta = kisHldgQty - shadowQty;
    if (Math.abs(delta) >= qtyTolerance) {
      mismatches.push({
        stockCode: code,
        stockName: shadowQtyByCode.get(code)?.name ?? kisQtyByCode.get(code)?.name,
        shadowQty, kisHldgQty, delta,
      });
    }
  }

  const totalQtyDelta = mismatches.reduce((s, m) => s + Math.abs(m.delta), 0);
  const result: KisShadowReconcileResult = {
    ranAt,
    skipped: false,
    shadowPositions: liveOpen.length,
    kisHoldings: kisHoldings.length,
    mismatches,
    totalQtyDelta,
  };

  if (!opts.silent && mismatches.length > 0) {
    const lines = [
      `🚨 <b>[KIS 잔고 ≠ Shadow DB]</b>`,
      `Shadow LIVE 포지션: ${liveOpen.length}개 | KIS 보유: ${kisHoldings.length}종목`,
      `불일치 ${mismatches.length}건 (|Δ|≥${qtyTolerance}):`,
      ...mismatches.slice(0, 8).map(m =>
        `• ${m.stockCode} ${m.stockName ?? ''}: Shadow ${m.shadowQty}주 vs KIS ${m.kisHldgQty}주 (Δ${m.delta >= 0 ? '+' : ''}${m.delta})`
      ),
      ...(mismatches.length > 8 ? [`...외 ${mismatches.length - 8}건`] : []),
    ];
    await sendTelegramAlert(lines.join('\n'), {
      priority: 'HIGH',
      dedupeKey: `kis_shadow_mismatch:${new Date().toISOString().slice(0, 13)}`,  // 시간별 1회
    }).catch(console.error);
  }

  console.log(
    `[KisShadowReconcile] shadowOpen=${liveOpen.length} kisHoldings=${kisHoldings.length} ` +
    `mismatch=${mismatches.length} ΣΔ=${totalQtyDelta}`,
  );
  return result;
}
