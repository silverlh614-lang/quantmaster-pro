// @responsibility /snapshot_latest 텔레그램 명령 — 18:00 KST runtime debug snapshot read-only 진단 (Patch-001/002/003 후속).
/**
 * Patch-SNAPSHOT-LATEST-CMD-001 — `/snapshot_latest` read-only 명령.
 *
 * 사용자 명시 framing (Patch-001/002/003 lifecycle 정합 직접 인용):
 *   "장 종료 후에도 패치를 계속 검증하려면 장중 상태를 재현할 수 있는 snapshot이 필요.
 *    장 종료 후 KIS/KRX/Yahoo/Naver를 새로 호출하면 장중 데이터와 다른 empty/stale/
 *    session-closed 값이 섞여 원인 분석이 왜곡됨. 18:00 KST에 자동으로 replay snapshot을
 *    저장하고, 장 종료 후 Telegram 명령으로 호출/재현할 수 있게 한다."
 *
 * 본 명령의 책임:
 *   - `loadLatestRuntimeDebugSnapshot()` 영속 read-only 호출
 *   - 9 source sanitized block 압축 요약 (universe / gate / supply / watchlist /
 *     sectorEnergy / programTrading / shadow / counterfactual / providerDiagnostics)
 *   - frozenSupplyRows 카운트 + selectedProvider 분포 (Patch-002)
 *   - SnapshotInvestorFlowReplayAdapter 메타 표시 (Patch-002)
 *   - lifecycle 안내 (다음 거래일 09:00 개장 시 초기화 안 함, 다음 평일 18:00 capture overwrite)
 *
 * 절대 invariants:
 *   - read-only (영속 read + 메모리 read-only, KIS/KRX/Yahoo/Naver outbound 0건)
 *   - LIVE 매매 본체 import 0건 (signalScanner / entryEngine / exitEngine / kisClient orders 등)
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - `replayOnly=true` + `executionImpact=NONE` 항상 노출 (운영자 인지 의무)
 *   - 사용자 명시 lifecycle 핵심 invariant: "다음 거래일 09:00 개장 시 초기화 ❌"
 *   - `formatSnapshotLatestMessage` 는 순수 함수 (단위 테스트 가능, nowMs 옵셔널 주입)
 *
 * 출력 형식 (compact, ≤2000 chars):
 *   📸 [Snapshot] 18:00 KST after-hours runtime debug
 *   • snapshotId / capturedAt KST + age
 *   • status: CAPTURED|PARTIAL_CAPTURED + missing[]
 *   • invariants: replayOnly=true · executionImpact=NONE · INTRADAY_REPLAY_EQUIVALENT · providerCalls=0
 *   🔧 Runtime / 🌍 Universe / 🚪 Gate / 💧 Supply / 📋 Watchlist / 🎯 SectorEnergy /
 *   📊 ProgramTrading / 🌑 Shadow / 🔮 Counterfactual / 📡 Provider 9 source 압축
 *   • frozenSupplyRows N개 + selectedProvider 분포 (있을 때만)
 *   • replayAdapter meta (있을 때만)
 *   • lifecycle: 다음 거래일 09:00 개장 시 초기화 ❌ · 다음 평일 18:00 capture overwrite
 *   • 사용법: /snapshot_latest /snap
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  loadLatestRuntimeDebugSnapshot,
  type RuntimeDebugSnapshot,
} from '../../../replay/runtimeDebugSnapshotRepo.js';

// ============================================================================
// 시간 헬퍼 — KST 변환 + age 산출 (외부 의존성 0건)
// ============================================================================

/** UTC ISO → KST "MM/DD HH:mm" 형식 (Asia/Seoul = UTC+9, DST 미적용). */
function formatKstShort(iso: string | undefined, fallback = 'N/A'): string {
  if (!iso) return fallback;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return fallback;
  const kstMs = ms + 9 * 60 * 60 * 1000;
  const date = new Date(kstMs);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi} KST`;
}

/** capturedAt 으로부터 age 산출 — 1시간 미만은 분, 24시간 미만은 시간, 그 외 일자. */
function formatAge(capturedAtIso: string | undefined, nowMs: number): string {
  if (!capturedAtIso) return '';
  const capturedMs = Date.parse(capturedAtIso);
  if (!Number.isFinite(capturedMs)) return '';
  const elapsedMs = nowMs - capturedMs;
  if (elapsedMs < 0) return ' (미래 시각)'; // clock skew 안전 fallback
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return ` (${minutes}분 전)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ` (${hours}시간 ${minutes % 60}분 전)`;
  const days = Math.floor(hours / 24);
  return ` (${days}일 ${hours % 24}시간 전)`;
}

