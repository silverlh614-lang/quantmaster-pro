// @responsibility preOrderGuard 매매 엔진 모듈
/**
 * preOrderGuard.ts — Phase 2차 C3: Automated Kill Switch (주문 직전 안전 검증).
 *
 * placeKisMarketBuyOrder 호출 직전에 3가지 안전 조건을 검증하여, 사람이
 * 판단하기 전에 시스템이 자신을 보호한다.
 *
 * 검증 항목:
 *   1. quantity * price > totalAssets * 1.5  → POSITION_EXPLOSION
 *   2. stopLoss >= entryPrice                → STOPLOSS_LOGIC_BROKEN
 *   3. 최근 10분간 동일 종목 주문 ≥ 3회       → ORDER_LOOP_SUSPECT
 *
 * 검증 실패 시:
 *   - incidentLogRepo.recordIncident() 영속화
 *   - setEmergencyStop(true) + cancelAllPendingOrders() (fire-and-forget)
 *   - Telegram CRITICAL 알림
 *   - throw PreOrderGuardError — 호출부는 잡아서 REJECTED 처리
 *
 * 메모리 스파이크(heap) 는 별도 heartbeat 모니터링 경로에서 다룬다 (I/O 집약
 * 주문 경로에서 측정 노이즈 과다).
 *
 * Phase 1-②: 섹터 노출 선검증(checkSectorExposureBefore) — 주문 큐에 들어가기
 * 전에 단일 섹터 편중을 차단. portfolioRiskEngine 은 제2방어선으로 유지한다.
 */

import { recordIncident } from '../persistence/incidentLogRepo.js';
import { setEmergencyStop } from '../state.js';
import { cancelAllPendingOrders } from '../emergency.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { sendBlastRadiusReport } from '../alerts/contaminationBlastRadius.js';

// ── 임계값 ────────────────────────────────────────────────────────────────────

/** 주문 금액이 총자산의 몇 배를 넘으면 비정상 팽창으로 간주할지. */
const POSITION_EXPLOSION_MULTIPLIER = 1.5;

/** 동일 종목 주문 중복 감지 윈도우 */
const ORDER_LOOP_WINDOW_MS = 10 * 60 * 1000;

/** 윈도우 내 동일 종목 주문 임계치 (이 수 이상이면 loop 의심). */
const ORDER_LOOP_THRESHOLD = 3;

// ── 동일 종목 주문 이력 (메모리, 프로세스 재시작 시 초기화) ───────────────────

const _recentOrders = new Map<string, number[]>();  // stockCode → [timestamp...]

function recordOrderTimestamp(stockCode: string, now: number): number {
  const arr = _recentOrders.get(stockCode) ?? [];
  // 윈도우 밖 타임스탬프 제거
  const cutoff = now - ORDER_LOOP_WINDOW_MS;
  const filtered = arr.filter(t => t >= cutoff);
  filtered.push(now);
  _recentOrders.set(stockCode, filtered);
  return filtered.length;
}

/** 테스트/진단 전용: 이력 초기화. */
export function _resetRecentOrders(): void {
  _recentOrders.clear();
}

// ── 에러 타입 ─────────────────────────────────────────────────────────────────

export type PreOrderGuardReason =
  | 'POSITION_EXPLOSION'
  | 'STOPLOSS_LOGIC_BROKEN'
  | 'ORDER_LOOP_SUSPECT';

export class PreOrderGuardError extends Error {
  constructor(public reason: PreOrderGuardReason, message: string) {
    super(message);
    this.name = 'PreOrderGuardError';
  }
}

// ── 메인 가드 ────────────────────────────────────────────────────────────────

export interface PreOrderContext {
  stockCode:  string;
  stockName:  string;
  quantity:   number;
  entryPrice: number;
  stopLoss:   number;
  /** 총자산 (KIS fetchAccountBalance 결과). null 이면 팽창 검사를 건너뛴다. */
  totalAssets: number | null;
}

/**
 * 주문 직전 최종 안전 검증. 위반 시 부작용:
 *   - incident-log.json 영속화 (샘플 자동 격리 기준)
 *   - setEmergencyStop(true) + cancelAllPendingOrders() 비동기 실행
 *   - Telegram CRITICAL 알림
 *   - PreOrderGuardError throw
 *
 * 호출부는 이 예외를 catch 해서 REJECTED 상태로 마감해야 한다.
 */
