// @responsibility 4-체크 라스트 트리거 평가 순수 함수 (ADR-0031 PR-D)

import type { StockRecommendation } from '../services/stockService';
import type { LastTriggerCheck, LastTriggerSummary } from '../types/ui';
import { CONDITION_PASS_THRESHOLD } from '../constants/gateConfig';

const VKOSPI_STABLE_THRESHOLD = 25;

export interface LastTriggerInput {
  stock: StockRecommendation;
  vkospi?: number | null;
  /** 호출자가 dartAlerts 에서 해당 종목 + sentiment='POSITIVE' 필터 후 boolean 으로 전달. */
  recentPositiveDisclosure: boolean;
}

function isPositiveScore(value: number | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= CONDITION_PASS_THRESHOLD;
}

/**
 * 4 체크 라스트 트리거 평가:
 *   - VCP 박스권 돌파 (checklist.vcpPattern ≥ THRESHOLD)
 *   - 거래량 증가 (checklist.volumeSurgeVerified ≥ THRESHOLD)
 *   - VKOSPI 안정 (vkospi < 25)
 *   - 최근 긍정 공시 (recentPositiveDisclosure=true)
 *
 * verdict: 4/4 → EXECUTE / 1~3 → WATCHLIST / 0 → INACTIVE.
 */
export function evaluateLastTrigger(input: LastTriggerInput): LastTriggerSummary {
  const { stock, vkospi, recentPositiveDisclosure } = input;
  const cl = stock.checklist;

  const vcpTriggered = isPositiveScore(cl?.vcpPattern);
  const volumeTriggered = isPositiveScore(cl?.volumeSurgeVerified);
  const vkospiStable = typeof vkospi === 'number' && Number.isFinite(vkospi)
    && vkospi < VKOSPI_STABLE_THRESHOLD;
  const positiveDisclosure = recentPositiveDisclosure === true;

  const checks: LastTriggerCheck[] = [
    {
      id: 'VCP_BREAKOUT',
      label: 'VCP 박스권 돌파',
      status: vcpTriggered ? 'TRIGGERED' : 'PENDING',
      detail: vcpTriggered
        ? '박스 상단 돌파 패턴 감지'
        : '박스권 돌파 대기',
    },
    {
      id: 'VOLUME_SURGE',
      label: '거래량 증가',
      status: volumeTriggered ? 'TRIGGERED' : 'PENDING',
      detail: volumeTriggered ? '거래량 급증 동반' : '거래량 미증가',
    },
    {
      id: 'VKOSPI_STABLE',
      label: 'VKOSPI 안정',
      status: vkospiStable ? 'TRIGGERED' : 'PENDING',
      detail: typeof vkospi === 'number' && Number.isFinite(vkospi)
        ? `VKOSPI ${vkospi.toFixed(1)} ${vkospiStable ? '< 25 안정' : '≥ 25 변동성'}`
        : 'VKOSPI 데이터 미수신',
    },
    {
      id: 'POSITIVE_DISCLOSURE',
      label: '최근 긍정 공시',
      status: positiveDisclosure ? 'TRIGGERED' : 'PENDING',
      detail: positiveDisclosure ? 'DART 긍정 공시 감지' : '긍정 공시 없음',
    },
  ];

  const triggeredCount = checks.filter(c => c.status === 'TRIGGERED').length;
  const totalChecks = checks.length;

  let verdict: LastTriggerSummary['verdict'];
  if (triggeredCount === totalChecks) verdict = 'EXECUTE';
  else if (triggeredCount === 0) verdict = 'INACTIVE';
  else verdict = 'WATCHLIST';

  return { checks, triggeredCount, totalChecks, verdict };
}
