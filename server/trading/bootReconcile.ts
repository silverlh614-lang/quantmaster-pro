// @responsibility: 부팅 30초 후 LIVE reconcile dry-run — 재배포 직후 KIS 잔고와 로컬 장부 mismatch 조기 감지.
//
// 배경: maintenanceJobs 가 매일 1회 자동 reconcile 을 돌지만 재배포 직후 ~24시간 동안은
// mismatch 가 누적될 수 있다. Railway 는 자주 재배포되는 환경 — 부팅 직후 1회 dry-run 으로
// 차이를 즉시 표면화한다 (apply 는 운영자 수동 `/reconcile live apply` 로 분리).
//
// 트리거 조건: AUTO_TRADE_MODE=LIVE + AUTO_TRADE_ENABLED=true.
// LIVE 매매 무영향 — dry-run only.
// KIS 점검시간/조회 불가 시 silent skip (채널 노이즈 방지).

import type { LiveReconcileResult } from './liveReconciler.js';

/**
 * 부팅 reconcile dry-run 트리거. server/index.ts 가 setTimeout 30s 후 1회 호출.
 *
 * fire-and-forget — 본 함수의 throw 는 호출자에게 전파되지 않는다 (catch 내부 처리).
 * 결과를 반환하는 이유는 단위 테스트가 분기를 검증할 수 있도록 하기 위함.
 *
 * @returns
 *   - `{ skipped: true, reason }` — LIVE 모드 아님 / AUTO_TRADE_ENABLED=false / KIS 조회 불가
 *   - `{ skipped: false, mismatchCount, alerted }` — dry-run 실행 완료
 *   - `{ skipped: false, error }` — 예외 발생 (조용히 흡수)
 */
export type BootReconcileOutcome =
  | { skipped: true; reason: string }
  | { skipped: false; mismatchCount: number; alerted: boolean }
  | { skipped: false; error: string };

export async function runBootReconcileDryRun(): Promise<BootReconcileOutcome> {
  // ── 트리거 조건 ────────────────────────────────────────────
  if (process.env.AUTO_TRADE_MODE !== 'LIVE') {
    return { skipped: true, reason: `AUTO_TRADE_MODE=${process.env.AUTO_TRADE_MODE ?? 'SHADOW'}` };
  }
  if (process.env.AUTO_TRADE_ENABLED !== 'true') {
    return { skipped: true, reason: 'AUTO_TRADE_ENABLED=false' };
  }

  let result: LiveReconcileResult;
  try {
    const { reconcileLivePositions } = await import('./liveReconciler.js');
    result = await reconcileLivePositions({ dryRun: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[BootReconcile] dry-run 실행 실패 (조용히 스킵):', msg);
    return { skipped: false, error: msg };
  }

  // KIS 조회 불가 — 점검시간/회로차단/설정누락. 정상 동작이므로 알림 없음.
  if (!result.kisQueryable) {
    return { skipped: true, reason: result.unavailableReason ?? 'KIS 조회 불가' };
  }

  // mismatch 계산: MATCH 외 모든 카테고리 합.
  const mismatchCount =
    result.summary.QTY_DIVERGENCE +
    result.summary.GHOST_LOCAL +
    result.summary.GHOST_KIS;

  if (mismatchCount === 0) {
    // 정상 — 채널 노이즈 차단.
    console.log(
      `[BootReconcile] dry-run 완료 — mismatch 0건 (KIS ${result.kisHoldingCount} / local ${result.localActiveCount})`,
    );
    return { skipped: false, mismatchCount: 0, alerted: false };
  }

  // mismatch 발견 — 운영자 즉시 통지.
  try {
    const { sendTelegramAlert } = await import('../alerts/telegramClient.js');
    const today = new Date().toISOString().slice(0, 10);
    await sendTelegramAlert(
      buildBootReconcileAlertMessage(result, mismatchCount),
      {
        priority: 'HIGH',
        dedupeKey: `boot_reconcile:${today}`,
        cooldownMs: 6 * 3600_000, // 6h — 재배포 폭주 보호
        category: 'reconcile',
      },
    );
    return { skipped: false, mismatchCount, alerted: true };
  } catch (e) {
    console.error('[BootReconcile] 텔레그램 알림 실패:', e);
    return { skipped: false, mismatchCount, alerted: false };
  }
}

/**
 * 알림 메시지 본체 — `runBootReconcileDryRun` 가 사용. 단위 테스트가 회귀 가드용으로 호출.
 */
export function buildBootReconcileAlertMessage(
  result: LiveReconcileResult,
  mismatchCount: number,
): string {
  const summary = result.summary;
  const lines: string[] = [
    `🔍 <b>[부팅 reconcile dry-run]</b>`,
    `LIVE 잔고와 로컬 장부 차이 <b>${mismatchCount}건</b> 발견`,
    `─────────────────────`,
    `KIS 보유: ${result.kisHoldingCount}종목 | 로컬 ACTIVE: ${result.localActiveCount}건`,
  ];
  if (summary.QTY_DIVERGENCE > 0) {
    lines.push(`• 수량 불일치: ${summary.QTY_DIVERGENCE}건`);
  }
  if (summary.GHOST_LOCAL > 0) {
    lines.push(`• 로컬만 ACTIVE (KIS 청산됨): ${summary.GHOST_LOCAL}건`);
  }
  if (summary.GHOST_KIS > 0) {
    lines.push(`• KIS 만 보유 (체결 누락): ${summary.GHOST_KIS}건 ⚠️`);
  }
  lines.push(``);
  lines.push(`<i>세부 확인: /reconcile live</i>`);
  lines.push(`<i>적용: /reconcile live apply (60s 가드)</i>`);
  return lines.join('\n');
}