export function assertSafeOrder(ctx: PreOrderContext): void {
  // 1) 포지션 비정상 팽창
  if (ctx.totalAssets != null && ctx.totalAssets > 0) {
    const orderValue = ctx.quantity * ctx.entryPrice;
    const limit = ctx.totalAssets * POSITION_EXPLOSION_MULTIPLIER;
    if (orderValue > limit) {
      fireKillSwitch('POSITION_EXPLOSION',
        `${ctx.stockName}(${ctx.stockCode}) 주문가치 ${orderValue.toLocaleString()} > 총자산×${POSITION_EXPLOSION_MULTIPLIER} (${limit.toLocaleString()})`,
        { stockCode: ctx.stockCode, quantity: ctx.quantity, entryPrice: ctx.entryPrice, totalAssets: ctx.totalAssets },
      );
    }
  }

  // 2) 손절 논리 붕괴
  if (ctx.stopLoss >= ctx.entryPrice) {
    fireKillSwitch('STOPLOSS_LOGIC_BROKEN',
      `${ctx.stockName}(${ctx.stockCode}) stopLoss(${ctx.stopLoss}) >= entryPrice(${ctx.entryPrice})`,
      { stockCode: ctx.stockCode, stopLoss: ctx.stopLoss, entryPrice: ctx.entryPrice },
    );
  }

  // 3) 동일 종목 단기 다발 주문 (loop 의심)
  const count = recordOrderTimestamp(ctx.stockCode, Date.now());
  if (count >= ORDER_LOOP_THRESHOLD) {
    fireKillSwitch('ORDER_LOOP_SUSPECT',
      `${ctx.stockName}(${ctx.stockCode}) 최근 10분간 ${count}회 주문 — 무한 루프 의심`,
      { stockCode: ctx.stockCode, count, windowMs: ORDER_LOOP_WINDOW_MS },
    );
  }
}

// ── Phase 1-②: 섹터 노출 선검증 (Pre-Order Sector Guard) ──────────────────────
//
// 주문 큐에 들어가기 전에 단일 섹터 편중을 차단한다. portfolioRiskEngine 은
// 사후 리밸런싱 로직으로 제2방어선에 남긴다(동일 엔진이 승인 후 재평가로 진입
// 승인 뒤에 손절선 조임만 하던 약점을 해소).
//
// 기준선:
//   - 단일 섹터 투영 비중 ≤ SECTOR_WEIGHT_LIMIT (기본 40%)
//   - 상관 그룹 투영 비중 ≤ CORRELATION_GROUP_LIMIT (기본 50%)
//
// 위반 시 해당 후보만 SKIP → 상위 호출자는 다음 후보로 교체 가능.

const SECTOR_WEIGHT_LIMIT = parseFloat(process.env.PRE_ORDER_SECTOR_LIMIT ?? '0.40');
const CORRELATION_GROUP_LIMIT = parseFloat(process.env.PRE_ORDER_CORR_GROUP_LIMIT ?? '0.50');

/**
 * 상관 그룹 — 같은 거시 드라이버에 함께 움직이는 섹터 묶음.
 * 동일 그룹 합산 비중이 CORRELATION_GROUP_LIMIT 을 넘으면 분산 붕괴로 간주.
 */
const CORRELATION_GROUPS: Record<string, string[]> = {
  경기민감_대형: ['철강', '조선', '자동차', '화학', '에너지', '금융'],
  성장_테크:     ['반도체', '소프트웨어', 'AI', '로봇', '통신'],
  내수_방어:     ['통신', '유통', '바이오'],
  배터리_차량:   ['이차전지', '자동차', '화학'],
};

function resolveGroup(sector: string): string | null {
  for (const [group, sectors] of Object.entries(CORRELATION_GROUPS)) {
    if (sectors.includes(sector)) return group;
  }
  return null;
}

export interface SectorExposureContext {
  /** 진입 후보의 섹터 (미분류면 가드 skip) */
  candidateSector: string | undefined | null;
  /** 진입 후보의 예상 주문 금액 */
  candidateValue: number;
  /** 현재 보유 포지션의 섹터별 집계 금액 */
  currentSectorValue: Map<string, number>;
  /** 같은 tick 내 이미 승인 큐에 들어간 항목의 섹터별 합산 금액 */
  pendingSectorValue: Map<string, number>;
  /** 포트폴리오 기준 금액 — 총자산 또는 분모 기준. 0 이하면 skip. */
  totalAssets: number;
}

export interface SectorExposureResult {
  allowed: boolean;
  reason?: string;
  projectedSectorWeight: number;
  projectedGroupWeight?: number;
  group?: string;
}

/**
 * 주문 큐 투입 전에 섹터/상관 그룹 투영 비중을 평가.
 *   - 현재 보유 + 같은 tick 의 pending + 신규 후보를 모두 합산
 *   - 분모는 totalAssets + pendingAdded + candidateValue (신규 자금 유입분 반영)
 *   - 단일 섹터 비중이 SECTOR_WEIGHT_LIMIT 을 넘으면 차단
 *   - 상관 그룹 비중이 CORRELATION_GROUP_LIMIT 을 넘으면 차단
 *
 * 섹터가 '미분류' 또는 비어있으면 allowed=true 로 통과(회귀 방지).
 */
