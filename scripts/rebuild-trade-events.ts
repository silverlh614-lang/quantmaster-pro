/**
 * scripts/rebuild-trade-events.ts
 * 레거시 shadow-log.json + oco-orders.json을 교차 참조하여
 * 과거 포지션의 TradeEvent를 역재구성한다.
 *
 * 실행: npx tsx scripts/rebuild-trade-events.ts [--dry-run]
 *
 * 출력:
 *   data/trade-events-recovered.jsonl — 복구된 TradeEvent (append-only)
 *   data/rebuild-diagnostic.json      — 복구 실패 건 진단 리포트
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.PERSIST_DATA_DIR
  ? path.resolve(process.env.PERSIST_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

const SHADOW_LOG_FILE   = path.join(DATA_DIR, 'shadow-log.json');
const SHADOW_FILE       = path.join(DATA_DIR, 'shadow-trades.json');
const OCO_ORDERS_FILE   = path.join(DATA_DIR, 'oco-orders.json');
const RECOVERED_FILE    = path.join(DATA_DIR, 'trade-events-recovered.jsonl');
const DIAGNOSTIC_FILE   = path.join(DATA_DIR, 'rebuild-diagnostic.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

interface ShadowLogEntry {
  event: string;
  id?: string;
  stockCode: string;
  stockName?: string;
  ts: string;            // appendShadowLog이 추가하는 타임스탬프
  signalTime?: string;
  shadowEntryPrice?: number;
  entryPrice?: number;
  quantity?: number;
  originalQuantity?: number;
  exitPrice?: number;
  returnPct?: number;
  soldQty?: number;
  fills?: any[];
  [key: string]: unknown;
}

interface ReconstructedEvent {
  id: string;
  positionId: string;
  ts: string;
  type: 'ENTRY' | 'PARTIAL_SELL' | 'FULL_SELL' | 'CANCEL';
  subType?: string;
  quantity: number;
  price: number;
  realizedPnL: number;
  cumRealizedPnL: number;
  remainingQty: number;
  source: 'shadow-log' | 'oco-orders';  // 복구 출처
}

interface DiagnosticReport {
  generatedAt: string;
  totalLogEntries: number;
  positionsFound: number;
  positionsRecovered: number;
  positionsFailed: number;
  eventsWritten: number;
  failures: {
    positionId: string;
    stockCode: string;
    stockName?: string;
    reason: string;
    logEntries: string[];
  }[];
  warnings: string[];
}

// ─── SELL 이벤트 분류 ─────────────────────────────────────────────────────────

const SELL_EVENTS = new Set([
  'HIT_STOP', 'HIT_TARGET', 'R6_EMERGENCY_EXIT', 'MA60_DEATH_FORCE_EXIT',
  'CASCADE_STOP_FINAL', 'CASCADE_STOP_BLACKLIST', 'PROFIT_TRANCHE',
  'TRAILING_STOP', 'RRR_COLLAPSE_PARTIAL', 'DIVERGENCE_PARTIAL',
  'CASCADE_HALF_SELL', 'EUPHORIA_PARTIAL',
]);

// event → TradeEvent subType 매핑
const EVENT_TO_SUBTYPE: Record<string, string> = {
  HIT_STOP:               'HARD_STOP',
  CASCADE_STOP_FINAL:     'HARD_STOP',
  CASCADE_STOP_BLACKLIST: 'HARD_STOP',
  R6_EMERGENCY_EXIT:      'R6_EMERGENCY',
  MA60_DEATH_FORCE_EXIT:  'MA60_FORCE',
  HIT_TARGET:             'FULL_CLOSE',
  PROFIT_TRANCHE:         'LIMIT_TP1',
  TRAILING_STOP:          'TRAILING_STOP',
  RRR_COLLAPSE_PARTIAL:   'LIMIT_TP1',
  DIVERGENCE_PARTIAL:     'LIMIT_TP1',
  CASCADE_HALF_SELL:      'CASCADE_HALF',
  EUPHORIA_PARTIAL:       'LIMIT_TP1',
};

// FULL SELL 이벤트 (잔여수량 → 0)
const FULL_SELL_EVENTS = new Set([
  'HIT_STOP', 'HIT_TARGET', 'R6_EMERGENCY_EXIT', 'MA60_DEATH_FORCE_EXIT',
  'CASCADE_STOP_FINAL', 'CASCADE_STOP_BLACKLIST',
]);

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

let _seq = 0;
function newId(ts: string): string {
  return `recovered_${new Date(ts).getTime()}_${(++_seq).toString(36).padStart(5, '0')}`;
}

function loadJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

// ─── 메인 로직 ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[rebuild] 시작 — DATA_DIR: ${DATA_DIR} ${DRY_RUN ? '(DRY RUN)' : ''}`);

  const shadowLog = loadJson<ShadowLogEntry[]>(SHADOW_LOG_FILE) ?? [];
  const shadowTrades = loadJson<any[]>(SHADOW_FILE) ?? [];
  const ocoOrders = loadJson<any[]>(OCO_ORDERS_FILE) ?? [];

  console.log(`[rebuild] shadow-log: ${shadowLog.length}건 / shadow-trades: ${shadowTrades.length}건 / oco-orders: ${ocoOrders.length}건`);

  const diag: DiagnosticReport = {
    generatedAt: new Date().toISOString(),
    totalLogEntries: shadowLog.length,
    positionsFound: 0,
    positionsRecovered: 0,
    positionsFailed: 0,
    eventsWritten: 0,
    failures: [],
    warnings: [],
  };

  // ── 1. shadow-log 를 포지션ID별로 그룹화 ────────────────────────────────────
  const byPosition = new Map<string, ShadowLogEntry[]>();
  for (const entry of shadowLog) {
    const key = entry.id ?? `${entry.stockCode}__${entry.signalTime?.slice(0, 10) ?? 'unknown'}`;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key)!.push(entry);
  }

  // ── 2. shadow-trades.json에 fills가 있는 포지션은 스킵 (이미 이벤트 기록됨) ──
  const positionsWithFills = new Set(
    shadowTrades
      .filter((t: any) => (t.fills ?? []).length > 0)
      .map((t: any) => t.id)
  );

  diag.positionsFound = byPosition.size;

  // ── 3. 포지션별 이벤트 역재구성 ─────────────────────────────────────────────
  const recoveredEvents: ReconstructedEvent[] = [];

  for (const [positionId, entries] of byPosition) {
    // 이미 fills 있는 포지션 스킵
    if (positionsWithFills.has(positionId)) {
      diag.warnings.push(`${positionId}: fills 이미 존재 — 스킵`);
      continue;
    }

    // 시간순 정렬
    entries.sort((a, b) => a.ts.localeCompare(b.ts));

    const activated = entries.find(e => e.event === 'SHADOW_ACTIVATED');
    const stockCode = entries[0].stockCode;
    const stockName = activated?.stockName ?? entries[0].stockName;

    // 진입가·수량 결정
    const entryPrice  = activated?.shadowEntryPrice ?? activated?.entryPrice ?? activated?.signalPrice as number ?? 0;
    const entryQty    = activated?.originalQuantity ?? activated?.quantity ?? 0;

    if (!entryPrice || !entryQty) {
      diag.positionsFailed++;
      diag.failures.push({
        positionId,
        stockCode,
        stockName,
        reason: `진입가(${entryPrice}) 또는 수량(${entryQty}) 미확인`,
        logEntries: entries.map(e => e.event),
      });
      continue;
    }

    const posEvents: ReconstructedEvent[] = [];
    let cumPnL    = 0;
    let remaining = entryQty;

    // ENTRY 이벤트 추가
    posEvents.push({
      id: newId(activated?.ts ?? entries[0].ts),
      positionId,
      ts: activated?.ts ?? entries[0].ts,
      type: 'ENTRY',
      subType: 'INITIAL_BUY',
      quantity: entryQty,
      price: entryPrice,
      realizedPnL: 0,
      cumRealizedPnL: 0,
      remainingQty: entryQty,
      source: 'shadow-log',
    });

    // SELL 이벤트 처리
    for (const entry of entries) {
      if (!SELL_EVENTS.has(entry.event)) continue;

      const soldQty = entry.soldQty ?? (FULL_SELL_EVENTS.has(entry.event) ? remaining : 0);
      if (!soldQty || soldQty <= 0) {
        diag.warnings.push(`${positionId} / ${entry.event}: soldQty 미확인 — 스킵`);
        continue;
      }

      const exitPrice = entry.exitPrice ?? (entry as any).tranchePrice ?? 0;
      if (!exitPrice) {
        diag.warnings.push(`${positionId} / ${entry.event}: exitPrice 미확인 — pnl 0으로 추정`);
      }

      const pnl = exitPrice ? (exitPrice - entryPrice) * soldQty : 0;
      const isFullSell = FULL_SELL_EVENTS.has(entry.event);
      remaining = Math.max(0, remaining - soldQty);
      cumPnL   += pnl;

      posEvents.push({
        id: newId(entry.ts),
        positionId,
        ts: entry.ts,
        type: isFullSell ? 'FULL_SELL' : 'PARTIAL_SELL',
        subType: EVENT_TO_SUBTYPE[entry.event],
        quantity: soldQty,
        price: exitPrice,
        realizedPnL: pnl,
        cumRealizedPnL: cumPnL,
        remainingQty: remaining,
        source: 'shadow-log',
      });
    }

    // ── 4. OCO 주문 교차 검증 ────────────────────────────────────────────────
    const matchingOco = ocoOrders.filter(
      (o: any) => o.stockCode === stockCode &&
        (o.status === 'STOP_FILLED' || o.status === 'PROFIT_FILLED')
    );
    if (matchingOco.length > 0 && posEvents.filter(e => e.type !== 'ENTRY').length === 0) {
      // shadow-log에 SELL 이벤트가 없으나 OCO가 체결됨 — OCO에서 복구 시도
      for (const oco of matchingOco) {
        const isSl   = oco.status === 'STOP_FILLED';
        const price  = isSl ? oco.stopPrice : oco.profitPrice;
        const qty    = oco.quantity ?? remaining;
        const pnl    = price ? (price - entryPrice) * qty : 0;
        remaining    = Math.max(0, remaining - qty);
        cumPnL      += pnl;
        posEvents.push({
          id: newId(oco.resolvedAt ?? oco.createdAt),
          positionId,
          ts: oco.resolvedAt ?? oco.createdAt,
          type: remaining === 0 ? 'FULL_SELL' : 'PARTIAL_SELL',
          subType: isSl ? 'HARD_STOP' : 'FULL_CLOSE',
          quantity: qty,
          price,
          realizedPnL: pnl,
          cumRealizedPnL: cumPnL,
          remainingQty: remaining,
          source: 'oco-orders',
        });
      }
    }

    if (posEvents.length <= 1) {
      // ENTRY만 있고 청산 이벤트 없음
      diag.warnings.push(`${positionId} (${stockName}): 청산 이벤트 없음 — ENTRY만 기록`);
    }

    recoveredEvents.push(...posEvents);
    diag.positionsRecovered++;
  }

  // ── 5. 출력 ─────────────────────────────────────────────────────────────────
  diag.eventsWritten = recoveredEvents.length;

  console.log(`[rebuild] 복구 완료: ${diag.positionsRecovered}개 포지션 / ${recoveredEvents.length}개 이벤트`);
  if (diag.positionsFailed > 0) {
    console.warn(`[rebuild] 복구 실패: ${diag.positionsFailed}개 (→ ${DIAGNOSTIC_FILE})`);
  }

  if (!DRY_RUN) {
    // 기존 복구 파일이 있으면 positionId 중복 제거
    const existingIds = new Set<string>();
    if (fs.existsSync(RECOVERED_FILE)) {
      const lines = fs.readFileSync(RECOVERED_FILE, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          existingIds.add(`${e.positionId}::${e.ts}::${e.type}`);
        } catch { /* skip */ }
      }
    }

    const newLines = recoveredEvents
      .filter(e => !existingIds.has(`${e.positionId}::${e.ts}::${e.type}`))
      .map(e => JSON.stringify(e))
      .join('\n');

    if (newLines) {
      fs.appendFileSync(RECOVERED_FILE, newLines + '\n', 'utf-8');
      console.log(`[rebuild] ${RECOVERED_FILE} 에 ${recoveredEvents.length - existingIds.size}건 추가`);
    } else {
      console.log('[rebuild] 신규 이벤트 없음 — 파일 변경 없음');
    }

    fs.writeFileSync(DIAGNOSTIC_FILE, JSON.stringify(diag, null, 2), 'utf-8');
    console.log(`[rebuild] 진단 리포트: ${DIAGNOSTIC_FILE}`);
  } else {
    console.log('[rebuild] DRY RUN — 파일 쓰기 생략');
    console.log('[rebuild] 복구 예정 이벤트 샘플 (최대 10건):');
    for (const e of recoveredEvents.slice(0, 10)) {
      console.log(`  ${e.type} ${e.subType ?? ''} | ${e.positionId} | qty=${e.quantity} price=${e.price} pnl=${Math.round(e.realizedPnL)}`);
    }
    if (diag.failures.length > 0) {
      console.log('\n[rebuild] 복구 실패 건:');
      for (const f of diag.failures) {
        console.log(`  [FAIL] ${f.stockCode} (${f.stockName}) — ${f.reason} | events: ${f.logEntries.join(', ')}`);
      }
    }
  }
}

main().catch(e => {
  console.error('[rebuild] 치명적 오류:', e);
  process.exit(1);
});
