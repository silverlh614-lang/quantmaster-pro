/**
 * @responsibility GET /api/decision/inputs — emergencyStop + pendingApprovals + macroSignals read-only 합성 (ADR-0052 PR-Z4)
 */

import { Router, type Request, type Response } from 'express';
import { getEmergencyStop } from '../state.js';
import { listPendingApprovals } from '../telegram/buyApproval.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';

const router = Router();

router.get('/inputs', (_req: Request, res: Response) => {
  try {
    const emergencyStop = getEmergencyStop();
    const pending = listPendingApprovals();
    const pendingApprovals = pending
      .map((p) => ({
        stockCode: p.stockCode,
        stockName: p.stockName,
        ageMs: p.ageMs,
      }))
      // 오래된 것부터 (사용자가 가장 늦게 결정한 것이 먼저 표시되어야 함)
      .sort((a, b) => b.ageMs - a.ageMs);

    const macro = loadMacroState();
    const macroSignals = {
      vkospi: macro?.vkospi,
      vkospiDayChange: macro?.vkospiDayChange,
      vix: macro?.vix,
      vixHistory: macro?.vixHistory,
      bearDefenseMode: macro?.bearDefenseMode,
      fssAlertLevel: macro?.fssAlertLevel,
      regime: macro?.regime,
    };

    res.json({
      emergencyStop,
      pendingApprovals,
      macroSignals,
      capturedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[decisionInputsRouter] /inputs 실패:', e);
    res.status(500).json({ error: 'decision_inputs_failed' });
  }
});

export default router;
