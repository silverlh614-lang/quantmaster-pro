// @responsibility 직전 7일 ghost 거절 사유 분포 + 일별 매수 추이 + 거시 게이트 read-only 진단
// /gate_audit (alias /ga) — 매수 0건 진원지 진단. 출처: loadGhostPortfolio /
// getLastScanSummary / loadMacroState / loadShadowTrades / state. 외부 API 0건.
import {
  loadShadowTrades,
  type ServerShadowTrade,
} from '../../../persistence/shadowTradeRepo.js';
import { loadGhostPortfolio } from '../../../persistence/reflectionRepo.js';
import { loadGateAudit } from '../../../persistence/gateAuditRepo.js';
import type { GhostPosition } from '../../../learning/reflectionTypes.js';
import { loadMacroState, type MacroState } from '../../../persistence/macroStateRepo.js';
import {
  getLastScanSummary,
  type ScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';
import { getEmergencyStop, getAutoTradePaused } from '../../../state.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/** KST(UTC+9) 일자 'YYYY-MM-DD' 추출. 잘못된 입력 → null. */
export function isoToKstDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 일자 키만 보존 — KST 자정 기준 윈도우 셋. */
export function buildDateWindow(now: Date, days: number): string[] {
  const todayKst = isoToKstDate(now.toISOString())!;
  const todayMs = new Date(`${todayKst}T00:00:00+09:00`).getTime();
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = isoToKstDate(new Date(todayMs - i * 86_400_000).toISOString());
    if (d) out.push(d);
  }
  return out;
}

/** rejectionReason 의 분류 키 — `entryRevalidation:GATE_MISS,RRR<1` 같은 prefix 정규화. */
export function normalizeRejectionReason(raw: string | undefined): string {
  if (!raw) return 'UNKNOWN';
  const trimmed = raw.trim();
  if (!trimmed) return 'UNKNOWN';
  const colonIdx = trimmed.indexOf(':');
  return (colonIdx > 0 ? trimmed.slice(0, colonIdx) : trimmed).toUpperCase();
}

export interface RejectionBucket {
  reason: string;
  count: number;
}

/**
 * 윈도우 내 ghost rejection 사유 분포 (count 내림차순).
 * signalDate 가 윈도우 밖이거나 부재하면 제외.
 */
