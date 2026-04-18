/**
 * diagnosticRouter.ts — 데이터 정합성 진단 API
 *
 * 목적: shadow-trades.json (최종 상태)과 shadow-log.json (이벤트 로그) 간
 *       데이터 정합성을 검증하여 UI 표기 오류의 근본 원인을 특정한다.
 *
 * 엔드포인트:
 *   GET /api/diagnostic/reconcile/:stockCode  — 특정 종목 정합성 상세
 *   GET /api/diagnostic/health-check          — 전 종목 무결성 점수
 *   GET /api/diagnostic/volume-status         — Volume 마운트 및 파일 상태
 *   GET /api/diagnostic/position-events/:id   — 특정 position의 이벤트 타임라인
 *
 * 페르소나 원칙:
 *   - 원칙 3: "단일 신호보다 합치 우선" — 4지점 교차 검증
 *   - 원칙 16: "데이터 신뢰도를 구분" — 로그 vs 최종 상태 구분
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { SHADOW_FILE, SHADOW_LOG_FILE, DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import { loadGateAudit } from '../persistence/gateAuditRepo.js';
import {
  runPostmortem,
  getLastPostmortemReport,
  getEmptyScanCount,
} from '../orchestrator/emptyScanPostmortem.js';
import { getCompletenessSnapshot } from '../screener/dataCompletenessTracker.js';

const router = express.Router();

// ─── 매도 이벤트 상수 (집계 대상) ─────────────────────────────────────────────

/** 실현 손익 계산에 포함되는 매도 이벤트 목록 */
const SELL_EVENTS = new Set([
  'RRR_COLLAPSE_PARTIAL',
  'PROFIT_TRANCHE',
  'EUPHORIA_PARTIAL',
  'CASCADE_HALF_SELL',
  'DIVERGENCE_PARTIAL',
  'HIT_STOP',
  'HIT_TARGET',
  'FULLY_CLOSED_TRANCHES',
  'MA60_DEATH_FORCE_EXIT',
  'R6_EMERGENCY_EXIT',
  'CASCADE_STOP_FINAL',
  'CASCADE_STOP_BLACKLIST',
]);

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** shadow-log.json을 안전하게 로드 (없으면 빈 배열) */
function loadShadowLogs(): any[] {
  if (!fs.existsSync(SHADOW_LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHADOW_LOG_FILE, 'utf-8'));
  } catch (e) {
    console.error('[Diagnostic] shadow-log.json 파싱 실패:', e);
    return [];
  }
}

/**
 * 단일 position의 이벤트들을 집계하여 실현 손익을 계산.
 * exitPrice가 없는 이벤트는 returnPct로 역산한다 (정확도 열화).
 */
interface PositionAggregate {
  positionId: string;
  stockCode: string;
  stockName: string;
  entryPrice: number;
  entryDate: string;
  originalQuantity: number;
  realizedQty: number;
  remainingQty: number;
  totalRealizedPnL: number;
  weightedReturnPct: number;
  events: Array<{
    ts: string;
    event: string;
    soldQty?: number;
    exitPrice?: number;
    returnPct?: number;
    exitRuleTag?: string;
  }>;
  exitBreakdown: Record<string, { qty: number; pnl: number }>;
  /** 현재 shadow-trades.json에 기록된 최종 상태 */
  currentSnapshot: {
    status: string;
    quantity: number;
    returnPct?: number;
    exitRuleTag?: string;
    stopLossExitType?: string;
  } | null;
  /** 정합성 이슈 목록 */
  issues: string[];
}

