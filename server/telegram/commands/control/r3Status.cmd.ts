// @responsibility r3Status.cmd 텔레그램 모듈 — R3 Sanity 단계형 state machine 진단 통합 조회
//
// ADR-0401 — 신규 read-only riskLevel=0 ADMIN 명령. R3 sanity 의 5단계 state
// (CLEAN/WARNING/ELEVATED/SHADOW_ONLY/HARD_BLOCK) + streak 누적 + guards + 영속 latch
// 활성 상태를 1 명령으로 통합 진단.
//
// 외부 부수효과 0 (read-only) — riskLevel=0. ADR-0146 자가 review 정합.
// LIVE 매매 본체 무수정 — read-only 진단 명령만.

import { loadR3SanityBlockState } from '../../../persistence/r3SanityBlockRepo.js';
import {
  getEffectiveR3ViolationStreak,
  getR3ViolationStreakDecayHours,
} from '../../../persistence/r3ViolationStreakRepo.js';
import { getR3SanityProfile } from '../../../trading/signalScanner/r3SanityProfiles.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function formatKstHm(iso: string | undefined): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  const kst = new Date(ts + 9 * 3_600_000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} KST`;
}

function deriveCurrentState(
  consecutiveCount: number,
  profile: ReturnType<typeof getR3SanityProfile>,
): 'CLEAN' | 'WARNING' | 'ELEVATED' | 'SHADOW_ONLY' | 'HARD_BLOCK_PENDING' {
  if (consecutiveCount === 0) return 'CLEAN';
  if (consecutiveCount < profile.elevatedAt) return 'WARNING';
  if (consecutiveCount < profile.shadowOnlyAt) return 'ELEVATED';
  if (consecutiveCount < profile.hardBlockAt) return 'SHADOW_ONLY';
  return 'HARD_BLOCK_PENDING';
}

const r3Status: TelegramCommand = {
  name: '/r3_status',
  aliases: ['/r3', '/r3_state'],
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'R3 Sanity state machine 통합 진단 (read-only) — streak, profile, latch 상태',
  async execute({ reply }) {
    const streak = getEffectiveR3ViolationStreak();
    const latch = loadR3SanityBlockState();
    const decayHours = getR3ViolationStreakDecayHours();
    const profile = getR3SanityProfile(streak.regime);
    const derivedState = deriveCurrentState(streak.consecutiveCount, profile);

    const lines: string[] = [];
    lines.push('🩺 <b>[R3 Sanity 통합 상태 — ADR-0401]</b>');
    lines.push('─────────────────────');

    // 영속 latch (HARD_BLOCK)
    if (latch.active) {
      lines.push('🚨 <b>영속 HARD_BLOCK latch 활성</b>');
      lines.push(`  위반: <code>${latch.violation}</code> / 레짐: <code>${latch.regime}</code>`);
      lines.push(`  발동: ${latch.triggeredAt} (${formatKstHm(latch.triggeredAt)})`);
      lines.push(`  해제: <code>/r3_unblock</code> (텔레그램, ADR-0195) 또는 ENV ACK (ADR-0120)`);
    } else {
      const ackLine = latch.acknowledgedAt
        ? `(마지막 해제: ${latch.acknowledgedAt} / ${latch.acknowledgedBy ?? 'unknown'})`
        : '(한 번도 발동되지 않음)';
      lines.push(`✅ 영속 HARD_BLOCK latch 비활성 ${ackLine}`);
    }

    lines.push('');

    // Streak 누적 상태
    if (streak.violation === 'NONE' || streak.consecutiveCount === 0) {
      lines.push('✅ <b>R3 Violation streak: CLEAN</b> (누적 0회)');
    } else {
      const stateIcon: Record<typeof derivedState, string> = {
        CLEAN: '✅',
        WARNING: '🟡',
        ELEVATED: '🟠',
        SHADOW_ONLY: '⚫️',
        HARD_BLOCK_PENDING: '🚨',
      };
      lines.push(`${stateIcon[derivedState]} <b>R3 Violation streak: ${derivedState}</b>`);
      lines.push(`  위반: <code>${streak.violation}</code> / 레짐: <code>${streak.regime || '?'}</code>`);
      lines.push(`  누적: <b>${streak.consecutiveCount}회</b>`);
      lines.push(
        `  임계: warning ${profile.warningAt} / elevated ${profile.elevatedAt} / ` +
          `shadow ${profile.shadowOnlyAt} / hard ${profile.hardBlockAt}`,
      );
      lines.push(`  최초 감지: ${formatKstHm(streak.firstSeenAt)}`);
      lines.push(`  마지막 갱신: ${formatKstHm(streak.lastSeenAt)}`);
    }

    lines.push('');
    lines.push(`⚙️ <b>설정:</b> decayHours=${decayHours}h (ENV <code>R3_VIOLATION_STREAK_DECAY_HOURS</code>)`);
    lines.push(
      `  profile.minCandidatesForHardBlock=${profile.minCandidatesForHardBlock}` +
        ' (정상 시스템 비활성 시 hardBlock 차단)',
    );

    lines.push('─────────────────────');
    if (latch.active) {
      lines.push('⚠️ <b>HARD_BLOCK latch 활성 — 신규 매수 차단 중</b>');
    } else if (derivedState === 'SHADOW_ONLY' || derivedState === 'HARD_BLOCK_PENDING') {
      lines.push('⚫️ <b>SHADOW_ONLY ephemeral 차단 — 신규 매수 차단 + shadow learning 유지</b>');
      lines.push('<i>다음 정상 스캔 (위반 NONE 또는 24h decay) 시 자동 회복.</i>');
    } else {
      lines.push('🟢 <b>R3 Sanity 차단 없음 — 신규 매수 가능 시간대 자동 진입</b>');
    }

    await reply(lines.join('\n'));
  },
};

commandRegistry.register(r3Status);

export default r3Status;
