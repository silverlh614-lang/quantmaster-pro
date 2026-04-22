/**
 * reconcileQuantityDrift.ts — 기존 quantity 캐시 꼬임 일회성 교정 스크립트
 *
 * 적용 배경:
 *   exitEngine.reserveSell 에 syncPositionCache 가 없던 시절, RRR/Tranche 등
 *   부분 매도 경로에서 fills 엔 SELL 이 들어갔지만 trade.quantity 캐시가
 *   업데이트되지 않은 포지션이 남아있다. 패치 배포 후 한 번만 실행하여
 *   SSOT(fills)를 기준으로 quantity·status 를 일괄 교정한다.
 *
 * 사용법 (Railway Shell 또는 서버 npm 스크립트):
 *   npx tsx server/scripts/reconcileQuantityDrift.ts
 *
 * 안전 장치:
 *   - 변경 전 shadow-trades.json.backup-<timestamp> 로 전량 백업.
 *   - dry-run 모드(인자 --dry-run): 변경 사항만 출력하고 저장하지 않음.
 *   - fills 가 없는 레거시 포지션은 건드리지 않음 (syncPositionCache 와 동일 정책).
 */

import fs from 'fs';
import path from 'path';
import {
  loadShadowTrades,
  saveShadowTrades,
  getRemainingQty,
  syncPositionCache,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { SHADOW_FILE } from '../persistence/paths.js';

interface DriftReport {
  id: string;
  stockCode: string;
  stockName: string;
  before: { quantity: number; status: string };
  after:  { quantity: number; status: string };
  fillsSummary: string;
}

/** fills 가 모두 확정(REVERTED 제외) 된 상태에서 잔량 0 이면 closed 상태로 전이. */
function deriveStatusFromFills(trade: ServerShadowTrade): ServerShadowTrade['status'] {
  const remaining = getRemainingQty(trade);
  if (remaining > 0) return trade.status; // 부분 청산 — 기존 status 유지
  // 잔량 0 — SELL fill 의 subType 으로 HIT_TARGET/HIT_STOP 판정
  const sells = (trade.fills ?? []).filter(f => f.type === 'SELL' && f.status !== 'REVERTED');
  const lastSell = sells[sells.length - 1];
  if (!lastSell) return trade.status;
  // STOP_LOSS/EMERGENCY → HIT_STOP / PARTIAL_TP·TRAILING_TP·FULL_CLOSE → HIT_TARGET
  if (lastSell.subType === 'STOP_LOSS' || lastSell.subType === 'EMERGENCY') return 'HIT_STOP';
  return 'HIT_TARGET';
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const trades = loadShadowTrades();

  // 백업
  const backupPath = `${SHADOW_FILE}.backup-${Date.now()}`;
  if (!dryRun) {
    fs.copyFileSync(SHADOW_FILE, backupPath);
    console.log(`[Reconcile] 백업: ${path.basename(backupPath)}`);
  }

  const reports: DriftReport[] = [];

  for (const t of trades) {
    const before = { quantity: t.quantity, status: t.status };
    const ssotRemaining = getRemainingQty(t);

    // fills 가 없으면 레거시 — 건드리지 않음
    const hasFills = (t.fills ?? []).length > 0;
    if (!hasFills) continue;

    // quantity 교정
    const changed = syncPositionCache(t);

    // 잔량 0 인데 status 가 open 이면 closed 로 전이
    const openStatuses = new Set(['ACTIVE', 'PARTIALLY_FILLED', 'EUPHORIA_PARTIAL', 'PENDING', 'ORDER_SUBMITTED']);
    if (ssotRemaining === 0 && openStatuses.has(t.status)) {
      t.status = deriveStatusFromFills(t);
      // exitTime/exitPrice 누락 시 마지막 SELL 로 보완
      const lastSell = (t.fills ?? []).filter(f => f.type === 'SELL' && f.status !== 'REVERTED').slice(-1)[0];
      if (lastSell) {
        t.exitTime  ??= lastSell.timestamp;
        t.exitPrice ??= lastSell.price;
      }
    }

    const statusChanged = t.status !== before.status;
    if (changed || statusChanged) {
      const fillsSummary = (t.fills ?? [])
        .map(f => `${f.type}:${f.qty}@${f.price}${f.status ? `[${f.status}]` : ''}`)
        .join(' · ');
      reports.push({
        id: t.id,
        stockCode: t.stockCode,
        stockName: t.stockName,
        before,
        after: { quantity: t.quantity, status: t.status },
        fillsSummary,
      });
    }
  }

  if (reports.length === 0) {
    console.log('[Reconcile] 교정 대상 없음 — 모든 포지션이 SSOT 와 일치합니다.');
    return;
  }

  console.log(`[Reconcile] 교정 대상: ${reports.length}건${dryRun ? ' (DRY-RUN)' : ''}`);
  for (const r of reports) {
    console.log(
      `  ${r.stockName}(${r.stockCode}) ` +
      `수량 ${r.before.quantity} → ${r.after.quantity} · ` +
      `상태 ${r.before.status} → ${r.after.status}\n    fills: ${r.fillsSummary}`,
    );
  }

  if (!dryRun) {
    saveShadowTrades(trades);
    console.log('[Reconcile] 저장 완료. 롤백 필요 시 백업 파일을 복원하세요.');
  } else {
    console.log('[Reconcile] DRY-RUN — 저장하지 않았습니다. --dry-run 제거하여 실제 적용.');
  }
}

main();
