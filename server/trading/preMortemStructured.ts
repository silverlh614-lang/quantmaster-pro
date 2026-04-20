/**
 * preMortemStructured.ts — Phase 3-⑫: 진입 시 구조화된 실패 시나리오 기록.
 *
 * 기존 free-text Pre-Mortem(Gemini) 은 사람 복기용으로 좋지만 기계 매칭이
 * 불가능하다. 이 모듈은 매수 승인 직전 4개 필수 필드를 결정론적으로 생성하고,
 * 종결 시점에 어떤 invalidation 이 터졌는지 비교 가능하게 한다.
 *
 * 페르소나 10번(조건부 판단과 리스크)과 "손절은 운영 비용" 원칙의 기계적 이행:
 * 모든 매수는 "어떤 조건이 깨지면 손절" 을 명시적으로 선언한 상태에서만 이뤄진다.
 */

import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { saveFailureSnapshot } from '../learning/failurePatternDB.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';

export type InvalidationId =
  | 'MA60_BREAK'          // 60일선 이탈 (중기 추세 붕괴)
  | 'VOLUME_DROP'         // 평균 50% 미만 거래량 감소 (수급 이탈)
  | 'SECTOR_RS_DOWN'      // 섹터 상대강도 하락 (테마 소멸)
  | 'HARD_STOP_HIT'       // 가격 기반 hard stop 도달
  | 'REGIME_DOWNGRADE'    // 시장 레짐 R4 이하로 악화
  | 'VKOSPI_SPIKE'        // VKOSPI 급등 (구조적 공포)
  | 'MOMENTUM_LOSS';      // MTAS ≤ 3 하락 (타임프레임 불일치)

export interface BuildPreMortemStructuredInput {
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  regime: string;
  sector?: string;
  gateScore?: number;
  mtas?: number;
  /** 14일 ATR — regime stop 의 근거 제공용 */
  atr14?: number;
  /** 워치리스트에서 보정된 60일선 기준값 (있으면 MA60_BREAK invalidation 에 주입) */
  ma60?: number;
  /** 평균 거래량 — VOLUME_DROP 임계값 계산용 */
  avgVolume?: number;
  /** 포지션 프로파일 — 보유 기간 추정용 */
  profileType?: 'A' | 'B' | 'C' | 'D';
  /** 분할 익절 트랜치 수 */
  profitTrancheCount?: number;
}

function estimateDaysToTarget(profile?: 'A' | 'B' | 'C' | 'D'): number {
  switch (profile) {
    case 'A': return 30;  // 대형 주도 — 느린 회전
    case 'B': return 15;  // 중형 성장
    case 'C': return 7;   // 소형 모멘텀
    case 'D': return 3;   // 촉매 이벤트 — 빠른 회전
    default:  return 14;
  }
}

/**
 * 매수 승인 시 구조화 Pre-Mortem 4필드 생성 — 항상 성공 (Gemini 미사용, deterministic).
 */
export function buildPreMortemStructured(
  p: BuildPreMortemStructuredInput,
): NonNullable<ServerShadowTrade['preMortemStructured']> {
  const rrr = p.stopLoss > 0 && p.entryPrice > p.stopLoss
    ? (p.targetPrice - p.entryPrice) / (p.entryPrice - p.stopLoss)
    : 0;

  const sectorLine = p.sector ? ` / 섹터 ${p.sector}` : '';
  const thesis =
    `${p.regime}${sectorLine} 구간 Gate ${p.gateScore?.toFixed(1) ?? '?'} · MTAS ${p.mtas?.toFixed(1) ?? '?'} ` +
    `— 진입가 ${p.entryPrice.toLocaleString()}원에서 RRR ${rrr.toFixed(2)} 추종`;

  const invs: NonNullable<ServerShadowTrade['preMortemStructured']>['invalidationConditions'] = [];
  invs.push({
    id: 'HARD_STOP_HIT',
    description: `가격이 ${p.stopLoss.toLocaleString()}원 이하로 이탈 시 손절`,
    watch: { price: p.stopLoss },
  });
  if (p.ma60 && p.ma60 > 0 && p.ma60 < p.entryPrice) {
    invs.push({
      id: 'MA60_BREAK',
      description: `60일선(${p.ma60.toLocaleString()}원) 이탈 시 중기 추세 붕괴`,
      watch: { ma60: p.ma60 },
    });
  }
  if (p.avgVolume && p.avgVolume > 0) {
    const vThresh = Math.round(p.avgVolume * 0.5);
    invs.push({
      id: 'VOLUME_DROP',
      description: `거래량이 20일 평균의 50% 미만(${vThresh.toLocaleString()}) 지속 시 수급 이탈`,
      watch: { volumeMin: vThresh },
    });
  }
  invs.push({
    id: 'REGIME_DOWNGRADE',
    description: '시장 레짐이 R4_NEUTRAL 이하로 악화 — 구조적 진입 조건 붕괴',
    watch: { minRegime: 'R4_NEUTRAL' },
  });
  invs.push({
    id: 'VKOSPI_SPIKE',
    description: 'VKOSPI 단일일 +30% 급등 — 구조적 공포 전이',
    watch: { vkospiDayChangeMax: 30 },
  });
  invs.push({
    id: 'MOMENTUM_LOSS',
    description: 'MTAS ≤ 3 로 하락 — 타임프레임 불일치',
    watch: { mtasMin: 3 },
  });

  return {
    primaryThesis: thesis.slice(0, 280),
    invalidationConditions: invs,
    stopLossTrigger: {
      hardStop: p.stopLoss,
      regime: p.regime,
      rationale: p.atr14 && p.atr14 > 0
        ? `ATR14 ${p.atr14.toFixed(1)} 기반 동적 손절 + 레짐(${p.regime}) 고정 손절 병합`
        : `레짐(${p.regime}) 고정 손절 + 진입가 기준 구조 손절`,
    },
    targetScenario: {
      targetPrice: p.targetPrice,
      expectedDays: estimateDaysToTarget(p.profileType),
      rrr: Number.isFinite(rrr) ? parseFloat(rrr.toFixed(2)) : 0,
      profitTrancheCount: p.profitTrancheCount ?? 0,
    },
  };
}