export function checkSectorExposureBefore(
  ctx: SectorExposureContext,
): SectorExposureResult {
  if (ctx.totalAssets <= 0) return { allowed: true, projectedSectorWeight: 0 };
  const sector = (ctx.candidateSector ?? '').trim();
  if (!sector || sector === '미분류') return { allowed: true, projectedSectorWeight: 0 };
  if (ctx.candidateValue <= 0) return { allowed: true, projectedSectorWeight: 0 };

  const pendingTotal = Array.from(ctx.pendingSectorValue.values())
    .reduce((sum, v) => sum + v, 0);
  // 분모는 보수적으로 "현재 총자산 + 이번 tick 신규 유입분" — 비중 상향 편향 방지.
  const denom = ctx.totalAssets + pendingTotal + ctx.candidateValue;
  if (denom <= 0) return { allowed: true, projectedSectorWeight: 0 };

  const curSectorVal = ctx.currentSectorValue.get(sector) ?? 0;
  const pendingSectorVal = ctx.pendingSectorValue.get(sector) ?? 0;
  const projectedSectorValue = curSectorVal + pendingSectorVal + ctx.candidateValue;
  const projectedSectorWeight = projectedSectorValue / denom;

  if (projectedSectorWeight > SECTOR_WEIGHT_LIMIT) {
    return {
      allowed: false,
      projectedSectorWeight,
      reason:
        `섹터 선검증 차단: ${sector} 투영 비중 ${(projectedSectorWeight * 100).toFixed(1)}% > ` +
        `${(SECTOR_WEIGHT_LIMIT * 100).toFixed(0)}% (현재 ${curSectorVal.toLocaleString()}원 + 대기 ${pendingSectorVal.toLocaleString()}원 + 신규 ${ctx.candidateValue.toLocaleString()}원)`,
    };
  }

  // 상관 그룹 체크 — 그룹에 속한 섹터들의 총합
  const group = resolveGroup(sector);
  if (group) {
    const groupSectors = CORRELATION_GROUPS[group];
    let groupValue = 0;
    for (const s of groupSectors) {
      groupValue += (ctx.currentSectorValue.get(s) ?? 0);
      groupValue += (ctx.pendingSectorValue.get(s) ?? 0);
    }
    groupValue += ctx.candidateValue;
    const projectedGroupWeight = groupValue / denom;
    if (projectedGroupWeight > CORRELATION_GROUP_LIMIT) {
      return {
        allowed: false,
        projectedSectorWeight,
        projectedGroupWeight,
        group,
        reason:
          `상관 그룹 선검증 차단: ${group} 투영 비중 ${(projectedGroupWeight * 100).toFixed(1)}% > ` +
          `${(CORRELATION_GROUP_LIMIT * 100).toFixed(0)}% (포함 섹터: ${groupSectors.join(',')})`,
      };
    }
    return { allowed: true, projectedSectorWeight, projectedGroupWeight, group };
  }

  return { allowed: true, projectedSectorWeight };
}

/** 테스트용 — 설정 상수 조회. */
export function _getSectorExposureLimits(): { single: number; group: number } {
  return { single: SECTOR_WEIGHT_LIMIT, group: CORRELATION_GROUP_LIMIT };
}

// ── 내부: kill switch 발사 ───────────────────────────────────────────────────

function fireKillSwitch(
  reason: PreOrderGuardReason,
  message: string,
  context: Record<string, string | number | boolean>,
): never {
  // 1) incident 영속화 (이 시각 이후 Shadow 샘플은 자동 격리)
  const entry = recordIncident('preOrderGuard', message, 'CRITICAL', { reason, ...context });

  // 2) EmergencyStop 설정 — 동기 state 변경
  setEmergencyStop(true);

  // 3) 미체결 주문 취소 + 텔레그램 알림 + 오염 반경 리포트 (비동기 fire-and-forget)
  void (async () => {
    try { await cancelAllPendingOrders(); } catch { /* 이미 best-effort */ }
    await sendTelegramAlert(
      `🚨 <b>[PRE-ORDER KILL SWITCH] ${reason}</b>\n` +
      `시각: ${entry.at}\n` +
      `${message}\n\n` +
      `자동 매매가 중단되었고 미체결 주문은 취소 시도됐습니다. ` +
      `원인 확인 후 수동으로 setEmergencyStop(false) + 재시작하여 복귀하세요.`,
      { priority: 'CRITICAL', dedupeKey: `pre-order-guard-${reason}` },
    ).catch(console.error);
    // 오염 반경 즉시 산정 — 운용자가 "얼마나 격리해야 하나"를 한 눈에.
    await sendBlastRadiusReport(entry.at).catch(console.error);
  })();

  throw new PreOrderGuardError(reason, message);
}
