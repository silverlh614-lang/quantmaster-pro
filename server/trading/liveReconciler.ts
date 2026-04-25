/**
 * @responsibility ADR-0015 LIVE KIS 잔고 vs 로컬 포지션 캐시 강제 동기화 (KIS=SSOT)
 */

import {
  loadShadowTrades,
  saveShadowTrades,
  appendFill,
  syncPositionCache,
  getRemainingQty,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import {
  fetchKisHoldings,
  isKisBalanceQueryAllowed,
  KIS_IS_REAL,
  type KisHolding,
} from '../clients/kisClient.js';
import { getTradingMode } from '../state.js';

/**
 * 비교 카테고리 — ADR-0015 §결정 §충돌 처리 정책 참조.
 *
 * - MATCH            : KIS 와 로컬 일치
 * - QTY_DIVERGENCE   : 동일 종목 보유, 수량 불일치 (KIS qty != local remaining)
 * - GHOST_LOCAL      : 로컬에는 ACTIVE, KIS 에는 보유 0 (KIS 에서 청산됨)
 * - GHOST_KIS        : KIS 에 보유, 로컬에는 ACTIVE trade 없음 (체결 누락)
 */
export type LiveReconcileCategory =
  | 'MATCH' | 'QTY_DIVERGENCE' | 'GHOST_LOCAL' | 'GHOST_KIS';

export interface LiveReconcileDiff {
  category: LiveReconcileCategory;
  stockCode: string;
  stockName: string;
  /** 로컬 잔량 (없으면 null) */
  localQty: number | null;
  /** KIS 잔량 (없으면 null) */
  kisQty: number | null;
  /** 로컬 trade id (없으면 null) */
  tradeId: string | null;
  /** apply 시 실제로 변경되는지 (GHOST_KIS 는 자동 적용 안 함) */
  willApply: boolean;
  /** 사람이 읽을 수 있는 설명 */
  note: string;
}

export interface LiveReconcileResult {
  mode: 'liveDryRun' | 'liveApply';
  ranAt: string;                  // ISO timestamp
  /** KIS 조회 가능 여부 — false 면 reconcile 불가 (점검시간/회로차단/설정누락) */
  kisQueryable: boolean;
  /** KIS 조회 실패 사유 (kisQueryable=false 인 경우만) */
  unavailableReason?: string;
  /** KIS 보유 종목 수 (조회 성공 시) */
  kisHoldingCount: number;
  /** 로컬 ACTIVE LIVE trade 수 */
  localActiveCount: number;
  /** 카테고리별 카운트 */
  summary: Record<LiveReconcileCategory, number>;
  /** apply 모드에서 실제 변경된 trade 수 */
  appliedCount: number;
  diffs: LiveReconcileDiff[];
}

const OPEN_STATUSES: ReadonlySet<ServerShadowTrade['status']> = new Set([
  'PENDING', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'ACTIVE', 'EUPHORIA_PARTIAL',
]);

/**
 * KIS 잔고 조회 가능 여부 + 사유. ADR-0015 안전장치 §3 — fail-closed.
 *
 * 다음 경우 reconcile 자체를 진행하지 않는다:
 *   - LIVE 모드 아님 (KIS_IS_REAL=false 또는 런타임 SHADOW 강등)
 *   - KIS_APP_KEY 미설정
 *   - KIS 점검 시간대 (KST 02~07) — isKisBalanceQueryAllowed=false
 */
function checkPrecondition(): { ok: true } | { ok: false; reason: string } {
  if (!KIS_IS_REAL) {
    return { ok: false, reason: 'KIS_IS_REAL=false (모의계좌 모드 — LIVE reconcile 불가)' };
  }
  if (getTradingMode() !== 'LIVE') {
    return { ok: false, reason: `런타임 모드 ${getTradingMode()} (SHADOW 강등 상태)` };
  }
  if (!process.env.KIS_APP_KEY) {
    return { ok: false, reason: 'KIS_APP_KEY 미설정' };
  }
  if (!isKisBalanceQueryAllowed()) {
    return { ok: false, reason: 'KIS 잔고 조회 불가 시간대 (KST 02~07 정기점검 또는 KIS_ACCOUNT_BALANCE_DISABLE=true)' };
  }
  return { ok: true };
}

/**
 * 로컬 ACTIVE LIVE trade 와 KIS 보유 포지션 비교 결과를 계산한다.
 * 적용 자체는 수행하지 않는다 — diff 만 반환.
 */
function diffHoldings(
  localTrades: ServerShadowTrade[],
  kisHoldings: KisHolding[],
): LiveReconcileDiff[] {
  // LIVE 모드 + ACTIVE 계열 trade 만 대상.
  // mode 미설정(레거시)은 LIVE 와 동일 취급 — KIS_IS_REAL=true 환경에서 SHADOW 명시 없으면 LIVE.
  const localActive = localTrades.filter((t) =>
    OPEN_STATUSES.has(t.status) && t.mode !== 'SHADOW' && getRemainingQty(t) > 0,
  );

  const diffs: LiveReconcileDiff[] = [];

  // KIS 종목 → KisHolding 인덱스 (최신 조회 결과 기준).
  const kisByCode = new Map<string, KisHolding>();
  for (const h of kisHoldings) kisByCode.set(h.pdno, h);

  // 로컬 → KIS 비교 (MATCH / QTY_DIVERGENCE / GHOST_LOCAL).
  // 동일 종목 다중 trade 케이스: KIS 는 종목당 1행이므로 로컬 합산 vs KIS qty 비교.
  const localByCode = new Map<string, ServerShadowTrade[]>();
  for (const t of localActive) {
    const list = localByCode.get(t.stockCode) ?? [];
    list.push(t);
    localByCode.set(t.stockCode, list);
  }

  for (const [code, trades] of localByCode.entries()) {
    const localTotalQty = trades.reduce((s, t) => s + getRemainingQty(t), 0);
    const kisHolding = kisByCode.get(code);
    const stockName = trades[0].stockName;
    // 동일 종목 다중 trade 케이스: 가장 오래된(첫) trade 의 id 를 대표로 노출.
    const tradeId = trades[0].id;

    if (!kisHolding) {
      diffs.push({
        category: 'GHOST_LOCAL',
        stockCode: code,
        stockName,
        localQty: localTotalQty,
        kisQty: 0,
        tradeId,
        willApply: true,
        note: `로컬 ${trades.length}건 ACTIVE (총 ${localTotalQty}주) — KIS 잔고 0주. apply 시 SELL fill 추가로 청산 처리.`,
      });
      continue;
    }

    if (kisHolding.hldgQty === localTotalQty) {
      diffs.push({
        category: 'MATCH',
        stockCode: code,
        stockName,
        localQty: localTotalQty,
        kisQty: kisHolding.hldgQty,
        tradeId,
        willApply: false,
        note: '일치',
      });
    } else {
      diffs.push({
        category: 'QTY_DIVERGENCE',
        stockCode: code,
        stockName,
        localQty: localTotalQty,
        kisQty: kisHolding.hldgQty,
        tradeId,
        willApply: true,
        note: `로컬 ${localTotalQty}주 ↔ KIS ${kisHolding.hldgQty}주. apply 시 차이만큼 SELL/BUY fill 추가로 정합.`,
      });
    }
  }

  // KIS → 로컬 비교 (GHOST_KIS).
  for (const h of kisHoldings) {
    if (localByCode.has(h.pdno)) continue;
    diffs.push({
      category: 'GHOST_KIS',
      stockCode: h.pdno,
      stockName: h.prdtName || h.pdno,
      localQty: 0,
      kisQty: h.hldgQty,
      tradeId: null,
      willApply: false,
      note: `KIS 잔고 ${h.hldgQty}주 — 로컬 trade 없음. 자동 적용 차단(메타 손실 위험). 운영자가 수동 진입 등록 필요.`,
    });
  }

  return diffs;
}

/**
 * QTY_DIVERGENCE / GHOST_LOCAL 을 SELL/BUY fill 추가로 적용한다.
 *
 * - GHOST_LOCAL (로컬>0, KIS=0): 로컬 잔량 전체에 대해 SELL fill 추가 → trade 청산.
 *   가격은 KIS 가 알려주지 않으므로 entryPrice 사용 (PnL 0 으로 기록 — 실제 청산가는
 *   사용자가 KIS HTS 에서 확인 후 별도 보정).
 * - QTY_DIVERGENCE (로컬>KIS): 차이만큼 SELL fill 추가.
 * - QTY_DIVERGENCE (로컬<KIS): 차이만큼 BUY fill 추가 (체결 누락 보정). 가격은 KIS
 *   pchsAvgPric 사용.
 *
 * 대표 trade 1건에만 적용 — 동일 종목 다중 trade 시 운영자가 수동 분배 필요.
 *
 * @returns 변경된 trade 개수
 */
function applyDiffs(
  trades: ServerShadowTrade[],
  diffs: LiveReconcileDiff[],
  kisHoldings: KisHolding[],
): number {
  const tradeById = new Map(trades.map((t) => [t.id, t] as const));
  const kisByCode = new Map(kisHoldings.map((h) => [h.pdno, h] as const));
  const ranAt = new Date().toISOString();
  let applied = 0;

  for (const d of diffs) {
    if (!d.willApply || !d.tradeId) continue;
    const t = tradeById.get(d.tradeId);
    if (!t) continue;

    if (d.category === 'GHOST_LOCAL' && d.localQty && d.localQty > 0) {
      appendFill(t, {
        type: 'SELL',
        qty: d.localQty,
        price: t.shadowEntryPrice,
        reason: 'KIS 잔고 0 — 외부 청산 추정 (RECONCILE_GHOST_LOCAL)',
        timestamp: ranAt,
        status: 'CONFIRMED',
        confirmedAt: ranAt,
        exitRuleTag: 'RECONCILE_GHOST_LOCAL',
      });
      t.status = 'HIT_STOP';
      t.exitTime = ranAt;
      t.exitPrice = t.shadowEntryPrice;
      syncPositionCache(t);
      applied++;
      continue;
    }

    if (d.category === 'QTY_DIVERGENCE' && d.localQty !== null && d.kisQty !== null) {
      const diff = d.kisQty - d.localQty;
      const kisHolding = kisByCode.get(d.stockCode);
      const refPrice = kisHolding?.pchsAvgPric ?? t.shadowEntryPrice;
      if (diff < 0) {
        appendFill(t, {
          type: 'SELL',
          qty: -diff,
          price: refPrice,
          reason: `로컬>KIS 차이 보정: -${-diff}주 (RECONCILE_QTY_DIVERGENCE)`,
          timestamp: ranAt,
          status: 'CONFIRMED',
          confirmedAt: ranAt,
          exitRuleTag: 'RECONCILE_QTY_DIVERGENCE',
        });
      } else if (diff > 0) {
        appendFill(t, {
          type: 'BUY',
          qty: diff,
          price: refPrice,
          reason: `로컬<KIS 차이 보정: +${diff}주 (RECONCILE_QTY_DIVERGENCE)`,
          timestamp: ranAt,
          status: 'CONFIRMED',
          confirmedAt: ranAt,
        });
      }
      syncPositionCache(t);
      // 잔량 0 으로 줄어든 경우만 closed 마킹 (KIS 가 줄인 케이스).
      if (getRemainingQty(t) === 0 && OPEN_STATUSES.has(t.status)) {
        t.status = 'HIT_STOP';
        t.exitTime = ranAt;
        t.exitPrice = refPrice;
      }
      applied++;
    }
  }

  return applied;
}

/**
 * LIVE 포지션 재동기화 진입점. dryRun=true 면 변경 없이 diff 만, false 면 적용 후 저장.
 */
export async function reconcileLivePositions(
  opts: { dryRun?: boolean } = {},
): Promise<LiveReconcileResult> {
  const dryRun = opts.dryRun !== false; // 기본 dry-run
  const ranAt = new Date().toISOString();
  const empty: LiveReconcileResult = {
    mode: dryRun ? 'liveDryRun' : 'liveApply',
    ranAt,
    kisQueryable: false,
    kisHoldingCount: 0,
    localActiveCount: 0,
    summary: { MATCH: 0, QTY_DIVERGENCE: 0, GHOST_LOCAL: 0, GHOST_KIS: 0 },
    appliedCount: 0,
    diffs: [],
  };

  const pre = checkPrecondition();
  if (!pre.ok) {
    return { ...empty, unavailableReason: pre.reason };
  }

  const kisHoldings = await fetchKisHoldings();
  if (kisHoldings === null) {
    // 회로차단·5xx·기타 — 로컬 데이터 보호 위해 변경 없이 종료.
    return { ...empty, unavailableReason: 'KIS 잔고 조회 실패 (회로차단·5xx·네트워크). 로컬 변경 없음.' };
  }

  const trades = loadShadowTrades();
  const diffs = diffHoldings(trades, kisHoldings);

  const localActive = trades.filter((t) =>
    OPEN_STATUSES.has(t.status) && t.mode !== 'SHADOW' && getRemainingQty(t) > 0,
  ).length;

  const summary: Record<LiveReconcileCategory, number> = {
    MATCH: 0, QTY_DIVERGENCE: 0, GHOST_LOCAL: 0, GHOST_KIS: 0,
  };
  for (const d of diffs) summary[d.category]++;

  let appliedCount = 0;
  if (!dryRun) {
    appliedCount = applyDiffs(trades, diffs, kisHoldings);
    if (appliedCount > 0) saveShadowTrades(trades);
  }

  return {
    mode: dryRun ? 'liveDryRun' : 'liveApply',
    ranAt,
    kisQueryable: true,
    kisHoldingCount: kisHoldings.length,
    localActiveCount: localActive,
    summary,
    appliedCount,
    diffs,
  };
}

// ─── 테스트 전용 export (ADR-0015) ──────────────────────────────────────────
// 런타임 코드 호출 대상이 아님 — 단위 테스트에서 내부 pure 헬퍼 검증용.
export const __testOnly = {
  diffHoldings,
  applyDiffs,
};

/** 텍스트 요약 — 텔레그램 메시지용. */
export function formatLiveReconcileResult(result: LiveReconcileResult): string {
  if (!result.kisQueryable) {
    return (
      `❌ <b>[LIVE Reconcile 불가]</b>\n` +
      `사유: ${result.unavailableReason ?? 'unknown'}\n\n` +
      `KIS 잔고 조회가 불가능한 상태에서는 reconcile 을 실행하지 않습니다 (로컬 데이터 보호).`
    );
  }

  const modeBadge = result.mode === 'liveApply' ? '⚡ <b>[LIVE Reconcile — 적용]</b>' : '🔍 <b>[LIVE Reconcile — DRY-RUN]</b>';
  const head =
    `${modeBadge}\n` +
    `KIS 보유: ${result.kisHoldingCount}개 | 로컬 ACTIVE: ${result.localActiveCount}개\n` +
    `MATCH ${result.summary.MATCH} | QTY_DIVERGENCE ${result.summary.QTY_DIVERGENCE} | ` +
    `GHOST_LOCAL ${result.summary.GHOST_LOCAL} | GHOST_KIS ${result.summary.GHOST_KIS}\n` +
    (result.mode === 'liveApply' ? `적용: ${result.appliedCount}건\n` : '');

  const actionable = result.diffs.filter((d) => d.category !== 'MATCH');
  if (actionable.length === 0) {
    return head + `\n✅ 모든 포지션이 KIS 와 일치합니다.`;
  }

  const lines = actionable.slice(0, 20).map((d) => {
    const icon =
      d.category === 'QTY_DIVERGENCE' ? '⚠️' :
      d.category === 'GHOST_LOCAL'   ? '👻' :
                                        '❓';
    return `${icon} <code>${d.stockCode}</code> ${d.stockName}\n   ${d.note}`;
  });
  const tail = actionable.length > 20 ? `\n…외 ${actionable.length - 20}건` : '';

  const hint = result.mode === 'liveDryRun'
    ? `\n\n💡 적용: <code>/reconcile live apply</code>`
    : '';

  return head + `\n` + lines.join('\n') + tail + hint;
}
