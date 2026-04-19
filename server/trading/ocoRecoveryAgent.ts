/**
 * @responsibility OCO 등록 실패 사이드를 지수 백오프로 재시도하고 최종 실패 시 시장가 강제 청산을 발동한다
 *
 * 배경:
 *   registerOcoPair 가 양쪽 모두 실패(status='ERROR') 또는 한쪽 실패(stopStatus
 *   === 'FAILED' || profitStatus === 'FAILED') 한 채 종료되면, 포지션은 보호망
 *   없이 노출된다. 기존엔 Telegram 경보만 보내고 운영자 수동 개입을 기다렸다 —
 *   이는 자동매매 시스템의 단일 실패점.
 *
 * 정책:
 *   - 5분 주기 cron 으로 검사 대상 OCO 쌍을 스캔.
 *   - 시도 횟수별 지수 백오프: T0(즉시) → T+5분 → T+15분.
 *   - FAILED 사이드만 재등록 시도. PENDING 사이드는 건드리지 않는다.
 *   - 3회 모두 실패 시 시장가 강제 청산(STOP_LOSS 명목) 으로 포지션 완전 해소.
 *   - 모든 단계마다 Telegram 알림 (시도/성공/소진/Fallback).
 *
 * 페르소나 원칙: "매수보다 리스크 관리가 더 중요" — 보호 주문 부재는 곧 손실.
 */

import {
  type OcoOrderPair,
  readAllOcoOrders,
  writeAllOcoOrders,
} from './ocoCloseLoop.js';
import {
  placeKisStopLossLimitOrder,
  placeKisTakeProfitLimitOrder,
  placeKisSellOrder,
  KIS_IS_REAL,
} from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ─── 정책 상수 ────────────────────────────────────────────────────────────────

/** 최대 재시도 횟수 — 도달 후엔 시장가 fallback. */
export const OCO_RECOVERY_MAX_ATTEMPTS = 3;

/**
 * 시도 N(1-based) 직전에 기다릴 최소 분(分).
 * attempt=1: 0분(즉시), attempt=2: 5분, attempt=3: 15분.
 */
export const OCO_RECOVERY_BACKOFF_MINUTES = [0, 5, 15] as const;

// ─── 판정 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * 복구 대상 여부.
 *   - status === 'ERROR' (양쪽 모두 실패)
 *   - status === 'ACTIVE' AND (stopStatus === 'FAILED' OR profitStatus === 'FAILED')
 *
 * 이미 RECOVERED / FALLBACK_DONE 인 쌍은 제외.
 */
export function needsRecovery(pair: OcoOrderPair): boolean {
  if (pair.recovery?.status === 'RECOVERED') return false;
  if (pair.recovery?.status === 'FALLBACK_DONE') return false;

  if (pair.status === 'ERROR') return true;
  if (pair.status === 'ACTIVE' &&
      (pair.stopStatus === 'FAILED' || pair.profitStatus === 'FAILED')) {
    return true;
  }
  return false;
}

/**
 * 다음 시도 가능 시각이 됐는가?
 * attempts=0 (최초 발견)이면 즉시 가능. 아니면 lastAttemptAt + backoff 가 지났을 때.
 */
export function isReadyForRetry(pair: OcoOrderPair, nowMs: number = Date.now()): boolean {
  const rec = pair.recovery;
  if (!rec || rec.attempts === 0) return true;
  if (rec.attempts >= OCO_RECOVERY_MAX_ATTEMPTS) return true; // fallback 라운드도 즉시
  if (!rec.lastAttemptAt) return true;

  const backoffMin = OCO_RECOVERY_BACKOFF_MINUTES[rec.attempts] ?? 15;
  const elapsedMs = nowMs - new Date(rec.lastAttemptAt).getTime();
  return elapsedMs >= backoffMin * 60_000;
}

// ─── 단일 쌍 복구 시도 ───────────────────────────────────────────────────────

/**
 * 한 쌍에 대해 1라운드 복구를 수행한다.
 * - FAILED 사이드만 재등록.
 * - 양쪽 모두 PENDING 으로 회복되면 status='ACTIVE', recovery.status='RECOVERED'.
 * - 3회 시도 후에도 한쪽 이상 FAILED 면 시장가 강제 청산.
 *
 * 반환: 변경이 있었으면 true.
 */