function aggregatePosition(positionId: string, logs: any[], snapshot: any | null): PositionAggregate {
  const related = logs.filter((l) => l.id === positionId).sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
  const first = related[0] ?? {};
  const originalQuantity = first.originalQuantity ?? first.quantity ?? 0;
  const entryPrice = first.shadowEntryPrice ?? 0;

  const agg: PositionAggregate = {
    positionId,
    stockCode: first.stockCode ?? 'UNKNOWN',
    stockName: first.stockName ?? 'UNKNOWN',
    entryPrice,
    entryDate: first.signalTime ?? first.ts ?? '',
    originalQuantity,
    realizedQty: 0,
    remainingQty: originalQuantity,
    totalRealizedPnL: 0,
    weightedReturnPct: 0,
    events: [],
    exitBreakdown: {},
    currentSnapshot: snapshot ? {
      status: snapshot.status,
      quantity: snapshot.quantity,
      returnPct: snapshot.returnPct,
      exitRuleTag: snapshot.exitRuleTag,
      stopLossExitType: snapshot.stopLossExitType,
    } : null,
    issues: [],
  };

  for (const log of related) {
    agg.events.push({
      ts: log.ts,
      event: log.event,
      soldQty: log.soldQty,
      exitPrice: log.exitPrice,
      returnPct: log.returnPct,
      exitRuleTag: log.exitRuleTag,
    });

    if (!SELL_EVENTS.has(log.event)) continue;

    const soldQty = log.soldQty ?? (log.event === 'HIT_STOP' || log.event === 'HIT_TARGET' ? (log.quantity ?? 0) : 0);
    if (soldQty <= 0) {
      agg.issues.push(`${log.event} 이벤트의 soldQty를 확정할 수 없음 (${log.ts})`);
      continue;
    }

    // exitPrice 우선, 없으면 returnPct로 역산
    let exitPrice = log.exitPrice;
    if (exitPrice === undefined && log.returnPct !== undefined && entryPrice > 0) {
      exitPrice = entryPrice * (1 + log.returnPct / 100);
      agg.issues.push(`${log.event}에 exitPrice 누락 — returnPct로 역산 (${log.ts})`);
    }
    if (exitPrice === undefined) {
      agg.issues.push(`${log.event} 실현손익 계산 불가 — exitPrice 및 returnPct 모두 없음 (${log.ts})`);
      continue;
    }

    const pnl = (exitPrice - entryPrice) * soldQty;
    agg.totalRealizedPnL += pnl;
    agg.realizedQty += soldQty;

    const tag = log.exitRuleTag ?? log.event;
    if (!agg.exitBreakdown[tag]) agg.exitBreakdown[tag] = { qty: 0, pnl: 0 };
    agg.exitBreakdown[tag].qty += soldQty;
    agg.exitBreakdown[tag].pnl += pnl;
  }

  agg.remainingQty = originalQuantity - agg.realizedQty;
  agg.weightedReturnPct =
    originalQuantity > 0 && entryPrice > 0
      ? (agg.totalRealizedPnL / (entryPrice * originalQuantity)) * 100
      : 0;

  // ── 정합성 이슈 검출 ──
  // 1. 포지션 종료(HIT_STOP/HIT_TARGET) 후 realizedQty !== originalQuantity
  const hasFinalEvent = related.some((l) => l.event === 'HIT_STOP' || l.event === 'HIT_TARGET' || l.event === 'FULLY_CLOSED_TRANCHES');
  if (hasFinalEvent && agg.realizedQty !== originalQuantity) {
    agg.issues.push(
      `포지션 종료됨에도 매도 수량 합계(${agg.realizedQty}) ≠ originalQuantity(${originalQuantity})`,
    );
  }

  // 2. snapshot의 returnPct가 가중평균과 다름
  if (snapshot && snapshot.returnPct !== undefined && Math.abs(snapshot.returnPct - agg.weightedReturnPct) > 0.5) {
    agg.issues.push(
      `shadow-trades.json의 returnPct(${snapshot.returnPct.toFixed(2)}%) ≠ 가중평균(${agg.weightedReturnPct.toFixed(2)}%) — UI 왜곡 원인`,
    );
  }

  // 3. snapshot의 quantity가 remainingQty와 다름
  if (snapshot && snapshot.quantity !== agg.remainingQty) {
    agg.issues.push(
      `shadow-trades.json의 quantity(${snapshot.quantity}) ≠ 이벤트 로그 잔여(${agg.remainingQty})`,
    );
  }

  return agg;
}

// ─── 엔드포인트 1: 특정 종목 정합성 ───────────────────────────────────────────

