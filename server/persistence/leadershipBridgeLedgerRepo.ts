// @responsibility ADR-0551 LeadershipBridge 주입 결과 관측 ledger — shadow 검증용 영속/요약(executionImpact=NONE).

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDataDir } from './paths.js';

/**
 * LeadershipBridge(ADR-0551) 한 번의 intraday 브릿지 호출 결과를 기록한다.
 * 목적: shadow 검증 1차 게이트 = "리더가 실제로 주입되는가"(added>0)와 스킵 사유 분포를
 * 일별/세션별로 측정. flag(LEADERSHIP_BRIDGE_ENABLED) ON 일 때만 기록되므로 OFF=무기록(byte-identical).
 */
export interface LeadershipBridgeLedgerEntry {
  ts: string;                              // ISO8601 기록 시각
  fed: number;                             // feeder(intradayScanner)가 넘긴 후보 수
  added: number;                           // 신규 MOMENTUM 편입 수
  refreshed: number;                       // 기존 bridge 엔트리 TTL 갱신 수
  skippedTotal: number;
  skippedByReason: Record<string, number>; // not_qualified / already_higher_tier / base_momentum_exists / momentum_full
  addedCodes: string[];
  refreshedCodes: string[];
  kospiDayReturn: number | null;           // 자격 판정 기준(sectorRS≥kospi) 맥락
}

export interface LeadershipBridgeLedgerFile {
  version: 1;
  updatedAt: string | null;
  entries: LeadershipBridgeLedgerEntry[];
}

const LEDGER_FILE = path.join(DATA_DIR, 'leadership-bridge-ledger.json');
const MAX_ENTRIES = 500;

function emptyLedger(): LeadershipBridgeLedgerFile {
  return { version: 1, updatedAt: null, entries: [] };
}

export function loadLeadershipBridgeLedger(): LeadershipBridgeLedgerFile {
  try {
    if (!fs.existsSync(LEDGER_FILE)) return emptyLedger();
    const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')) as Partial<LeadershipBridgeLedgerFile>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      entries: Array.isArray(parsed.entries)
        ? (parsed.entries.filter((e) => e && typeof e.ts === 'string') as LeadershipBridgeLedgerEntry[])
        : [],
    };
  } catch {
    return emptyLedger();
  }
}

export function appendLeadershipBridgeLedgerEntry(
  entry: LeadershipBridgeLedgerEntry,
  now: Date = new Date(),
): LeadershipBridgeLedgerFile {
  const ledger = loadLeadershipBridgeLedger();
  const next: LeadershipBridgeLedgerFile = {
    version: 1,
    updatedAt: now.toISOString(),
    entries: [...ledger.entries, entry].slice(-MAX_ENTRIES),
  };
  ensureDataDir();
  const tmp = `${LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, LEDGER_FILE);
  return next;
}

export interface LeadershipBridgeLedgerSummary {
  totalSessions: number;        // 기록된 브릿지 호출 수
  sessionsWithInjection: number; // added>0 인 호출 수
  injectionRate: number;        // sessionsWithInjection / totalSessions (0~1)
  totalAdded: number;
  totalRefreshed: number;
  avgAddedPerSession: number;
  topSkipReasons: Array<{ reason: string; count: number }>;
  latestAt: string | null;
  executionImpact: 'NONE';
}

/**
 * 검증 요약 — injectionRate(1차 게이트)·스킵 사유 top·평균 편입수. lookbackDays 지정 시 최근 N일만.
 * injectionRate≈0 → 병목은 브릿지가 아니라 feeder(자격 충족 리더 발굴 0) 라는 신호(설계 §4).
 */
export function summarizeLeadershipBridgeLedger(
  lookbackDays?: number,
  now: Date = new Date(),
): LeadershipBridgeLedgerSummary {
  const ledger = loadLeadershipBridgeLedger();
  let entries = ledger.entries;
  if (lookbackDays != null && lookbackDays > 0) {
    const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
    entries = entries.filter((e) => {
      const t = new Date(e.ts).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  const totalSessions = entries.length;
  const sessionsWithInjection = entries.filter((e) => (e.added ?? 0) > 0).length;
  const totalAdded = entries.reduce((s, e) => s + (e.added ?? 0), 0);
  const totalRefreshed = entries.reduce((s, e) => s + (e.refreshed ?? 0), 0);
  const skipAgg = new Map<string, number>();
  for (const e of entries) {
    for (const [reason, n] of Object.entries(e.skippedByReason ?? {})) {
      skipAgg.set(reason, (skipAgg.get(reason) ?? 0) + n);
    }
  }
  const topSkipReasons = [...skipAgg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  return {
    totalSessions,
    sessionsWithInjection,
    injectionRate: totalSessions > 0 ? sessionsWithInjection / totalSessions : 0,
    totalAdded,
    totalRefreshed,
    avgAddedPerSession: totalSessions > 0 ? totalAdded / totalSessions : 0,
    topSkipReasons,
    latestAt: entries.at(-1)?.ts ?? null,
    executionImpact: 'NONE',
  };
}

/**
 * 검증 요약 텍스트(telegram /bridge_stats 표시용, plain text·HTML 무사용). 순수 함수.
 * injectionRate=0 이면 "병목=feeder" 신호를 명시(설계 §4 1차 게이트 해석).
 */
export function formatLeadershipBridgeLedgerSummaryLines(
  s: LeadershipBridgeLedgerSummary,
  flagEnabled: boolean,
): string[] {
  const pct = (s.injectionRate * 100).toFixed(0);
  const verdict = s.totalSessions === 0
    ? '데이터 없음 — flag OFF 이거나 아직 미기록'
    : s.injectionRate === 0
      ? '⚠️ 주입 0 → 병목=feeder(자격 리더 발굴 0), 브릿지 아님'
      : '주입 발생 → Part ii/iii(품질·forward outcome) 평가 가능';
  return [
    '🌉 LeadershipBridge 검증 (ADR-0551, read-only)',
    `flag LEADERSHIP_BRIDGE_ENABLED=${flagEnabled ? 'ON' : 'OFF'}`,
    `세션 ${s.totalSessions} (주입 ${s.sessionsWithInjection})`,
    `injectionRate ${pct}%`,
    `편입 누적 added ${s.totalAdded} / refreshed ${s.totalRefreshed} (avg ${s.avgAddedPerSession.toFixed(1)}/session)`,
    `스킵 top: ${s.topSkipReasons.length > 0 ? s.topSkipReasons.map((r) => `${r.reason}=${r.count}`).join(', ') : 'NONE'}`,
    `latest ${s.latestAt ?? 'N/A'}`,
    `판정: ${verdict}`,
    'executionImpact=NONE',
  ];
}