async function recoverOnePair(pair: OcoOrderPair): Promise<boolean> {
  const rec: OcoRecoveryStateInternal = pair.recovery
    ? { ...pair.recovery }
    : { attempts: 0, status: 'AWAITING' };

  // 이미 한도 도달 — fallback 발동
  if (rec.attempts >= OCO_RECOVERY_MAX_ATTEMPTS) {
    return await runMarketOrderFallback(pair, rec);
  }

  rec.attempts += 1;
  rec.lastAttemptAt = new Date().toISOString();
  rec.status = 'IN_PROGRESS';
  pair.recovery = rec;

  console.log(
    `[OcoRecovery] ${pair.stockName}(${pair.stockCode}) ` +
    `attempt ${rec.attempts}/${OCO_RECOVERY_MAX_ATTEMPTS} — ` +
    `stopStatus=${pair.stopStatus} profitStatus=${pair.profitStatus}`,
  );

  let stopRetryOk: boolean | null = null;
  let profitRetryOk: boolean | null = null;
  const errors: string[] = [];

  // 손절 사이드 재시도
  if (pair.stopStatus === 'FAILED') {
    try {
      const newOrdNo = await placeKisStopLossLimitOrder(
        pair.stockCode, pair.stockName, pair.quantity, pair.stopPrice,
      );
      if (newOrdNo) {
        pair.stopOrdNo = newOrdNo;
        pair.stopStatus = 'PENDING';
        stopRetryOk = true;
      } else {
        stopRetryOk = false;
        errors.push('stop: KIS 응답 ODNO 없음');
      }
    } catch (e) {
      stopRetryOk = false;
      errors.push(`stop: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 익절 사이드 재시도
  if (pair.profitStatus === 'FAILED') {
    try {
      const newOrdNo = await placeKisTakeProfitLimitOrder(
        pair.stockCode, pair.stockName, pair.quantity, pair.profitPrice,
      );
      if (newOrdNo) {
        pair.profitOrdNo = newOrdNo;
        pair.profitStatus = 'PENDING';
        profitRetryOk = true;
      } else {
        profitRetryOk = false;
        errors.push('profit: KIS 응답 ODNO 없음');
      }
    } catch (e) {
      profitRetryOk = false;
      errors.push(`profit: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 결과 판정 ─────────────────────────────────────────────────────────────
  const bothPending = pair.stopStatus === 'PENDING' && pair.profitStatus === 'PENDING';

  if (bothPending) {
    pair.status = 'ACTIVE';
    rec.status = 'RECOVERED';
    rec.lastError = undefined;
    pair.recovery = rec;
    await sendTelegramAlert(
      `🛡️ <b>[OCO 복구 성공]</b> ${pair.stockName} (${pair.stockCode})\n` +
      `시도 ${rec.attempts}/${OCO_RECOVERY_MAX_ATTEMPTS} 회 만에 양쪽 보호 주문 재등록 완료.\n` +
      `손절 ${pair.stopPrice.toLocaleString()}원 / 익절 ${pair.profitPrice.toLocaleString()}원`,
      { priority: 'HIGH' },
    ).catch(console.error);
    return true;
  }

  // 일부만 회복했거나 모두 실패
  rec.status = rec.attempts >= OCO_RECOVERY_MAX_ATTEMPTS ? 'EXHAUSTED' : 'AWAITING';
  rec.lastError = errors.join(' | ') || '결과 불명';
  pair.recovery = rec;

  if (rec.attempts >= OCO_RECOVERY_MAX_ATTEMPTS) {
    // 한도 소진 — 즉시 fallback
    await sendTelegramAlert(
      `🚨 <b>[OCO 복구 한도 소진]</b> ${pair.stockName} (${pair.stockCode})\n` +
      `${OCO_RECOVERY_MAX_ATTEMPTS}회 모두 실패. 시장가 강제 청산을 시도합니다.\n` +
      `오류: ${rec.lastError}`,
      { priority: 'CRITICAL' },
    ).catch(console.error);
    return await runMarketOrderFallback(pair, rec);
  }

  await sendTelegramAlert(
    `⚠️ <b>[OCO 복구 시도 ${rec.attempts}/${OCO_RECOVERY_MAX_ATTEMPTS}]</b> ${pair.stockName}\n` +
    `stop=${stopRetryOk === null ? 'OK유지' : stopRetryOk ? '재등록 OK' : '실패'} / ` +
    `profit=${profitRetryOk === null ? 'OK유지' : profitRetryOk ? '재등록 OK' : '실패'}\n` +
    `다음 시도: ~${OCO_RECOVERY_BACKOFF_MINUTES[rec.attempts] ?? 15}분 뒤`,
    { priority: 'CRITICAL' },
  ).catch(console.error);

  return true; // 어쨌든 recovery 상태가 갱신되었으니 저장
}

// ─── 시장가 강제 청산 fallback ───────────────────────────────────────────────

type OcoRecoveryStateInternal = NonNullable<OcoOrderPair['recovery']>;

/**
 * 3회 OCO 재등록 모두 실패한 경우의 최후 안전장치.
 * 시장가로 즉시 매도하여 보호 주문 부재 노출을 종료한다.
 */
async function runMarketOrderFallback(
  pair: OcoOrderPair,
  rec: OcoRecoveryStateInternal,
): Promise<boolean> {
  console.warn(`[OcoRecovery] 🚨 시장가 fallback 발동: ${pair.stockName}(${pair.stockCode}) × ${pair.quantity}주`);

  const result = await placeKisSellOrder(
    pair.stockCode, pair.stockName, pair.quantity, 'STOP_LOSS',
  );

  // Shadow / KIS 미설정 시 placed=false 가 정상 — 이미 placeKisSellOrder 가 알림 발송.
  rec.status = 'FALLBACK_DONE';
  rec.lastAttemptAt = new Date().toISOString();
  pair.recovery = rec;

  // 잔여 OCO 주문 상태를 정리: PENDING 사이드는 더 이상 의미 없음(시장가로 청산)
  // 하지만 KIS 측 미체결 주문은 다음 pollOcoSurvival 사이클이 정리한다.
  pair.status = 'BOTH_CANCELLED';
  pair.resolvedAt = new Date().toISOString();

  await sendTelegramAlert(
    `🛑 <b>[OCO Fallback 발동] ${pair.stockName} (${pair.stockCode})</b>\n` +
    `${OCO_RECOVERY_MAX_ATTEMPTS}회 OCO 재등록 실패 → 시장가 강제 청산 ${result.placed ? '주문 완료' : '시도(Shadow/미설정)'}.\n` +
    `ODNO: ${result.ordNo ?? 'N/A'} | 운영자는 KIS 미체결 잔여 OCO 수동 정리 권장.`,
    { priority: 'CRITICAL' },
  ).catch(console.error);

  return true;
}

// ─── 메인 라운드 — scheduler 가 5분 주기로 호출 ──────────────────────────────

/**
 * 모든 활성 OCO 쌍을 스캔하고 복구 대상에 대해 1라운드 시도한다.
 * scheduler/tradeFlowJobs 에서 cron('*\/5 0-6 * * 1-5') 으로 호출.
 */
export async function runOcoRecoveryRound(): Promise<void> {
  if (!process.env.KIS_APP_KEY) return;
  if (!KIS_IS_REAL) return; // Shadow 모드는 OCO 미등록이라 복구 대상 없음

  const orders = readAllOcoOrders();
  const candidates = orders.filter(needsRecovery);
  if (candidates.length === 0) return;

  console.log(`[OcoRecovery] 복구 대상 ${candidates.length}건 검사`);

  const now = Date.now();
  let changed = false;
  for (const pair of candidates) {
    if (!isReadyForRetry(pair, now)) continue;
    try {
      const updated = await recoverOnePair(pair);
      if (updated) changed = true;
    } catch (e) {
      console.error(`[OcoRecovery] 라운드 오류 ${pair.stockName}:`, e instanceof Error ? e.message : e);
    }
  }

  if (changed) writeAllOcoOrders(orders);
}
