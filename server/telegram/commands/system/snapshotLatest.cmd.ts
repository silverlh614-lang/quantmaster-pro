/**
 * @responsibility /snapshot_latest — 최신 15:19 KST market-close replay snapshot 요약 표시 (read-only).
 *
 * Patch-MARKET-CLOSE-SNAPSHOT-001 §5 — Telegram 진단 명령 SSOT.
 *   - 사용자 명시 lifecycle 정합: 다음 거래일 09:00 개장 시 초기화 안 함, 다음 15:19 capture 가 이전 일자 cleanup.
 *   - loadLatestMarketCloseReplaySnapshot() read-only — 외부 API 호출 0, KIS quota 0 침범.
 *   - executionImpact='NONE' literal type 강제 — replay 결과는 매매 의사결정 입력 절대 금지.
 *   - 민감정보 영속 0건 (intradaySnapshotRepo.redactSensitiveFields SSOT 가 sanitize 보장).
 */
import { commandRegistry } from '../../commandRegistry.js';
import {
  loadLatestMarketCloseReplaySnapshot,
  type MarketCloseReplaySnapshot,
} from '../../../persistence/intradaySnapshotRepo.js';
import type { TelegramCommand } from '../_types.js';

function fmtKstHm(iso: string): string {
  const t = new Date(iso).getTime() + 9 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtAgeMin(iso: string, now: number): string {
  const ageMs = now - new Date(iso).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return '?';
  const min = Math.floor(ageMs / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatSnapshotLatestMessage(
  snapshot: MarketCloseReplaySnapshot | null,
  now: Date = new Date(),
): string {
  if (!snapshot) {
    return [
      '📦 [Market-Close Snapshot] — 없음',
      '━━━━━━━━━━━━━━━━',
      '직전 15:19 KST capture 가 아직 영속되지 않았습니다.',
      '• cron `market_close_snapshot_capture` 등록 여부: `/cron_status`',
      '• ENV `MARKET_CLOSE_SNAPSHOT_DISABLED=true` 확인',
      '• KRX 휴장일은 ScheduleClass=TRADING_DAY_ONLY 로 자동 silent skip',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`📦 [Market-Close Snapshot] ${snapshot.marketDate} r${snapshot.revision}`);
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`• snapshotId: ${snapshot.snapshotId}`);
  lines.push(`• capturedAt: ${fmtKstHm(snapshot.capturedAt)} KST (age=${fmtAgeMin(snapshot.capturedAt, now.getTime())})`);
  lines.push(`• captureKind: ${snapshot.captureKind} · status: ${snapshot.captureStatus}`);
  if (snapshot.missingSections && snapshot.missingSections.length > 0) {
    lines.push(`• missing: ${snapshot.missingSections.join(', ')}`);
  }
  if (snapshot.warnings && snapshot.warnings.length > 0) {
    const head = snapshot.warnings.slice(0, 3);
    lines.push(`• warnings(${snapshot.warnings.length}): ${head.join(' | ')}`);
  }
  lines.push('');

  // 핵심 진단 블록 압축 요약
  if (snapshot.runtime) {
    const r = snapshot.runtime;
    lines.push('🔧 Runtime');
    lines.push(
      `  session=${r.marketSession ?? '?'} sellOnly=${r.sellOnly ?? '?'} regime=${r.regime ?? '?'}`,
    );
    lines.push(
      `  kellyMult=${r.kellyMultiplier ?? '?'} engineAlive=${r.engineAlive ?? '?'} eStop=${r.emergencyStop ?? '?'}`,
    );
  }
  if (snapshot.universe) {
    const u = snapshot.universe;
    lines.push('🌐 Universe');
    lines.push(
      `  candidates=${u.candidateCount ?? '?'} · watchlist=${u.watchlistCount ?? '?'}`,
    );
  }
  if (snapshot.gate) {
    const g = snapshot.gate;
    lines.push('🚪 Gate');
    lines.push(
      `  gate1Pass=${g.gate1Pass ?? '?'} gate2Pass=${g.gate2Pass ?? '?'} gate3Pass=${g.gate3Pass ?? '?'}`,
    );
    if (g.blockers && g.blockers.length > 0) {
      const top = g.blockers.slice(0, 3).map((b) => `${b.reason}:${b.count}`).join(', ');
      lines.push(`  blockers: ${top}`);
    }
  }
  if (snapshot.supply) {
    const s = snapshot.supply;
    lines.push('💧 Supply');
    lines.push(
      `  provider=${s.selectedProvider ?? '?'} semantic=${s.semanticAvailable ?? '?'} actualRow=${s.rawInvestorRowAvailable ?? '?'}`,
    );
  }
  if (snapshot.sectorEnergy) {
    const se = snapshot.sectorEnergy;
    lines.push('⚡ SectorEnergy');
    lines.push(
      `  quality=${se.dataQuality ?? '?'} valid=${se.validSectorCount ?? '?'} sourceTier=${se.sourceTier ?? '?'}`,
    );
  }
  if (snapshot.shadow) {
    const sh = snapshot.shadow;
    lines.push('🌑 Shadow');
    const open = (sh as Record<string, unknown>).openCount ?? (sh as Record<string, unknown>).activeCount ?? '?';
    lines.push(`  openPositions=${open}`);
  }
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('replayOnly=true · executionImpact=NONE (의사결정 입력 금지)');
  lines.push('lifecycle: 다음 거래일 09:00 개장 시 초기화 ❌ · 다음 15:19 capture 가 cleanup');
  lines.push('• 자세히: 후속 PR `/replay_latest` `/snapshot_list` `/snapshot_diff`');
  return lines.join('\n');
}

const snapshotLatest: TelegramCommand = {
  name: '/snapshot_latest',
  aliases: ['/snap', '/snap_latest'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '최신 15:19 KST market-close replay snapshot 요약 (Patch-MARKET-CLOSE-SNAPSHOT-001) — read-only, executionImpact=NONE.',
  async execute({ reply }) {
    try {
      const snap = loadLatestMarketCloseReplaySnapshot();
      await reply(formatSnapshotLatestMessage(snap));
    } catch (e) {
      console.error('[TelegramBot] /snapshot_latest 실패:', e);
      await reply('❌ snapshot 조회 실패 — 영속 파일 손상 또는 권한 결함 가능.');
    }
  },
};

commandRegistry.register(snapshotLatest);

export default snapshotLatest;