router.get('/diagnostic/reconcile/:stockCode', (req, res) => {
  try {
    const code = req.params.stockCode.replace(/[^0-9]/g, '').slice(0, 6);
    if (code.length !== 6) {
      return res.status(400).json({ error: '종목코드는 6자리 숫자여야 합니다' });
    }

    const shadows = loadShadowTrades();
    const logs = loadShadowLogs();

    const related = shadows.filter((s) => s.stockCode === code);
    const positionIds = Array.from(new Set(related.map((s) => s.id).concat(logs.filter((l) => l.stockCode === code).map((l) => l.id))));

    const positions = positionIds
      .filter((id) => typeof id === 'string')
      .map((id) => {
        const snapshot = related.find((s) => s.id === id) ?? null;
        return aggregatePosition(id as string, logs, snapshot);
      });

    const totalIssues = positions.reduce((sum, p) => sum + p.issues.length, 0);

    res.json({
      stockCode: code,
      positionCount: positions.length,
      totalIssues,
      isReconciled: totalIssues === 0,
      positions,
    });
  } catch (e: any) {
    console.error('[Diagnostic reconcile] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 엔드포인트 2: 전 종목 Health Check ───────────────────────────────────────

router.get('/diagnostic/health-check', (_req, res) => {
  try {
    const shadows = loadShadowTrades();
    const logs = loadShadowLogs();

    // shadow-trades.json에 있는 모든 포지션 + shadow-log.json에만 있는 고아 포지션
    const snapshotIds = new Set(shadows.map((s) => s.id));
    const logIds = new Set(logs.filter((l) => l.id).map((l) => l.id as string));
    const allIds = new Set([...snapshotIds, ...logIds]);

    let totalPositions = 0;
    let issuePositions = 0;
    const allIssues: Array<{ positionId: string; stockName: string; issues: string[]; weightedReturnPct: number; snapshotReturnPct?: number }> = [];

    for (const id of allIds) {
      if (typeof id !== 'string') continue;
      totalPositions++;
      const snapshot = shadows.find((s) => s.id === id) ?? null;
      const agg = aggregatePosition(id, logs, snapshot);

      if (agg.issues.length > 0) {
        issuePositions++;
        allIssues.push({
          positionId: id,
          stockName: agg.stockName,
          issues: agg.issues,
          weightedReturnPct: parseFloat(agg.weightedReturnPct.toFixed(2)),
          snapshotReturnPct: snapshot?.returnPct !== undefined ? parseFloat(snapshot.returnPct.toFixed(2)) : undefined,
        });
      }
    }

    // 고아 포지션 (log만 있고 shadow-trades.json엔 없음)
    const orphanPositions = [...logIds].filter((id) => !snapshotIds.has(id as string));

    res.json({
      totalPositions,
      issuePositions,
      orphanLogOnly: orphanPositions.length,
      integrityRate:
        totalPositions > 0
          ? `${(((totalPositions - issuePositions) / totalPositions) * 100).toFixed(1)}%`
          : 'N/A',
      issues: allIssues.slice(0, 100), // 최대 100건 반환
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[Diagnostic health-check] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 엔드포인트 3: Volume 상태 ────────────────────────────────────────────────

router.get('/diagnostic/volume-status', (_req, res) => {
  try {
    const files: Array<{ name: string; size: number; modified: string; birth?: string }> = [];

    if (fs.existsSync(DATA_DIR)) {
      const names = fs.readdirSync(DATA_DIR).filter((n) => !n.startsWith('.'));
      for (const name of names) {
        const fullPath = path.join(DATA_DIR, name);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          files.push({
            name,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            birth: stat.birthtime.toISOString(),
          });
        }
      }
    }

    // 쓰기 가능 테스트
    let writable = false;
    try {
      const testFile = path.join(DATA_DIR, `.write-test-${Date.now()}`);
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      writable = true;
    } catch {
      writable = false;
    }

    const totalSize = files.reduce((s, f) => s + f.size, 0);

    res.json({
      dataDir: DATA_DIR,
      persistDataDirEnv: process.env.PERSIST_DATA_DIR ?? null,
      cwd: process.cwd(),
      writable,
      fileCount: files.length,
      totalSizeBytes: totalSize,
      totalSizeKB: parseFloat((totalSize / 1024).toFixed(2)),
      files: files.sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? '')).slice(0, 50),
    });
  } catch (e: any) {
    console.error('[Diagnostic volume-status] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 엔드포인트 4: 특정 position의 이벤트 타임라인 ───────────────────────────

router.get('/diagnostic/position-events/:id', (req, res) => {
  try {
    const id = req.params.id;
    const logs = loadShadowLogs();
    const shadows = loadShadowTrades();

    const related = logs.filter((l) => l.id === id).sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
    if (related.length === 0) {
      return res.status(404).json({ error: `positionId ${id}에 해당하는 이벤트 없음` });
    }

    const snapshot = shadows.find((s) => s.id === id) ?? null;
    const agg = aggregatePosition(id, logs, snapshot);

    res.json(agg);
  } catch (e: any) {
    console.error('[Diagnostic position-events] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 엔드포인트 5: 오늘 가장 많이 탈락시킨 게이트 조건 TOP N ──────────────────
//
// GateStatusWidget 상단에 "오늘의 병목 TOP 3"를 노출하기 위한 집계 API.
// gateAuditRepo의 당일 누적(passed/failed)을 실패율 기준으로 정렬해 반환.
// 빈 스캔 원인이 "모멘텀" 단일일 수도, "정배열+볼륨돌파" 결합일 수도 있어
// 단순 전체 % 하나가 아니라 조건별 TOP을 보여주는 게 자가개선의 출발점이 된다.

const CONDITION_LABEL_KO: Record<string, string> = {
  momentum:          '모멘텀',
  ma_alignment:      '정배열',
  volume_breakout:   '볼륨 돌파',
  per:               'PER',
  turtle_high:       '터틀 돌파',
  relative_strength: '상대강도',
  vcp:               'VCP',
  volume_surge:      '거래량 급증',
  rsi_zone:          'RSI 구간',
  macd_bull:         'MACD 정방향',
  pullback:          '눌림목',
  ma60_rising:       'MA60 상승',
  weekly_rsi_zone:   '주봉 RSI',
  supply_confluence: '수급 합치',
  earnings_quality:  '실적 품질',
};

const TOP_BLOCKERS_MIN_SAMPLE = 5;

router.get('/diagnostics/top-blockers', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(10, parseInt(String(req.query.limit ?? '3'), 10)));
    const audit = loadGateAudit();

    const rows = Object.entries(audit)
      .map(([key, s]) => {
        const total = s.passed + s.failed;
        const failRate = total > 0 ? s.failed / total : 0;
        return {
          conditionKey:  key,
          conditionName: CONDITION_LABEL_KO[key] ?? key,
          passed:        s.passed,
          failed:        s.failed,
          total,
          failRate:      parseFloat((failRate * 100).toFixed(1)), // %로 환산
        };
      })
      .filter((r) => r.total >= TOP_BLOCKERS_MIN_SAMPLE)
      .sort((a, b) => b.failRate - a.failRate || b.failed - a.failed);

    res.json({
      totalConditions: Object.keys(audit).length,
      minSample:       TOP_BLOCKERS_MIN_SAMPLE,
      topBlockers:     rows.slice(0, limit),
      timestamp:       new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[Diagnostic top-blockers] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 엔드포인트 6: 빈 스캔 포스트모템 ────────────────────────────────────────
//
// 현재 시점의 레짐 + 최근 scan traces + gate audit를 근거로
// 빈 스캔이 "기능인지(HEALTHY_REJECTION) 버그인지(PATHOLOGICAL_BLOCK)"를 판정.
// 자동 트리거(3회 누적)가 아직 돌지 않아도 운용자가 수동 조회 가능.

router.get('/diagnostics/empty-scan-postmortem', (_req, res) => {
  try {
    const report = runPostmortem();
    res.json({
      ...report,
      consecutiveEmptyScans: getEmptyScanCount(),
      cachedLast: getLastPostmortemReport(),
    });
  } catch (e: any) {
    console.error('[Diagnostic postmortem] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── 엔드포인트 7: 데이터 완성도 스냅샷 ────────────────────────────────────
//
// MTAS/DART 보강 실패율 + 종목별 완성도 점수. isDataStarved=true이면
// signalScanner가 신규 진입을 보류하도록 게이팅 중임을 뜻한다.

router.get('/diagnostics/data-completeness', (_req, res) => {
  try {
    res.json(getCompletenessSnapshot());
  } catch (e: any) {
    console.error('[Diagnostic data-completeness] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