// ── 종결 시점 매칭 ──────────────────────────────────────────────────────────────

export interface ExitContext {
  currentPrice: number;
  currentRegime: string;
  mtas?: number;
  ma60?: number;
  volume?: number;
  vkospiDayChange?: number;
}

/**
 * hardStop 등으로 종결된 트레이드의 invalidation 을 매칭한다.
 * 우선순위는 invalidationConditions 배열 순서 (HARD_STOP_HIT 가 우선).
 */
export function matchExitInvalidation(
  trade: ServerShadowTrade,
  ctx: ExitContext,
): { id: InvalidationId; observedValue?: number | string } | null {
  const list = trade.preMortemStructured?.invalidationConditions;
  if (!list || list.length === 0) return null;

  for (const cond of list) {
    switch (cond.id as InvalidationId) {
      case 'HARD_STOP_HIT':
        if (ctx.currentPrice <= (trade.hardStopLoss ?? trade.stopLoss)) {
          return { id: 'HARD_STOP_HIT', observedValue: ctx.currentPrice };
        }
        break;
      case 'MA60_BREAK': {
        const ma60 = Number(cond.watch?.ma60);
        if (Number.isFinite(ma60) && ctx.currentPrice < ma60) {
          return { id: 'MA60_BREAK', observedValue: ctx.currentPrice };
        }
        break;
      }
      case 'VOLUME_DROP': {
        const minVol = Number(cond.watch?.volumeMin);
        if (ctx.volume != null && Number.isFinite(minVol) && ctx.volume < minVol) {
          return { id: 'VOLUME_DROP', observedValue: ctx.volume };
        }
        break;
      }
      case 'REGIME_DOWNGRADE':
        if (ctx.currentRegime === 'R4_NEUTRAL' || ctx.currentRegime === 'R5_CAUTION' || ctx.currentRegime === 'R6_DEFENSE') {
          return { id: 'REGIME_DOWNGRADE', observedValue: ctx.currentRegime };
        }
        break;
      case 'VKOSPI_SPIKE': {
        const thresh = Number(cond.watch?.vkospiDayChangeMax);
        if (ctx.vkospiDayChange != null && Number.isFinite(thresh) && ctx.vkospiDayChange >= thresh) {
          return { id: 'VKOSPI_SPIKE', observedValue: ctx.vkospiDayChange };
        }
        break;
      }
      case 'MOMENTUM_LOSS': {
        const minMtas = Number(cond.watch?.mtasMin);
        if (ctx.mtas != null && Number.isFinite(minMtas) && ctx.mtas <= minMtas) {
          return { id: 'MOMENTUM_LOSS', observedValue: ctx.mtas };
        }
        break;
      }
    }
  }
  // 어느 조건도 명시적으로 매칭되지 않으면 HARD_STOP_HIT 로 폴백 (가격이 stopLoss 를 건드렸기 때문).
  return { id: 'HARD_STOP_HIT', observedValue: ctx.currentPrice };
}

// ── 3회 승급 — FailurePatternDB ─────────────────────────────────────────────────

const PATTERN_AUTO_PROMOTION_THRESHOLD = 3;

/**
 * 동일 invalidation id 로 손절된 트레이드가 임계치 이상이면 FailurePatternDB 로 자동 승급.
 * 호출 시점: exitEngine 이 hardStop 기반 청산 후 exitInvalidationMatch 를 기록한 직후.
 */
export function promoteInvalidationPatternIfRepeated(
  justClosedTrade: ServerShadowTrade,
): boolean {
  const id = justClosedTrade.exitInvalidationMatch?.id;
  if (!id) return false;
  const trades = loadShadowTrades();
  const matches = trades.filter(
    (t) => t.exitInvalidationMatch?.id === id &&
      (t.status === 'HIT_STOP' || (t.returnPct ?? 0) < 0),
  );
  if (matches.length < PATTERN_AUTO_PROMOTION_THRESHOLD) return false;

  const recent = matches[matches.length - 1];
  const conditionScores: Record<number, number> = {};
  // FailurePatternEntry 는 27조건 스코어 벡터를 요구하지만, 여기서는 invalidation 패턴 요약만
  // 저장한다 — 벡터 기반 유사도는 기존 손절 경로가 제공하고, 이 엔트리는 사람 검토용.
  saveFailureSnapshot({
    id: `inv_${id}_${Date.now()}`,
    stockCode: recent.stockCode,
    stockName: `${id} 반복 패턴 (${matches.length}회)`,
    entryDate: recent.signalTime ?? new Date().toISOString(),
    exitDate: recent.exitTime ?? new Date().toISOString(),
    returnPct: recent.returnPct ?? 0,
    conditionScores,
    gate1Score: 0, gate2Score: 0, gate3Score: 0, finalScore: 0,
    marketRegime: recent.entryRegime ?? null,
    sector: null,
    savedAt: new Date().toISOString(),
  });
  console.log(
    `[PreMortem] invalidation 패턴 자동 승급: ${id} ${matches.length}회 손절 → FailurePatternDB 기록`,
  );
  return true;
}
