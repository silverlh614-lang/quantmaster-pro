// @responsibility ExitEngine 진입점 뮤텍스 + 우선순위 청산 규칙 오케스트레이터
/**
 * exitEngine/index.ts — Shadow 진행 중 거래 결과 업데이트 오케스트레이터 (ADR-0028).
 *
 * signalScanner.ts 에서 분리된 진행 중 Shadow 거래 결과 업데이트 로직.
 * 청산 규칙 우선순위는 entryEngine.ts 의 EXIT_RULE_PRIORITY_TABLE 과 일치해야 한다.
 *
 * 이 파일의 책임:
 *   1. _exitRunning 뮤텍스 (PR-6 #12 동시 실행 가드)
 *   2. PENDING→ACTIVE 승격 (SHADOW)
 *   3. fills 기반 잔량 동기화
 *   4. 16 개 청산 규칙을 EXIT_RULES_IN_ORDER 순서로 평가
 *   5. L1 학습 훅: HIT_TARGET/HIT_STOP 전이 종목을 learningOrchestrator 로 전달
 *
 * 각 청산 규칙은 rules/<name>.ts 의 파일별 단일 책임 함수다 (ADR-0028).
 */

import {
  fetchCurrentPrice,
} from '../../clients/kisClient.js';
import { getRealtimePrice } from '../../clients/kisStreamClient.js';
import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import {
  type ServerShadowTrade,
  appendShadowLog,
  appendFill,
  syncPositionCache,
  getRemainingQty,
  backfillShadowBuyFills,
} from '../../persistence/shadowTradeRepo.js';
import { captureSnapshotsForOpenTrades } from '../../learning/coldstartBootstrap.js';
import type { RegimeLevel } from '../../../src/types/core.js';
import { learningOrchestrator } from '../../orchestrator/learningOrchestrator.js';
import { requestImmediateRescan } from '../../orchestrator/adaptiveScanScheduler.js';

import type { ExitContext, ExitRule } from './types.js';
import { atrDynamicStop } from './rules/atrDynamicStop.js';
import { r6EmergencyExit } from './rules/r6EmergencyExit.js';
import { ma60DeathForceExit } from './rules/ma60DeathForceExit.js';
import { hardStopLoss } from './rules/hardStopLoss.js';
import { cascadeFinal } from './rules/cascadeFinal.js';
import { trailingPeakUpdate } from './rules/trailingPeakUpdate.js';
import { trancheTakeProfitLimit } from './rules/trancheTakeProfitLimit.js';
import { trailingStop } from './rules/trailingStop.js';
import { legacyTakeProfit } from './rules/legacyTakeProfit.js';
import { cascadeHalf } from './rules/cascadeHalf.js';
import { cascadeWarn } from './rules/cascadeWarn.js';
import { rrrCollapseExit } from './rules/rrrCollapseExit.js';
import { bearishDivergenceExit } from './rules/bearishDivergenceExit.js';
import { ma60DeathWatch } from './rules/ma60DeathWatch.js';
import { stopApproachAlert } from './rules/stopApproachAlert.js';
import { euphoriaPartialExit } from './rules/euphoriaPartialExit.js';

/**
 * 청산 규칙 우선순위 테이블 (entryEngine.ts EXIT_RULE_PRIORITY_TABLE 과 일치).
 * 첫 번째로 `skipRest=true` 를 반환하는 규칙이 이 shadow 의 평가를 종료시킨다.
 *
 * ATR 동적 손절은 hardStopLossUpdate 를 반환해 후속 규칙(하드스톱/RRR/손절접근)
 * 에 갱신된 임계를 전파한다.
 */