export function aggregateGhostRejections(
  ghosts: GhostPosition[],
  windowDates: string[],
  topN: number = 7,
): RejectionBucket[] {
  const allow = new Set(windowDates);
  const map = new Map<string, number>();
  for (const g of ghosts) {
    if (!g.signalDate || !allow.has(g.signalDate)) continue;
    const key = normalizeRejectionReason(g.rejectionReason);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const arr = Array.from(map.entries()).map(([reason, count]) => ({ reason, count }));
  arr.sort((a, b) => (b.count - a.count) || a.reason.localeCompare(b.reason));
  const limit = Math.max(1, Math.floor(topN));
  return arr.slice(0, limit);
}

export interface DailyGateRow {
  date: string;
  ghosts: number;
  buys: number;
  topReason: string | null;
  topReasonCount: number;
}

/** 일별 ghost 등록수 + buy 카운트 + Top 1 사유. */
export function tallyDailyGhostStats(
  ghosts: GhostPosition[],
  trades: ServerShadowTrade[],
  windowDates: string[],
): DailyGateRow[] {
  const buyMap = new Map<string, number>();
  for (const t of trades) {
    const d = isoToKstDate(t.signalTime);
    if (d) buyMap.set(d, (buyMap.get(d) ?? 0) + 1);
  }
  const reasonByDate = new Map<string, Map<string, number>>();
  for (const g of ghosts) {
    if (!g.signalDate) continue;
    const inner = reasonByDate.get(g.signalDate) ?? new Map<string, number>();
    const key = normalizeRejectionReason(g.rejectionReason);
    inner.set(key, (inner.get(key) ?? 0) + 1);
    reasonByDate.set(g.signalDate, inner);
  }
  return windowDates.map((date) => {
    const inner = reasonByDate.get(date);
    let topReason: string | null = null;
    let topReasonCount = 0;
    let totalGhosts = 0;
    if (inner) {
      for (const [k, v] of inner) {
        totalGhosts += v;
        if (v > topReasonCount || (v === topReasonCount && (topReason === null || k < topReason))) {
          topReason = k; topReasonCount = v;
        }
      }
    }
    return { date, ghosts: totalGhosts, buys: buyMap.get(date) ?? 0, topReason, topReasonCount };
  });
}

export type DiagnosticCase = 'EMERGENCY_STOP' | 'AUTO_TRADE_DISABLED' | 'AUTO_TRADE_PAUSED'
  | 'R6_DEFENSE' | 'BEAR_DEFENSE' | 'VIX_HIGH' | 'MHS_LOW'
  | 'WATCHLIST_EMPTY' | 'GHOST_HEAVY' | 'NO_OBVIOUS_BLOCK';

export interface DiagnosticInputs {
  emergencyStop: boolean;
  autoTradePaused: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  vix: number | undefined;
  mhs: number | undefined;
  bearDefenseMode: boolean | undefined;
  watchlistEmpty: boolean | undefined;
  topReasonRatio: number; // 윈도우 내 top reason / 전체 ghost
  topReason: string | null;
}

/** 우선순위 SSOT — 가장 결정적인 차단 게이트 1건만 반환 (CASE 진단). */
export function inferDiagnosticCase(d: DiagnosticInputs): DiagnosticCase {
  if (d.emergencyStop) return 'EMERGENCY_STOP';
  if (!d.autoTradeEnabled) return 'AUTO_TRADE_DISABLED';
  if (d.autoTradePaused) return 'AUTO_TRADE_PAUSED';
  if (d.regime === 'R6_DEFENSE') return 'R6_DEFENSE';
  if (d.bearDefenseMode === true) return 'BEAR_DEFENSE';
  if (typeof d.vix === 'number' && d.vix >= 28) return 'VIX_HIGH';
  if (typeof d.mhs === 'number' && d.mhs < 30) return 'MHS_LOW';
  if (d.watchlistEmpty === true) return 'WATCHLIST_EMPTY';
  if (d.topReasonRatio >= 0.4 && d.topReason) return 'GHOST_HEAVY';
  return 'NO_OBVIOUS_BLOCK';
}

const CASE_HINT: Record<DiagnosticCase, string> = {
  EMERGENCY_STOP:       '🛑 비상정지 활성 — `/resume` 으로 해제 검토',
  AUTO_TRADE_DISABLED:  '⛔ AUTO_TRADE_ENABLED=false — 환경변수 점검',
  AUTO_TRADE_PAUSED:    '⏸️ 자동매매 일시정지 — `/resume` 또는 운영자 의도 확인',
  R6_DEFENSE:           '🛑 R6_DEFENSE 락 — `/regime` 진단 + ADR-0067 해제 조건 점검',
  BEAR_DEFENSE:         '🐻 Bear Defense 모드 — VKOSPI/외국인 선물 점검',
  VIX_HIGH:             '🌪️ VIX ≥28 진입 차단 — VIX 추세 + suggestThresholds.ts 검토',
  MHS_LOW:              '📉 MHS<30 매수중단 임계 — `/regime` MHS axis 분해 확인',
  WATCHLIST_EMPTY:      '📭 워치리스트 비어있음 — `/krx_scan` 또는 `/refresh_sector_map` 트리거',
  GHOST_HEAVY:          '⚠️ 단일 사유가 ghost 의 40%+ 점유 — 해당 게이트 임계 검토',
  NO_OBVIOUS_BLOCK:     'ℹ️ 명백한 차단 게이트 없음 — `/scan_blockers` + `/learning_status` 종합 검토',
};

/**
 * ADR-0387/0388 — 조건별 status 분포 한 줄 요약.
 * 표본 ≥ 5 인 조건 중 unavailable/error/failed 비율이 임계 초과인 항목 우선 정렬.
 *
 * 우선순위 (가장 위험한 항목 위로):
 *   1. error 비율 ≥ 10%        — evaluator 깨짐 (최우선)
 *   2. unavailable 비율 ≥ 50%  — 데이터 부재 우세
 *   3. failed 비율 ≥ 70%       — 임계 미달 우세
 *   4. 그 외 — 표본 큰 순
 */
export interface ConditionStatusRow {
  key: string;
  passed: number;
  failed: number;
  unavailable: number;
  error: number;
  total: number;
  worstStatus: 'ERROR' | 'UNAVAILABLE' | 'FAILED' | 'OK';
}

export function buildConditionStatusRows(
  audit: Record<string, { passed: number; failed: number; unavailable?: number; error?: number }>,
  topN = 8,
): ConditionStatusRow[] {
  const rows: ConditionStatusRow[] = [];
  for (const [key, s] of Object.entries(audit)) {
    const unavailable = s.unavailable ?? 0;
    const error = s.error ?? 0;
    const total = s.passed + s.failed + unavailable + error;
    if (total < 5) continue;
    const errorRate = error / total;
    const unavailableRate = unavailable / total;
    const failedRate = s.failed / total;
    let worstStatus: ConditionStatusRow['worstStatus'] = 'OK';
    if (errorRate >= 0.1) worstStatus = 'ERROR';
    else if (unavailableRate >= 0.5) worstStatus = 'UNAVAILABLE';
    else if (failedRate >= 0.7) worstStatus = 'FAILED';
    rows.push({ key, passed: s.passed, failed: s.failed, unavailable, error, total, worstStatus });
  }
  // 정렬: ERROR > UNAVAILABLE > FAILED > OK 그룹화 + 그룹 내 표본 큰 순
  const rank: Record<ConditionStatusRow['worstStatus'], number> = {
    ERROR: 0, UNAVAILABLE: 1, FAILED: 2, OK: 3,
  };
  rows.sort((a, b) => {
    const r = rank[a.worstStatus] - rank[b.worstStatus];
    return r !== 0 ? r : b.total - a.total;
  });
  return rows.slice(0, topN);
}

/** 메시지 빌더 SSOT — 6 섹션 (헤더/거시/Top 사유/일별/조건 status/진단). */
export function formatGateAuditMessage(input: {
  windowDays: number;
  buckets: RejectionBucket[];
  daily: DailyGateRow[];
  totalGhostsInWindow: number;
  macro: MacroState | null;
  scan: ScanSummary | null;
  diagnostic: DiagnosticCase;
  diagnosticHint: string;
  emergencyStop: boolean;
  autoTradePaused: boolean;
  autoTradeEnabled: boolean;
  autoTradeMode: string;
  /** ADR-0387/0388 — 조건별 status 분포 (옵셔널 — 데이터 부재 시 섹션 미노출). */
  conditionStatusRows?: ConditionStatusRow[];
}): string {
  const L: string[] = [];
  L.push(`📊 Gate Audit (last ${input.windowDays} days)`);
  L.push('━━━━━━━━━━━━━━━━', '', '🚦 거시 게이트 상태:');
  L.push(`   regime: ${input.macro?.regime ?? '?'}`);
  L.push(`   MHS: ${input.macro?.mhs ?? '?'}` + (typeof input.macro?.mhs === 'number' && input.macro.mhs < 30 ? ' ⚠️ <30' : ''));
  L.push(`   VIX: ${input.macro?.vix ?? '?'}` + (typeof input.macro?.vix === 'number' && input.macro.vix >= 28 ? ' ⚠️ ≥28' : ''));
  L.push(`   bearDefenseMode: ${input.macro?.bearDefenseMode === true ? 'true ⚠️' : 'false'}`);
  L.push(`   AUTO_TRADE_MODE: ${input.autoTradeMode}`);
  L.push(`   AUTO_TRADE_ENABLED: ${input.autoTradeEnabled}` + (input.autoTradeEnabled ? '' : ' ⛔'));
  L.push(`   emergencyStop: ${input.emergencyStop}` + (input.emergencyStop ? ' 🛑' : ''));
  L.push(`   autoTradePaused: ${input.autoTradePaused}` + (input.autoTradePaused ? ' ⏸️' : ''));

  L.push('', `🚧 직전 ${input.windowDays}일 Ghost 거절 사유 (총 ${input.totalGhostsInWindow}건):`);
  if (input.buckets.length === 0) {
    L.push('   (해당 윈도우 ghost 등록 0건)');
  } else {
    for (const b of input.buckets) {
      const pct = input.totalGhostsInWindow > 0
        ? ((b.count / input.totalGhostsInWindow) * 100).toFixed(1)
        : '0.0';
      L.push(`   ${b.reason}: ${b.count}건 (${pct}%)`);
    }
  }

  L.push('', '📅 일별 ghost / buy:');
  for (const r of input.daily) {
    const tail = r.topReason ? ` (${r.topReason} ${r.topReasonCount}건)` : '';
    L.push(`   ${r.date}: ghost=${r.ghosts}  buy=${r.buys}${tail}`);
  }

  if (input.scan) {
    L.push('', '🔬 직전 스캔 (`/scan_blockers` 발췌):');
    L.push(`   time=${input.scan.time}  candidates=${input.scan.candidates}  entries=${input.scan.entries}`);
    if (input.scan.gatePassDistribution) {
      const g = input.scan.gatePassDistribution;
      L.push(`   gate1Pass=${g.gate1Pass}  gate2Pass=${g.gate2Pass}  gate3Pass=${g.gate3Pass}  lastTriggerPass=${g.lastTriggerPass}`);
    }
  }

  // ADR-0387/0388 — 조건별 status 분포 (passed/failed/unavailable/error 4 카운터).
  if (input.conditionStatusRows && input.conditionStatusRows.length > 0) {
    L.push('', '📐 조건별 status (ADR-0387/0388):');
    for (const r of input.conditionStatusRows) {
      const marker
        = r.worstStatus === 'ERROR' ? ' ❌'
        : r.worstStatus === 'UNAVAILABLE' ? ' ⚠️'
        : r.worstStatus === 'FAILED' ? ' 🚧'
        : '';
      const totalSafe = r.total > 0 ? r.total : 1;
      const ePct = ((r.error / totalSafe) * 100).toFixed(0);
      const uPct = ((r.unavailable / totalSafe) * 100).toFixed(0);
      L.push(
        `   ${r.key}: passed=${r.passed} failed=${r.failed} unavailable=${r.unavailable}(${uPct}%) error=${r.error}(${ePct}%)${marker}`,
      );
    }
    L.push('   ❌=evaluator 결함 / ⚠️=데이터 부재 / 🚧=임계 미달');
  }

  L.push('', '🎯 진단:');
  L.push(`   ${input.diagnosticHint}`);
  L.push(`   case=${input.diagnostic}`);
  return L.join('\n');
}

const gateAudit: TelegramCommand = {
  name: '/gate_audit',
  aliases: ['/ga'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '직전 7일 Ghost 거절 사유 분포 + 일별 매수 추이 + 거시 게이트 상태 read-only 진단.',
  usage: '/gate_audit   — alias: /ga',
  async execute({ reply }) {
    try {
      const now = new Date();
      const windowDays = 7;
      const windowDates = buildDateWindow(now, windowDays);
      const allow = new Set(windowDates);
      const ghosts = loadGhostPortfolio();
      const trades = loadShadowTrades();
      const macro = loadMacroState();
      const scan = getLastScanSummary();

      const buckets = aggregateGhostRejections(ghosts, windowDates, 7);
      const daily = tallyDailyGhostStats(ghosts, trades, windowDates);
      const totalGhostsInWindow = ghosts
        .filter((g) => g.signalDate && allow.has(g.signalDate))
        .length;
      const topReason = buckets[0]?.reason ?? null;
      const topReasonRatio = totalGhostsInWindow > 0 && buckets[0]
        ? buckets[0].count / totalGhostsInWindow
        : 0;

      const autoTradeEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
      const autoTradeMode = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
      const emergencyStop = getEmergencyStop();
      const autoTradePaused = getAutoTradePaused();

      const watchlistEmpty = scan?.macroGateState?.watchlistEmpty;
      const bearDefenseMode = macro?.bearDefenseMode ?? scan?.macroGateState?.bearDefenseMode;

      const diagnostic = inferDiagnosticCase({
        emergencyStop,
        autoTradePaused,
        autoTradeEnabled,
        regime: macro?.regime ?? '?',
        vix: macro?.vix,
        mhs: macro?.mhs,
        bearDefenseMode,
        watchlistEmpty,
        topReasonRatio,
        topReason,
      });

      // ADR-0387/0388 — 조건별 status 분포 SSOT (loadGateAudit + buildConditionStatusRows).
      const gateAuditStore = loadGateAudit();
      const conditionStatusRows = buildConditionStatusRows(gateAuditStore, 8);

      await reply(formatGateAuditMessage({
        windowDays,
        buckets,
        daily,
        totalGhostsInWindow,
        macro,
        scan,
        diagnostic,
        diagnosticHint: CASE_HINT[diagnostic],
        emergencyStop,
        autoTradePaused,
        autoTradeEnabled,
        autoTradeMode,
        conditionStatusRows,
      }));
    } catch (e) {
      console.error('[TelegramBot] /gate_audit 실패:', e);
      await reply('❌ Gate audit 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(gateAudit);

export default gateAudit;
