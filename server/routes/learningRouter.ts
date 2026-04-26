/**
 * @responsibility 운영자 진단용 학습 이력·상태 GET 엔드포인트와 F2W drift 알림 POST 통로
 */

import { Router, Request, Response } from 'express';
import { getLearningStatus, getLearningHistory } from '../learning/learningHistorySummary.js';
import { handleF2WDriftAlert } from '../alerts/f2wDriftAlert.js';
import {
  KNOWN_REFLECTION_MODULES,
  getAllModuleStatuses,
} from '../learning/reflectionImpactPolicy.js';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  try {
    const snapshot = getLearningStatus();
    res.json(snapshot);
  } catch (e) {
    console.error('[learningRouter] /status 실패:', e);
    res.status(500).json({ error: 'learning_status_failed' });
  }
});

router.get('/history', (req: Request, res: Response) => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw >= 1 && raw <= 30 ? Math.floor(raw) : 7;
  try {
    const summary = getLearningHistory(days);
    res.json(summary);
  } catch (e) {
    console.error('[learningRouter] /history 실패:', e);
    res.status(500).json({ error: 'learning_history_failed' });
  }
});

/**
 * ADR-0046 (PR-Y1): 클라이언트 F2W drift 감지 → 서버 텔레그램 알림 통로.
 *
 * 클라이언트는 학습 사이클에서 drift 감지 시 본 endpoint 를 호출.
 * 서버는 dispatchAlert(JOURNAL) + sendPrivateAlert 일괄 발송 (24h dedupe).
 */
router.post('/f2w-drift-alert', async (req: Request, res: Response) => {
  try {
    const result = await handleF2WDriftAlert(req.body);
    res.json(result);
  } catch (e) {
    console.error('[learningRouter] /f2w-drift-alert 실패:', e);
    res.status(500).json({ error: 'f2w_drift_alert_failed' });
  }
});

/**
 * ADR-0047 (PR-Y2): Reflection Module Half-Life 진단 endpoint.
 *
 * 13개 모듈의 status (normal/grace/silent/deprecated) + impactRate + runs/meaningfulRuns
 * + firstSeenAt + ageDays 일괄 반환. 운영자가 어떤 모듈이 silent 임계 근처인지 즉시 파악.
 */
router.get('/reflection-impact', (req: Request, res: Response) => {
  try {
    const rawDays = Number(req.query.days);
    const days = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 365
      ? Math.floor(rawDays)
      : 180;
    const reports = getAllModuleStatuses(
      KNOWN_REFLECTION_MODULES.slice(),
      new Date(),
      { windowDays: days },
    );
    res.json({
      windowDays: days,
      modules: reports,
      summary: {
        total: reports.length,
        normal: reports.filter(r => r.status === 'normal').length,
        grace: reports.filter(r => r.status === 'grace').length,
        silent: reports.filter(r => r.status === 'silent').length,
        deprecated: reports.filter(r => r.status === 'deprecated').length,
      },
    });
  } catch (e) {
    console.error('[learningRouter] /reflection-impact 실패:', e);
    res.status(500).json({ error: 'reflection_impact_failed' });
  }
});

export default router;
