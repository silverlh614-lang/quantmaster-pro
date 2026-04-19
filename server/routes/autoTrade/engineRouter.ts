/**
 * @responsibility 자동매매 엔진 상태 스냅샷 조회·토글·SSE 스트림·비상정지 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET  /auto-trade/engine/status         — 엔진 ON/OFF, 마지막/다음 실행, 오늘 KPI
 *   GET  /auto-trade/engine/stream         — SSE: 5초 간격 + 토글/Kill Switch 즉시 push
 *   POST /auto-trade/engine/toggle         — 비상정지 토글
 *   POST /auto-trade/engine/emergency-stop — 단방향 강제 정지(멱등)
 *   GET  /alerts/feed                      — UI 벨 아이콘용 알림 피드
 */
import { Router } from 'express';
import { loadShadowTrades } from '../../persistence/shadowTradeRepo.js';
import { getLastScanAt } from '../../orchestrator/adaptiveScanScheduler.js';
import {
  getEmergencyStop,
  setEmergencyStop,
  getLastHeartbeat,
  getLastHeartbeatSource,
  getTradingMode,
  getKillSwitchLast,
} from '../../state.js';
import { assessKillSwitch } from '../../trading/killSwitch.js';
import { attachEngineStream, publishEngineStatus } from '../engineStreamBus.js';
import { listAlertFeed, countUnreadSince } from '../../persistence/alertsFeedRepo.js';
import { tradingOrchestrator } from '../../orchestrator/tradingOrchestrator.js';
import { isOpenShadowStatus } from '../../trading/entryEngine.js';
import { getLastBuySignalAt } from '../../trading/signalScanner.js';

const router = Router();

/**
 * 엔진 상태 스냅샷 빌더 — REST(/engine/status) 와 SSE 브로드캐스트가 같은 형태를
 * 공유하도록 단일 함수로 추출. 외부 의존이 없어 매 tick 호출 부담이 낮다.
 */
export function buildEngineStatusSnapshot() {
  const autoEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
  const emergencyStop = getEmergencyStop();
  const running = autoEnabled && !emergencyStop;

  const orchStatus = tradingOrchestrator.getStatus();
  const handlerRanAt = orchStatus.handlerRanAt ?? {};
  const lastRunTs = Object.values(handlerRanAt).sort().pop() ?? null;

  const lastScanTs = getLastScanAt();
  const lastScanAt = lastScanTs > 0 ? new Date(lastScanTs).toISOString() : null;
  const lastBuyTs = getLastBuySignalAt();
  const lastBuySignalAt = lastBuyTs > 0 ? new Date(lastBuyTs).toISOString() : null;

  const todayStr = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const shadows = loadShadowTrades();
  const todayShadows = shadows.filter((s) => (s.signalTime ?? '').slice(0, 10) === todayStr);
  const todayBuys = todayShadows.filter((s) => isOpenShadowStatus(s.status)).length;
  const todayExits = shadows.filter((s) =>
    (s.fills ?? []).some((f) =>
      f.type === 'SELL' &&
      new Date(new Date(f.timestamp).getTime() + 9 * 3_600_000).toISOString().slice(0, 10) === todayStr
    )
  ).length;
  const todayScans = Object.keys(handlerRanAt).length;

  const heartbeatAt = getLastHeartbeat();
  const killSwitch = getKillSwitchLast();
  const killSwitchAssessment = assessKillSwitch();

  return {
    running,
    autoTradeEnabled: autoEnabled,
    emergencyStop,
    mode: getTradingMode(),
    currentState: orchStatus.computedState,
    lastRun: lastRunTs,
    lastScanAt,
    lastBuySignalAt,
    heartbeat: {
      at: heartbeatAt > 0 ? new Date(heartbeatAt).toISOString() : null,
      source: getLastHeartbeatSource(),
      ageMs: heartbeatAt > 0 ? Date.now() - heartbeatAt : null,
    },
    killSwitch: {
      last: killSwitch,
      current: killSwitchAssessment,
    },
    todayStats: { scans: todayScans, buys: todayBuys, exits: todayExits },
  };
}

router.get('/auto-trade/engine/status', (_req: any, res: any) => {
  res.json(buildEngineStatusSnapshot());
});

/**
 * 연결 시 즉시 현재 스냅샷 1회 발신 + 이후 5초 간격 재발신 + 엔진 토글·
 * Kill Switch 이벤트 발생 시 즉시 push. 기존 REST 폴링 대비 트래픽 95% 감소.
 */
router.get('/auto-trade/engine/stream', (req: any, res: any) => {
  attachEngineStream(req, res);
  publishEngineStatus(buildEngineStatusSnapshot());
});

// 5초 간격 엔진 상태 브로드캐스트 — 구독자 0명이면 부하 거의 0.
setInterval(() => {
  try { publishEngineStatus(buildEngineStatusSnapshot()); } catch { /* noop */ }
}, 5_000).unref?.();

router.post('/auto-trade/engine/toggle', (_req: any, res: any) => {
  const current = getEmergencyStop();
  setEmergencyStop(!current);
  const running = process.env.AUTO_TRADE_ENABLED === 'true' && current;
  console.log(`[Engine] 자동매매 엔진 ${current ? '재개' : '정지'} (비상정지 → ${!current})`);
  try { publishEngineStatus(buildEngineStatusSnapshot()); } catch { /* noop */ }
  res.json({ running, emergencyStop: !current });
});

/**
 * `toggle` 은 반전이므로 "이미 정지 상태" 에서 호출하면 역설적으로 재개된다.
 * 비상 경로에서는 이 위험을 허용할 수 없어, 명시적으로 setEmergencyStop(true)
 * 만 수행하는 별도 엔드포인트를 제공한다. 멱등 (여러 번 호출해도 항상 정지).
 */
router.post('/auto-trade/engine/emergency-stop', (_req: any, res: any) => {
  setEmergencyStop(true);
  console.warn('[Engine] 🛑 비상정지 강제 발동 (emergency-stop endpoint)');
  try { publishEngineStatus(buildEngineStatusSnapshot()); } catch { /* noop */ }
  res.json({ running: false, emergencyStop: true });
});

router.get('/alerts/feed', (req: any, res: any) => {
  const sinceId = typeof req.query.sinceId === 'string' ? req.query.sinceId : undefined;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  const priorityParam = typeof req.query.priority === 'string' ? req.query.priority : '';
  const priority = priorityParam ? priorityParam.split(',').filter(Boolean) : undefined;
  const entries = listAlertFeed({ sinceId, limit, priority: priority as any });
  const unread = countUnreadSince(sinceId);
  res.json({ entries, unread });
});

export default router;