const EXIT_RULES_IN_ORDER: ExitRule[] = [
  atrDynamicStop,           // 1. ATR 동적 손절 갱신 (BEP / Lock-in)
  r6EmergencyExit,          // 2. R6 긴급 30%
  ma60DeathForceExit,       // 3. MA60 역배열 5영업일 만료 시 전량
  hardStopLoss,             // 4. 고정/레짐/Profit Protection 손절
  cascadeFinal,             // 5. -25% 전량 / -30% 블랙리스트
  trailingPeakUpdate,       // 6. L3-a 트레일링 고점 갱신
  trancheTakeProfitLimit,   // 7. L3-b LIMIT 분할 익절
  trailingStop,             // 8. L3-c 트레일링 스톱
  legacyTakeProfit,         // 9. TARGET_EXIT (트랜치 미설정 fallback)
  cascadeHalf,              // 10. -15% 50% 반매도
  cascadeWarn,              // 11. -7% 추가매수 차단
  rrrCollapseExit,          // 12. RRR 붕괴 50%
  bearishDivergenceExit,    // 13. 하락 다이버전스 30%
  ma60DeathWatch,           // 14. MA60 역배열 최초 감지 (5영업일 스케줄)
  stopApproachAlert,        // 15. 손절 접근 3단계 경보
  euphoriaPartialExit,      // 16. 과열 50%
];

// PR-6 #12: 동시 실행 방지 뮤텍스.
// orchestratorJobs(*/1분) 의 signalScanner → updateShadowResults 와
// shadowResolverJob(*/5분) 이 5분마다 동시 진입해, 동일 shadow 상태를 각각
// 로드·처리·브로드캐스트하면서 같은 L3 분할 익절·원금보호 알림이 텔레그램에
// 두 번 나가는 사례(2026-04-24 Shadow 익절 중복) 가 확인됐다.
// 최종 fills/quantity 는 last-write-wins 로 정확하지만 메시지만 중복.
// 간단한 in-memory 플래그로 직렬화 — 한 쪽이 끝날 때까지 다른 쪽은 skip.
let _exitRunning = false;

/** Shadow 진행 중 거래 결과 업데이트 — Macro/포지션 제한 시에도 재사용 */
export async function updateShadowResults(shadows: ServerShadowTrade[], currentRegime: RegimeLevel): Promise<void> {
  if (_exitRunning) {
    console.warn('[ExitEngine] 이미 updateShadowResults 실행 중 — 중복 진입 skip (concurrent tick 가드)');
    return;
  }
  _exitRunning = true;
  try {
    return await _updateShadowResultsImpl(shadows, currentRegime);
  } finally {
    _exitRunning = false;
  }
}

