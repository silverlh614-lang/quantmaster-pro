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
import { readAlertAuditRange } from '../../alerts/alertAuditLog.js';
import { computeWeeklyHygiene } from '../../alerts/weeklyHygieneAudit.js';
import { countPendingAcks, listPendingAcks } from '../../alerts/ackTracker.js';
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

/**
 * Phase 6 대시보드 API — 오늘 KST 00:00 이후 알림을 티어·카테고리별 집계.
 * UI가 "아침 커피 마시며" 푸시 없이 열어볼 수 있는 배경 라디오.
 */
router.get('/alerts/today', (_req: any, res: any) => {
  const nowMs = Date.now();
  const kstNow = new Date(nowMs + 9 * 3_600_000);
  const kstMidnight = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3_600_000;
  const entries = readAlertAuditRange(kstMidnight, nowMs);
  const byTier = {
    T1_ALARM:  entries.filter(e => e.tier === 'T1_ALARM').length,
    T2_REPORT: entries.filter(e => e.tier === 'T2_REPORT').length,
    T3_DIGEST: entries.filter(e => e.tier === 'T3_DIGEST').length,
  };
  const catMap = new Map<string, number>();
  for (const e of entries) catMap.set(e.category, (catMap.get(e.category) ?? 0) + 1);
  const byCategory = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
  res.json({
    windowStart: new Date(kstMidnight).toISOString(),
    windowEnd:   new Date(nowMs).toISOString(),
    total: entries.length,
    byTier,
    byCategory,
    recent: entries.slice(-20).reverse(),
  });
});

/** 주간 알림 감사 리포트 데이터 — hygieneAudit과 동일 계산식. */
router.get('/alerts/hygiene/week', (_req: any, res: any) => {
  res.json(computeWeeklyHygiene());
});

/** 미확인 T1 ACK 목록 — 상단 배지·알림 센터용. */
router.get('/alerts/pending-acks', (_req: any, res: any) => {
  res.json({
    count: countPendingAcks(),
    entries: listPendingAcks(),
  });
});

export default router;
