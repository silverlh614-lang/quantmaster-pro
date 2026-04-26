// @responsibility tradeEventLog 매매 엔진 모듈
import fs from 'fs';
import { tradeEventsFile, ensureDataDir } from '../persistence/paths.js';

// ─── TradeEvent 모델 ──────────────────────────────────────────────────────────

/**
 * 포지션 생애주기의 단일 불변 이벤트.
 * append-only. 절대 수정·삭제 금지 — 이것이 회계 감사 추적의 단일 진실 원천.
 */
export interface TradeEvent {
  id: string;           // evt_${ts}_${rand5}
  positionId: string;   // ServerShadowTrade.id
  ts: string;           // ISO 8601
  type: 'ENTRY' | 'PARTIAL_SELL' | 'FULL_SELL' | 'CANCEL';
  subType?:
    | 'INITIAL_BUY'
    | 'LIMIT_TP1'       // PARTIAL_TP tranche 1
    | 'LIMIT_TP2'       // PARTIAL_TP tranche 2+
    | 'TRAILING_STOP'   // TRAILING_TP
    | 'HARD_STOP'       // STOP_LOSS (hard stop / cascade final)
    | 'CASCADE_HALF'    // STOP_LOSS (cascade -15% 반매도)
    | 'R6_EMERGENCY'    // EMERGENCY (R6 블랙스완)
    | 'MA60_FORCE'      // EMERGENCY (MA60 역배열 강제)
    | 'FULL_CLOSE';     // FULL_CLOSE (목표가 전량)
  quantity: number;       // 이 이벤트의 체결 수량 (불변)
  price: number;          // 이 이벤트의 체결가
  realizedPnL: number;    // 이 이벤트로 실현된 손익(원), ENTRY = 0
  cumRealizedPnL: number; // 이벤트 후 포지션 누적 실현 손익
  remainingQty: number;   // 이벤트 후 잔여 수량
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

let _evtSeq = 0;
function newEventId(): string {
  return `evt_${Date.now()}_${(++_evtSeq).toString(36).padStart(5, '0')}`;
}

function kstYYYYMM(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7).replace('-', '');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * TradeEvent를 월별 JSONL 파일에 append-only로 기록한다.
 * 같은 프로세스 내에서 id 충돌 없음이 보장된다.
 */
export function appendTradeEvent(event: Omit<TradeEvent, 'id'>): TradeEvent {
  ensureDataDir();
  const full: TradeEvent = { id: newEventId(), ...event };
  const file = tradeEventsFile(kstYYYYMM());
  fs.appendFileSync(file, JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

/**
 * 특정 포지션의 모든 TradeEvent를 시간순으로 반환한다.
 * months를 지정하지 않으면 현재 월 + 직전 월을 검색한다.
 */
export function loadTradeEventsForPosition(
  positionId: string,
  months?: string[],
): TradeEvent[] {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const cur = kst.toISOString().slice(0, 7).replace('-', '');
  const prev = new Date(kst.getFullYear(), kst.getMonth() - 1, 1)
    .toISOString().slice(0, 7).replace('-', '');
  const searchMonths = months ?? [cur, prev];

  const events: TradeEvent[] = [];
  for (const m of searchMonths) {
    const file = tradeEventsFile(m);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const e: TradeEvent = JSON.parse(line);
        if (e.positionId === positionId) events.push(e);
      } catch { /* 손상된 라인 스킵 */ }
    }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * 월 전체 이벤트 로드 (통계·리포트용).
 */
export function loadTradeEventsByMonth(yyyymm: string): TradeEvent[] {
  const file = tradeEventsFile(yyyymm);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const events: TradeEvent[] = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return events;
}