async function _updateShadowResultsImpl(shadows: ServerShadowTrade[], currentRegime: RegimeLevel): Promise<void> {
  // L1 학습 훅 (아이디어 1) — 이번 루프에서 HIT_TARGET/HIT_STOP으로 전환된 stockCode를 수집하여
  // 루프 종료 후 setImmediate로 learningOrchestrator.onShadowResolved() 일괄 트리거.
  const resolvedNow = new Set<string>();

  // PR-7 #13: 레거시 SHADOW BUY fill 백필 (멱등). 기존에 BUY fill 없이 저장된
  // trade 들에 `originalQuantity × shadowEntryPrice` 로 BUY fill 을 복원한다.
  // 이후의 모든 fill 기반 파생(getRemainingQty/syncPositionCache/computeShadowAccount)
  // 이 정상 작동하기 위한 전제 조건.
  const backfilled = backfillShadowBuyFills(shadows);
  if (backfilled > 0) {
    console.log(`[ExitEngine] SHADOW BUY fill 백필: ${backfilled}건 (레거시 마이그레이션)`);
  }

  // Phase 3-⑨: 열려 있는 trade 에 대해 30/60/120분 mini-bar 스냅샷 포착 (약한 라벨).
  // 실패해도 main exit 로직에 영향 없도록 격리.
  try {
    const captured = await captureSnapshotsForOpenTrades(shadows);
    if (captured > 0) console.log(`[Coldstart] mini-bar snapshot ${captured}건 저장`);
  } catch (e) {
    console.warn('[Coldstart] snapshot capture 실패:', e instanceof Error ? e.message : e);
  }

  for (const shadow of shadows) {
    // PENDING: Shadow 모드에서만 4분 경과 후 ACTIVE 전환.
    // LIVE 모드에서는 fillMonitor가 ORDER_SUBMITTED → ACTIVE 전환을 책임지므로
    // 여기서 자동 승격하지 않는다 (체결 확인 없이 ACTIVE처럼 보이는 것을 방지).
    if (shadow.status === 'PENDING') {
      if (shadow.mode === 'LIVE') continue;
      const ageMs = Date.now() - new Date(shadow.signalTime).getTime();
      if (ageMs < 4 * 60 * 1000) continue;
      shadow.status = 'ACTIVE';
      // PR-7 #13: PENDING→ACTIVE 전환 시 BUY fill 기록 — fills SSOT 작동의 전제.
      // LIVE 경로는 fillMonitor.updateStatus('ACTIVE') 가 이 역할을 하지만 SHADOW 경로는
      // 이 지점이 유일한 진입 체결 확정점이다. 이미 BUY fill 이 있으면 스킵(멱등).
      const hasBuyFill = (shadow.fills ?? []).some(f => f.type === 'BUY');
      if (!hasBuyFill && shadow.quantity > 0 && shadow.shadowEntryPrice > 0) {
        const entryTs = new Date().toISOString();
        appendFill(shadow, {
          type:        'BUY',
          subType:     'INITIAL_BUY',
          qty:         shadow.quantity,
          price:       shadow.shadowEntryPrice,
          reason:      'SHADOW 가상 진입',
          timestamp:   entryTs,
          status:      'CONFIRMED',
          confirmedAt: entryTs,
        });
        shadow.originalQuantity = Math.max(shadow.originalQuantity ?? 0, shadow.quantity);
      }
      // Shadow 체결 알림 — LIVE의 fillMonitor "✅ 체결 확인"과 동일한 경험 제공
      // 체결 알림 — getRemainingQty SSOT 를 사용해 캐시 드리프트를 방지한다.
      const filledQty = getRemainingQty(shadow) > 0 ? getRemainingQty(shadow) : shadow.quantity;
      await sendTelegramAlert(
        `🎭 <b>[SHADOW 체결]</b> ${shadow.stockName} (${shadow.stockCode})\n` +
        `진입가: ${shadow.shadowEntryPrice.toLocaleString()}원 × ${filledQty}주\n` +
        `손절: ${shadow.stopLoss.toLocaleString()}원 | 목표: ${shadow.targetPrice.toLocaleString()}원\n` +
        `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
      ).catch(console.error);
      appendShadowLog({ event: 'SHADOW_ACTIVATED', ...shadow });
      continue;
    }

    // REJECTED·ORDER_SUBMITTED 모두 이 조건으로 스킵됨.
    // REJECTED는 buyApproval 거부/KIS 주문 실패 시 shadows에 남는 종료 상태이므로 안전.
    // ORDER_SUBMITTED는 fillMonitor가 체결 확인 후 ACTIVE로 전환할 때까지 exitEngine이 관여하지 않음.
    if (shadow.status !== 'ACTIVE' && shadow.status !== 'PARTIALLY_FILLED' && shadow.status !== 'EUPHORIA_PARTIAL') continue;

    // ─── Fill 기반 잔량 동기화 (단일 진실 원천) ──────────────────────────────
    // fills 배열이 진실 원천. 재시작·중복 실행 등으로 quantity 캐시가 어긋났으면 교정.
    {
      const before = shadow.quantity;
      if (syncPositionCache(shadow) && shadow.quantity !== before) {
        console.log(`[ExitEngine] ⚠️ 잔량 불일치 ${shadow.stockCode}: stored=${before} fill-based=${shadow.quantity} → 교정`);
      }
      // 잔량이 0이면 HIT_STOP으로 전환하고 루프 스킵
      if (shadow.quantity <= 0) {
        shadow.status = 'HIT_STOP';
        shadow.exitTime ??= new Date().toISOString();
        console.log(`[ExitEngine] ⚠️ ${shadow.stockCode} fill 기반 잔량=0 → 강제 HIT_STOP 전환`);
        continue;
      }
    }

    const currentPrice = getRealtimePrice(shadow.stockCode)
      ?? await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) continue;

    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
    const initialStopLoss = shadow.initialStopLoss ?? shadow.stopLoss;
    const regimeStopLoss = shadow.regimeStopLoss ?? shadow.stopLoss;
    let hardStopLossValue = shadow.hardStopLoss ?? shadow.stopLoss;

    // EXIT_RULES_IN_ORDER 순회 — 첫 skipRest=true 에서 break.
    let skipRest = false;
    for (const rule of EXIT_RULES_IN_ORDER) {
      const ctx: ExitContext = {
        shadow,
        currentPrice,
        returnPct,
        currentRegime,
        initialStopLoss,
        regimeStopLoss,
        hardStopLoss: hardStopLossValue,
        resolvedNow,
      };
      const result = await rule(ctx);
      if (result.hardStopLossUpdate !== undefined) {
        hardStopLossValue = result.hardStopLossUpdate;
      }
      if (result.skipRest) {
        skipRest = true;
        break;
      }
    }
    if (skipRest) {
      // 루프 본체가 `continue` 한 시나리오와 동일하게, finalStatus 학습 훅도 스킵.
      // 단, 규칙 안에서 HIT_TARGET/HIT_STOP 으로 전이된 종목은 학습 훅에 등록한다.
      const finalStatus = shadow.status as string;
      if (finalStatus === 'HIT_TARGET' || finalStatus === 'HIT_STOP') {
        resolvedNow.add(shadow.stockCode);
      }
      continue;
    }

    // L1 학습 훅 — 이 루프 진입 조건이 ACTIVE/PARTIALLY_FILLED/EUPHORIA_PARTIAL 이므로
    // 종료 시 HIT_TARGET/HIT_STOP 이라면 이번 루프에서 갓 청산된 것이다.
    // TS의 좁혀진 상태가 루프 내 재할당 이후에도 유지되므로 string 비교로 우회.
    const finalStatus = shadow.status as string;
    if (finalStatus === 'HIT_TARGET' || finalStatus === 'HIT_STOP') {
      resolvedNow.add(shadow.stockCode);
    }
  }

  // 청산된 종목이 있으면 다음 tick으로 밀어 learningOrchestrator.onShadowResolved를 트리거.
  // KIS API 부담 최소화를 위해 종목당 1건씩 순차 처리 (Promise.all 미사용).
  if (resolvedNow.size > 0) {
    // 슬롯이 회복되었으므로 다음 INTRADAY tick 에서 interval/backoff 를 우회해 즉시 재스캔한다.
    // (기존에는 최대 10분 뒤 다음 decideScan() 까지 빈 슬롯이 방치됨)
    requestImmediateRescan(`exitEngine 청산 ${resolvedNow.size}건 (${Array.from(resolvedNow).join(',')})`);

    setImmediate(async () => {
      for (const code of resolvedNow) {
        await learningOrchestrator.onShadowResolved(code).catch(console.error);
      }
    });
  }
}

// ─── Re-exports for backward compatibility ────────────────────────────────
// 기존 외부 importer (signalScanner / shadowResolverJob / atrIntegration test) 가
// 'exitEngine.js' 에서 import 해 오는 심볼들을 그대로 노출한다.
export { emitPartialAttributionForSell } from './helpers/attribution.js';
export type { ReserveSellResult } from './helpers/reserveSell.js';
export { detectBearishDivergence } from './helpers/rsiSeries.js';
export { isMA60Death, kstBusinessDateStr } from './helpers/ma60.js';
