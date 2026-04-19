/**
 * preMarketSmokeTest.ts — Phase 2차 C7: 장 시작 전 스모크 테스트 게이트.
 *
 * 08:45 KST 자동 실행. 하나라도 실패하면 `setSmokeTestLiveBlocked(true)` 로
 * LIVE 주문 경로를 차단한다. Shadow 학습 루프는 멈추지 않는다 — 버그가 실주문
 * 직전 단계에서 걸려 넘어지도록 하는 게 목적.
 *
 * 테스트 항목:
 *   1. 가상 주문 파라미터 → assertSafeOrder 통과 확인
 *      (스모크 테스트 자체가 가드에 걸리면 안 됨 → 가이드라인 확인)
 *   2. KIS 토큰 유효성 — refreshKisToken() + getKisTokenRemainingHours() > 0
 *   3. Shadow 파이프라인 mock 실행 — evaluateServerGate 가 알려진 입력에 대해
 *      null 을 반환하지 않고 통과.
 *
 * 실패 시: setSmokeTestLiveBlocked(true) + incident + Telegram HIGH.
 * 성공 시: setSmokeTestLiveBlocked(false) 자동 해제.
 */

import { refreshKisToken, getKisTokenRemainingHours } from '../clients/kisClient.js';
import { setSmokeTestLiveBlocked } from '../state.js';
import { runCanaryCases } from '../learning/mutationCanary.js';
import { recordIncident } from '../persistence/incidentLogRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

export interface SmokeTestResult {
  ok: boolean;
  passed: string[];
  failed: Array<{ check: string; reason: string }>;
}

export async function runPreMarketSmokeTest(): Promise<SmokeTestResult> {
  const passed: string[] = [];
  const failed: Array<{ check: string; reason: string }> = [];

  // 1) KIS 토큰 유효성
  try {
    const token = await refreshKisToken();
    if (!token || typeof token !== 'string' || token.length < 16) {
      failed.push({ check: 'kis-token', reason: `비정상 토큰 값 (length=${token?.length ?? 0})` });
    } else {
      const hours = getKisTokenRemainingHours();
      if (hours <= 0) {
        failed.push({ check: 'kis-token', reason: `토큰 만료됨 (remaining=${hours}h)` });
      } else {
        passed.push(`kis-token (${hours}h 남음)`);
      }
    }
  } catch (e) {
    failed.push({ check: 'kis-token', reason: e instanceof Error ? e.message : String(e) });
  }

  // 2) 판단 로직 카나리아 — Shadow 파이프라인 mock 실행에 해당.
  //    재사용으로 중복을 피하고 mutationCanary 와 계약을 일치시킨다.
  try {
    const results = runCanaryCases();
    const canaryFailures = results.filter(r => !r.ok);
    if (canaryFailures.length > 0) {
      for (const f of canaryFailures) {
        failed.push({ check: `canary-${f.label}`, reason: f.mismatch ?? 'mismatch' });
      }
    } else {
      passed.push(`canary (${results.length}/${results.length})`);
    }
  } catch (e) {
    failed.push({ check: 'canary', reason: e instanceof Error ? e.message : String(e) });
  }

  // 3) 가상 주문 파라미터 검증 — 정상 입력은 가드에 걸리면 안 된다.
  //    가드가 정상 입력도 막는다면 시스템 전체가 무의미하게 잠김.
  try {
    const { assertSafeOrder, _resetRecentOrders } = await import('./preOrderGuard.js');
    _resetRecentOrders(); // 스모크 테스트 직전 이력 초기화 — 장중 카운터 오염 방지
    assertSafeOrder({
      stockCode:   '000000',
      stockName:   'SMOKE',
      quantity:    1,
      entryPrice:  10000,
      stopLoss:    9500,
      totalAssets: 100_000_000,
    });
    _resetRecentOrders();
    passed.push('pre-order-guard (허용 입력 통과)');
  } catch (e) {
    failed.push({ check: 'pre-order-guard', reason: e instanceof Error ? e.message : String(e) });
  }

  const ok = failed.length === 0;
  if (ok) {
    setSmokeTestLiveBlocked(false);
    console.log(`[SmokeTest] ✅ ${passed.length}/${passed.length + failed.length} 통과`);
    await sendTelegramAlert(
      `🧪 <b>[Pre-Market Smoke Test] 통과</b>\n` +
      passed.map(p => `  ✅ ${p}`).join('\n') +
      `\n\n당일 LIVE 주문 경로 허용.`,
      { priority: 'LOW', dedupeKey: `smoke-test-pass-${new Date().toISOString().slice(0, 10)}` },
    ).catch(console.error);
  } else {
    const reason = failed.map(f => `${f.check}: ${f.reason}`).join(' | ');
    setSmokeTestLiveBlocked(true, reason);
    recordIncident('preMarketSmokeTest', `smoke-test failed: ${reason}`, 'HIGH', {
      failedCount: failed.length,
    });
    await sendTelegramAlert(
      `🧪 <b>[Pre-Market Smoke Test] 실패 — LIVE 차단</b>\n` +
      failed.map(f => `  ❌ ${f.check}: ${f.reason}`).join('\n') +
      `\n\n당일 LIVE 주문은 전면 차단됩니다. Shadow 루프는 계속 동작. ` +
      `원인 수정 후 다음 날 08:45 스모크 테스트 통과 시 자동 해제.`,
      { priority: 'HIGH', dedupeKey: `smoke-test-fail-${new Date().toISOString().slice(0, 10)}` },
    ).catch(console.error);
  }
  return { ok, passed, failed };
}
