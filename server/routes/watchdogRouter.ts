/**
 * @responsibility 외부 uptime 모니터가 폴링할 무인증 시스템 살아있음 신호를 제공한다.
 *
 * 보안 패치 Tier 1 #2 — UptimeRobot/Better-Uptime/Cron-job.org 같은 외부 관찰자가
 * 5분 간격으로 GET /api/watchdog/heartbeat 를 폴링한다. 응답 없으면 외부 채널(SMS/이메일)
 * 로 알림 — 자기 자신에게 의존하지 않는 silent degradation 의 진짜 해독제.
 *
 * 응답 본문에는 민감 정보(토큰·키·종목코드·평단가) 0건. healthy 신호 + 4 진단 필드만.
 */

import { Router, Request, Response } from 'express';
import { getLastScanAt } from '../orchestrator/adaptiveScanScheduler.js';
import { summarizeErrors } from '../persistence/persistentErrorLog.js';
import { getEmergencyStop } from '../state.js';

const router = Router();

interface HeartbeatResponse {
  alive: true;
  /** 마지막 스캔 후 경과 초. lastScanAt=0 (미실행) 이면 null. */
  lastScanAgeSec: number | null;
  /** 24시간 내 FATAL 에러 수. */
  criticalErrors24h: number;
  /** 'LIVE' | 'SHADOW' | 'VTS' | 'UNSET'. 토큰/키 노출 없음. */
  mode: 'LIVE' | 'SHADOW' | 'VTS' | 'UNSET';
  /** 비상정지 활성 여부. */
  emergencyStop: boolean;
  /** 응답 생성 ISO 시각 — 외부 관찰자가 stale 응답 식별용. */
  at: string;
}

function resolveMode(): HeartbeatResponse['mode'] {
  const m = (process.env.AUTO_TRADE_MODE ?? '').toUpperCase();
  if (m === 'LIVE' || m === 'SHADOW' || m === 'VTS') return m;
  return 'UNSET';
}

function computeLastScanAgeSec(now: number = Date.now()): number | null {
  const ts = getLastScanAt();
  if (!ts || ts <= 0) return null;
  const age = Math.max(0, Math.floor((now - ts) / 1000));
  return age;
}

router.get('/heartbeat', (_req: Request, res: Response) => {
  const summary = summarizeErrors();
  const body: HeartbeatResponse = {
    alive: true,
    lastScanAgeSec: computeLastScanAgeSec(),
    criticalErrors24h: summary.fatal24h,
    mode: resolveMode(),
    emergencyStop: getEmergencyStop(),
    at: new Date().toISOString(),
  };
  res.status(200).json(body);
});

export default router;
