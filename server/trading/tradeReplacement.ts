/**
 * tradeReplacement.ts — Phase 4-⑦ 포지션 교체 평가 엔진.
 *
 * "포지션 Full + 빈스캔 장기 지속 + 관찰 워치리스트에 gate=5.8급 신호 다수 존재"
 * 구조에서 더 나은 종목이 탐색되어도 교체 경로가 없던 문제를 해소한다.
 *
 * 순수 의사결정 함수만 제공 — 실제 약익절 주문은 호출부(signalScanner/exitEngine)
 * 책임. 같은 종목에 대해 20분 쿨다운이 적용되어 반복 교체 손실을 방지.
 *
 * 조건 (AND):
 *   (i)   보유 종목 수익률 ≥ 1.5% 그리고 모멘텀 둔화 신호
 *   (ii)  신규 후보 liveGate − 보유 종목 gateScore ≥ 1.5
 *   (iii) 섹터 중복 해소 효과 (동일 섹터 2개 이상 보유 중, 신규는 다른 섹터)
 */

import { safePctChange } from '../utils/safePctChange.js';

export const TRADE_REPLACEMENT_MIN_PROFIT_PCT = 1.5;
export const TRADE_REPLACEMENT_MIN_GATE_DELTA = 1.5;
export const TRADE_REPLACEMENT_COOLDOWN_MS   = 20 * 60 * 1000;

export interface HeldPositionView {
  stockCode: string;
  stockName: string;
  entryPrice: number;
  currentPrice: number;
  gateScore?: number;
  sector?: string;
  /** 모멘텀 둔화 — 호출부 판단 결과(거래량 마름 OR 일봉 내림세 전환) */
  momentumSlowing?: boolean;
}

export interface CandidateView {
  stockCode: string;
  stockName: string;
  liveGate: number;
  sector?: string;
}

export interface SectorExposureSnapshot {
  /** 섹터별 보유 종목 수 */
  countsBySector: Map<string, number>;
}

export interface ReplacementDecision {
  /** 교체 가능하면 true */
  proposed: boolean;
  /** 약익절 대상으로 선정된 보유 종목 (없으면 null) */
  targetToExit?: HeldPositionView;
  /** 매칭 이유 — 차단 시 원인, 승인 시 요약 */
  reason: string;
  /** 내부 진단용 점수 */
  score: number;
}

// ── 쿨다운 ─────────────────────────────────────────────────────────────────────

const _lastReplacement = new Map<string, number>();  // stockCode → ms

/**
 * 쿨다운 조회 — `proposeReplacement` 가 이미 결정을 내린 후 호출부가 실제 실행을
 * 기록할 때 `markReplacement(stockCode)` 를 호출해야 한다.
 */
export function isInReplacementCooldown(stockCode: string, now = Date.now()): boolean {
  const last = _lastReplacement.get(stockCode) ?? 0;
  return now - last < TRADE_REPLACEMENT_COOLDOWN_MS;
}

export function markReplacement(stockCode: string, ts = Date.now()): void {
  _lastReplacement.set(stockCode, ts);
}

/** 테스트용 쿨다운 리셋. */
export function _resetReplacementCooldowns(): void {
  _lastReplacement.clear();
}

// ── 본 평가 ───────────────────────────────────────────────────────────────────

/**
 * 보유 종목들과 신규 후보를 비교해 교체를 제안한다.
 *
 *   - 반환의 proposed=true 이면 targetToExit 의 종목을 약익절하고 candidate 로 교체
 *   - 쿨다운 중이거나 조건 미충족이면 proposed=false 와 reason
 */
export function proposeReplacement(params: {
  held: HeldPositionView[];
  candidate: CandidateView;
  sectorExposure: SectorExposureSnapshot;
  now?: number;
}): ReplacementDecision {
  const now = params.now ?? Date.now();
  const { held, candidate, sectorExposure } = params;

  if (!candidate || !Number.isFinite(candidate.liveGate)) {
    return { proposed: false, reason: 'invalid_candidate', score: 0 };
  }

  // 각 보유 종목을 교체 대상 후보로 평가
  let best: ReplacementDecision = { proposed: false, reason: 'no_match', score: 0 };
  for (const h of held) {
    if (isInReplacementCooldown(h.stockCode, now)) continue;

    // (i) 수익률 ≥ 1.5% 그리고 모멘텀 둔화
    // ADR-0028: stale currentPrice 또는 sanity 위반 시 교체 평가 스킵 (잘못된
    // returnPct 로 보유 종목을 임의 교체하는 위험 차단).
    if (h.entryPrice <= 0) continue;
    const returnPct = safePctChange(h.currentPrice, h.entryPrice, {
      label: `tradeReplacement:${h.stockCode}`,
    });
    if (returnPct === null || returnPct < TRADE_REPLACEMENT_MIN_PROFIT_PCT) continue;
    if (!h.momentumSlowing) continue;

    // (ii) gate 우위 ≥ 1.5
    const heldGate = h.gateScore ?? 0;
    const gateDelta = candidate.liveGate - heldGate;
    if (gateDelta < TRADE_REPLACEMENT_MIN_GATE_DELTA) continue;

    // (iii) 섹터 중복 해소
    const heldSector = h.sector ?? '미분류';
    const candSector = candidate.sector ?? '미분류';
    const heldSectorCount = sectorExposure.countsBySector.get(heldSector) ?? 0;
    const sectorDedupBenefit = heldSectorCount >= 2 && heldSector !== candSector;
    if (!sectorDedupBenefit) continue;

    // 우선순위 — 가장 큰 gate 우위 & 가장 낮은 수익률(= 유휴자본 회전 효과 큼)
    const score = gateDelta * 10 + (returnPct - TRADE_REPLACEMENT_MIN_PROFIT_PCT) * -1;
    if (score > best.score) {
      best = {
        proposed: true,
        targetToExit: h,
        reason:
          `교체 승인: ${h.stockName}(+${returnPct.toFixed(2)}%, gate ${heldGate}, ${heldSector}) → ` +
          `${candidate.stockName}(gate ${candidate.liveGate.toFixed(1)}, ${candSector}) | ` +
          `gate Δ+${gateDelta.toFixed(1)}, 섹터중복해소`,
        score,
      };
    }
  }
  return best;
}
