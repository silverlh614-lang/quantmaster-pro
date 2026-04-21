/**
 * @responsibility 진입 판정을 객관화하는 통합 스냅샷을 REST 엔드포인트로 노출한다.
 *
 * monitoringCertRouter.ts — P2 #19: Monitoring Cert 대시보드.
 *
 * 매수 여부를 사용자가 육감이 아닌 **객관 스냅샷** 으로 판정하도록 돕는다.
 * 지금까지 흩어져 있던 신호(Gate 점수·레짐·편향·수동 개입 빈도·72h 냉각)를
 * 1회 조회로 통합해 프론트/채팅봇이 같은 소스로 진입 판단을 할 수 있게 한다.
 *
 * 엔드포인트:
 *   GET /api/monitoring-cert                — 전역(비종목) 의사결정 컨텍스트 (레짐·편향·수동 빈도)
 *   GET /api/monitoring-cert/:stockCode     — 특정 종목 인증서 (+ 72h 냉각·최근 수동 청산)
 *
 * 응답: 표준 envelope { ok: true, data: MonitoringCert }
 */

import express, { Request, Response } from 'express';
import { ok } from '../utils/apiResponse.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadBiasHeatmap } from '../persistence/reflectionRepo.js';
import { loadManualExitsWithinDays } from '../persistence/manualExitsRepo.js';
import {
  computeManualFrequencyAxis,
  MANUAL_FREQ_WATCH,
  MANUAL_FREQ_CAUTION,
  MANUAL_FREQ_ALARM,
} from '../learning/biasHeatmap.js';
import { checkManualExitCooldown, MANUAL_EXIT_REBUY_COOLDOWN_MS } from '../trading/buyPipeline.js';
import { getRuntimeThresholdSnapshot } from '../trading/gateConfig.js';
import { getEmergencyStop } from '../state.js';
import { getActiveOverride, canApplyToday } from '../persistence/overrideLedger.js';

const router = express.Router();

type EntryVerdict = 'GO' | 'CAUTION' | 'HOLD' | 'BLOCKED';

function verdictFromState(params: {
  emergencyStop: boolean;
  manualFreqGrade: 'CALM' | 'WATCH' | 'CAUTION' | 'ALARM';
  cooldownBlocked: boolean;
}): { verdict: EntryVerdict; reasons: string[] } {
  const reasons: string[] = [];
  if (params.emergencyStop) {
    reasons.push('비상 정지 활성');
    return { verdict: 'BLOCKED', reasons };
  }
  if (params.cooldownBlocked) {
    reasons.push('72h 재매수 냉각 진행 중');
    return { verdict: 'BLOCKED', reasons };
  }
  if (params.manualFreqGrade === 'ALARM') {
    reasons.push('수동 개입 ALARM (7일 7회+)');
    return { verdict: 'HOLD', reasons };
  }
  if (params.manualFreqGrade === 'CAUTION') {
    reasons.push('수동 개입 CAUTION (7일 5회+)');
    return { verdict: 'CAUTION', reasons };
  }
  if (params.manualFreqGrade === 'WATCH') {
    reasons.push('수동 개입 WATCH (7일 3회+)');
    return { verdict: 'CAUTION', reasons };
  }
  reasons.push('전역 가드 통과');
  return { verdict: 'GO', reasons };
}

function buildGlobalCert(now = new Date()) {
  const today = loadManualExitsWithinDays(1, now);
  const r7    = loadManualExitsWithinDays(7, now);
  const r30   = loadManualExitsWithinDays(30, now);
  const manualFreq = computeManualFrequencyAxis(today, r7, r30);

  const heatmap = loadBiasHeatmap();
  const latestBias = heatmap.length > 0 ? heatmap[heatmap.length - 1] : null;
  const macro = loadMacroState();

  const emergencyStop = getEmergencyStop();
  const { verdict, reasons } = verdictFromState({
    emergencyStop,
    manualFreqGrade: manualFreq.grade,
    cooldownBlocked: false,
  });

  return {
    generatedAt: now.toISOString(),
    verdict,
    reasons,
    gates: {
      emergencyStop,
      gateThreshold: getRuntimeThresholdSnapshot(),
      override: {
        active: getActiveOverride(),
        dailyUsage: canApplyToday(),
      },
    },
    macro: macro
      ? { regime: macro.regime, kospiDayReturn: macro.kospiDayReturn }
      : null,
    biasHeatmap: latestBias,
    manualFrequencyAxis: manualFreq,
    thresholds: {
      manualOverride: {
        WATCH: MANUAL_FREQ_WATCH,
        CAUTION: MANUAL_FREQ_CAUTION,
        ALARM: MANUAL_FREQ_ALARM,
      },
      rebuyCooldownMs: MANUAL_EXIT_REBUY_COOLDOWN_MS,
    },
  };
}

router.get('/', (_req: Request, res: Response) => {
  ok(res, buildGlobalCert());
});

router.get('/:stockCode', (req: Request, res: Response) => {
  const now = new Date();
  const code = String(req.params.stockCode ?? '').trim();
  const global = buildGlobalCert(now);
  const cooldown = checkManualExitCooldown(code, now);

  const recentForCode = loadManualExitsWithinDays(30, now).filter((r) => r.stockCode === code);

  const { verdict, reasons } = verdictFromState({
    emergencyStop: global.gates.emergencyStop,
    manualFreqGrade: global.manualFrequencyAxis.grade,
    cooldownBlocked: cooldown.blocked,
  });

  ok(res, {
    ...global,
    stockCode: code,
    verdict,
    reasons,
    stockContext: {
      cooldown,
      recentManualExits: recentForCode.map((r) => ({
        tradeId: r.tradeId,
        triggeredAt: r.context.triggeredAt,
        reasonCode: r.context.reasonCode,
        returnPct: r.returnPct,
        biasAssessment: r.context.biasAssessment,
      })),
    },
  });
});

export default router;