// ============================================================================
// 9 source sanitized block 압축 포매터 — 부재 시 표시 안 함 (잡음 차단)
// ============================================================================

function formatRuntimeLine(snapshot: RuntimeDebugSnapshot): string | null {
  const r = snapshot.runtime;
  if (!r) return null;
  const parts: string[] = [];
  if (typeof r.marketSession === 'string') parts.push(`session=${r.marketSession}`);
  if (typeof r.regime === 'string') parts.push(`regime=${r.regime}`);
  if (typeof r.fomcPhase === 'string') parts.push(`fomc=${r.fomcPhase}`);
  if (typeof r.kellyMultiplier === 'number') parts.push(`kelly=×${r.kellyMultiplier.toFixed(2)}`);
  if (typeof r.engineAlive === 'boolean') parts.push(`alive=${r.engineAlive ? '✅' : '❌'}`);
  if (typeof r.shadowLearningEnabled === 'boolean') parts.push(`shadow=${r.shadowLearningEnabled ? '✅' : '❌'}`);
  if (typeof r.emergencyStop === 'boolean' && r.emergencyStop) parts.push('🛑 emergencyStop');
  if (parts.length === 0) return null;
  return `🔧 Runtime: ${parts.join(' · ')}`;
}

function formatUniverseLine(snapshot: RuntimeDebugSnapshot): string | null {
  const u = snapshot.universe;
  if (!u) return null;
  const parts: string[] = [];
  if (typeof u.candidateCount === 'number') parts.push(`candidates=${u.candidateCount}`);
  if (typeof u.watchlistCount === 'number') parts.push(`watchlist=${u.watchlistCount}`);
  if (u.sections && typeof u.sections === 'object') {
    const sectionPairs = Object.entries(u.sections)
      .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}`);
    if (sectionPairs.length > 0) parts.push(`(${sectionPairs.join(', ')})`);
  }
  if (parts.length === 0) return null;
  return `🌍 Universe: ${parts.join(' · ')}`;
}

function formatGateLine(snapshot: RuntimeDebugSnapshot): string | null {
  const g = snapshot.gate;
  if (!g) return null;
  const parts: string[] = [];
  if (typeof g.gate1Pass === 'number') parts.push(`G1=${g.gate1Pass}`);
  if (typeof g.gate2Pass === 'number') parts.push(`G2=${g.gate2Pass}`);
  if (typeof g.gate3Pass === 'number') parts.push(`G3=${g.gate3Pass}`);
  if (Array.isArray(g.blockers) && g.blockers.length > 0) {
    const top = g.blockers
      .slice(0, 3)
      .map((b) => `${b.reason}:${b.count}`)
      .join(', ');
    if (top) parts.push(`top: ${top}`);
  }
  if (parts.length === 0) return null;
  return `🚪 Gate: ${parts.join(' · ')}`;
}

function formatSupplyLine(snapshot: RuntimeDebugSnapshot): string | null {
  const s = snapshot.supply;
  if (!s) return null;
  const parts: string[] = [];
  if (typeof s.selectedProvider === 'string') parts.push(`provider=${s.selectedProvider}`);
  if (typeof s.semanticAvailable === 'number') parts.push(`semantic=${s.semanticAvailable}`);
  if (typeof s.rawInvestorRowAvailable === 'number') parts.push(`rows=${s.rawInvestorRowAvailable}`);
  if (typeof s.providerIssue === 'boolean' && s.providerIssue) parts.push('⚠️ providerIssue');
  if (typeof s.marketSignal === 'boolean' && s.marketSignal) parts.push('📊 marketSignal');
  if (parts.length === 0) return null;
  return `💧 Supply: ${parts.join(' · ')}`;
}

function formatWatchlistLine(snapshot: RuntimeDebugSnapshot): string | null {
  const w = snapshot.watchlist;
  if (!w) return null;
  const parts: string[] = [];
  if (typeof w.imported === 'number') parts.push(`imported=${w.imported}`);
  if (typeof w.momentumCount === 'number') parts.push(`momentum=${w.momentumCount}`);
  if (typeof w.saturationStatus === 'string' && w.saturationStatus !== 'NORMAL')
    parts.push(`sat=${w.saturationStatus}`);
  if (typeof w.detachedShadowCount === 'number' && w.detachedShadowCount > 0)
    parts.push(`detached=${w.detachedShadowCount}`);
  if (parts.length === 0) return null;
  return `📋 Watchlist: ${parts.join(' · ')}`;
}

function formatSectorEnergyLine(snapshot: RuntimeDebugSnapshot): string | null {
  const e = snapshot.sectorEnergy;
  if (!e) return null;
  const parts: string[] = [];
  if (typeof e.dataQuality === 'string') parts.push(`quality=${e.dataQuality}`);
  if (typeof e.validSectorCount === 'number') parts.push(`valid=${e.validSectorCount}`);
  if (typeof e.sourceTier === 'string') parts.push(`tier=${e.sourceTier}`);
  if (typeof e.sectorBoostAllowed === 'boolean') parts.push(`boost=${e.sectorBoostAllowed ? '✅' : '❌'}`);
  if (typeof e.strongBuyAllowed === 'boolean') parts.push(`SB=${e.strongBuyAllowed ? '✅' : '❌'}`);
  if (parts.length === 0) return null;
  return `🎯 SectorEnergy: ${parts.join(' · ')}`;
}

function formatProgramTradingLine(snapshot: RuntimeDebugSnapshot): string | null {
  const p = snapshot.programTrading;
  if (!p) return null;
  const parts: string[] = [];
  if (typeof p.stockProgramStatus === 'string') parts.push(`stock=${p.stockProgramStatus}`);
  if (typeof p.marketProgramStatus === 'string') parts.push(`market=${p.marketProgramStatus}`);
  if (typeof p.sessionState === 'string') parts.push(`session=${p.sessionState}`);
  if (parts.length === 0) return null;
  return `📊 ProgramTrading: ${parts.join(' · ')}`;
}

function formatShadowLine(snapshot: RuntimeDebugSnapshot): string | null {
  const s = snapshot.shadow;
  if (!s) return null;
  const parts: string[] = [];
  if (typeof s.openPositions === 'number') parts.push(`open=${s.openPositions}`);
  if (typeof s.detachedPositions === 'number' && s.detachedPositions > 0)
    parts.push(`detached=${s.detachedPositions}`);
  if (typeof s.todayCreated === 'number') parts.push(`today+=${s.todayCreated}`);
  if (typeof s.todayClosed === 'number') parts.push(`today−=${s.todayClosed}`);
  if (parts.length === 0) return null;
  return `🌑 Shadow: ${parts.join(' · ')}`;
}

function formatCounterfactualLine(snapshot: RuntimeDebugSnapshot): string | null {
  const c = snapshot.counterfactual;
  if (!c) return null;
  const parts: string[] = [];
  if (typeof c.recordedCount === 'number') parts.push(`recorded=${c.recordedCount}`);
  if (typeof c.nearMissCount === 'number') parts.push(`nearMiss=${c.nearMissCount}`);
  if (typeof c.dryRunRows === 'number') parts.push(`dryRun=${c.dryRunRows}`);
  if (parts.length === 0) return null;
  return `🔮 Counterfactual: ${parts.join(' · ')}`;
}

function formatProviderDiagnosticsLine(snapshot: RuntimeDebugSnapshot): string | null {
  const pd = snapshot.providerDiagnostics;
  if (!pd) return null;
  const providers: string[] = [];
  if (pd.kis && typeof pd.kis === 'object' && Object.keys(pd.kis).length > 0) providers.push('KIS');
  if (pd.krx && typeof pd.krx === 'object' && Object.keys(pd.krx).length > 0) providers.push('KRX');
  if (pd.naver && typeof pd.naver === 'object' && Object.keys(pd.naver).length > 0) providers.push('Naver');
  if (pd.cache && typeof pd.cache === 'object' && Object.keys(pd.cache).length > 0) providers.push('Cache');
  if (pd.yahoo && typeof pd.yahoo === 'object' && Object.keys(pd.yahoo).length > 0) providers.push('Yahoo');
  if (providers.length === 0) return null;
  return `📡 Provider Diagnostics: ${providers.join(' · ')}`;
}

function formatFrozenSupplyRowsLine(snapshot: RuntimeDebugSnapshot): string | null {
  const rows = snapshot.frozenSupplyRows;
  if (!rows || rows.length === 0) return null;
  const providerCounts: Record<string, number> = {};
  for (const row of rows) {
    const p = row.selectedProvider ?? 'UNKNOWN';
    providerCounts[p] = (providerCounts[p] ?? 0) + 1;
  }
  const distribution = Object.entries(providerCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([p, n]) => `${p}:${n}`)
    .join(', ');
  return `💎 frozenSupplyRows: ${rows.length}개 (${distribution})`;
}

function formatReplayAdapterLine(snapshot: RuntimeDebugSnapshot): string | null {
  const adapter = snapshot.snapshotReplayAdapter;
  if (!adapter) return null;
  return `🔁 Replay Adapter: ${adapter.adapterName} · diagnosticOnly=${adapter.diagnosticOnly} · liveExecutionAllowed=${adapter.liveExecutionAllowed}`;
}

// ============================================================================
// Public message builder SSOT — 순수 함수 (단위 테스트 가능, nowMs 옵셔널 주입)
// ============================================================================

/**
 * /snapshot_latest 응답 메시지 빌더 SSOT.
 *
 * @param snapshot - 영속 read 결과 (null 시 부재 안내)
 * @param nowMs - age 산출용 현재 시각 (테스트 격리, 기본값 Date.now())
 *
 * 절대 invariants:
 *   - snapshot 정상 시 `replayOnly=true` + `executionImpact=NONE` 마커 항상 노출
 *   - snapshot null 시 4 원인 안내 (부팅 직후 / 첫 평일 18:00 capture 전 / cron 비활성 / capture 실패)
 *   - 9 source 옵셔널 블록 부재 시 표기 안 함 (잡음 차단)
 *   - 사용자 명시 lifecycle 정합: "다음 거래일 09:00 개장 시 초기화 ❌"
 */
export function formatSnapshotLatestMessage(
  snapshot: RuntimeDebugSnapshot | null,
  nowMs: number = Date.now()
): string {
  if (!snapshot) {
    return [
      `📸 <b>[Snapshot] 18:00 KST snapshot 부재</b>`,
      ``,
      `원인 후보:`,
      `  • 부팅 직후 — 첫 평일 18:00 capture 전`,
      `  • 직전 평일 cron 비활성 (ENV <code>RUNTIME_DEBUG_SNAPSHOT_DISABLED=true</code>)`,
      `  • 직전 평일 capture 실패 (PERSIST_FAILED)`,
      `  • Railway 컨테이너 재시작 + <code>data/replay/</code> 영속 손실`,
      ``,
      `확인:`,
      `  • <code>/cron_status</code> — runtime_debug_snapshot_capture cron 작동`,
      `  • ENV <code>RUNTIME_DEBUG_SNAPSHOT_DISABLED</code> 미설정 또는 <code>=false</code>`,
      `  • 다음 평일 18:00 KST 대기 (장 종료 +2.5h)`,
      ``,
      `ℹ️ 사용법: <code>/snapshot_latest</code> · <code>/snap</code>`,
    ].join('\n');
  }

  const lines: string[] = [];

  // Header
  lines.push(`📸 <b>[Snapshot] 18:00 KST after-hours runtime debug</b>`);
  lines.push(``);

  // Identity
  const capturedKst = formatKstShort(snapshot.capturedAt);
  const age = formatAge(snapshot.capturedAt, nowMs);
  lines.push(`<b>ID:</b> <code>${snapshot.snapshotId}</code>`);
  lines.push(`<b>capturedAt:</b> ${capturedKst}${age}`);
  lines.push(`<b>marketDate:</b> ${snapshot.marketDate}`);

  // Capture status
  if (snapshot.captureStatus === 'PARTIAL') {
    lines.push(`<b>status:</b> 🟡 PARTIAL`);
    if (snapshot.missingSections && snapshot.missingSections.length > 0) {
      lines.push(`  • missing: ${snapshot.missingSections.join(', ')}`);
    }
    if (snapshot.warnings && snapshot.warnings.length > 0) {
      const top = snapshot.warnings.slice(0, 3).join(' / ');
      lines.push(`  • warn: ${top}`);
    }
  } else {
    lines.push(`<b>status:</b> ✅ OK`);
  }

  // Invariants (사용자 명시 — replayOnly=true · executionImpact=NONE 항상 노출)
  lines.push(
    `<b>invariants:</b> replayOnly=${snapshot.replayOnly} · executionImpact=${snapshot.executionImpact} · ${snapshot.sessionInterpretation} · providerCalls=${snapshot.replayGuard.providerCalls}`
  );

  lines.push(``);

  // 9 source sanitized blocks (옵셔널, 부재 시 미렌더)
  const sourceLines = [
    formatRuntimeLine(snapshot),
    formatUniverseLine(snapshot),
    formatGateLine(snapshot),
    formatSupplyLine(snapshot),
    formatWatchlistLine(snapshot),
    formatSectorEnergyLine(snapshot),
    formatProgramTradingLine(snapshot),
    formatShadowLine(snapshot),
    formatCounterfactualLine(snapshot),
    formatProviderDiagnosticsLine(snapshot),
  ].filter((line): line is string => line !== null);

  for (const line of sourceLines) {
    lines.push(line);
  }

  // Patch-002 — frozenSupplyRows + replayAdapter meta (있을 때만)
  const frozenLine = formatFrozenSupplyRowsLine(snapshot);
  if (frozenLine) {
    lines.push(``);
    lines.push(frozenLine);
  }

  const adapterLine = formatReplayAdapterLine(snapshot);
  if (adapterLine) {
    lines.push(adapterLine);
  }

  // Lifecycle (사용자 명시 invariant 정합 — "다음 거래일 09:00 개장 시 초기화 ❌")
  lines.push(``);
  lines.push(
    `<b>lifecycle:</b> 다음 거래일 09:00 개장 시 초기화 ❌ · 다음 평일 18:00 capture 가 overwrite`
  );

  // Sanitize / retention (사용자 명시 — 민감정보 0건 + 단일 latest overwrite 확인)
  lines.push(
    `<b>retention:</b> ${snapshot.retention.model} · sanitize=${snapshot.sanitize.applied} · rawPayload=${snapshot.sanitize.rawPayloadStored}`
  );

  lines.push(``);
  lines.push(
    `ℹ️ 사용법: <code>/snapshot_latest</code> · <code>/snap</code> · <code>/snapshot</code>`
  );

  return lines.join('\n');
}

// ============================================================================
// Command 등록 — SYS riskLevel=0 ADMIN read-only
// ============================================================================

const snapshotLatest: TelegramCommand = {
  name: '/snapshot_latest',
  aliases: ['/snap', '/snap_latest', '/snapshot'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '18:00 KST after-hours runtime debug snapshot 진단 (replayOnly · executionImpact=NONE)',
  async execute({ reply }) {
    try {
      const snapshot = loadLatestRuntimeDebugSnapshot();
      const message = formatSnapshotLatestMessage(snapshot);
      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /snapshot_latest 실패:', e);
      await reply('❌ snapshot 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(snapshotLatest);

export default snapshotLatest;
