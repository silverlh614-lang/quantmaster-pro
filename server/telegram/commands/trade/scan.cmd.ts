// @responsibility scan.cmd 텔레그램 모듈
// @responsibility: /scan — 직전 스캔 요약 즉시 반환(age). /scan fresh = 백그라운드 강제 재스캔(중복 락). TRD.
import { getEmergencyStop } from '../../../state.js';
import { getLastScanSummary, getLastScanSummaryAt } from '../../../trading/signalScanner.js';
import { triggerScanInBackground } from '../../scanTriggerLock.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function formatAgeKo(ageMs: number): string {
  if (ageMs < 0) return '방금';
  const sec = Math.floor(ageMs / 1000);
  if (sec < 10) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return `${hr}시간 ${min % 60}분 전`;
}

function formatScanQuickSummary(): string {
  const summary = getLastScanSummary();
  const at = getLastScanSummaryAt();
  if (!summary || at === 0) return '직전 스캔 데이터 없음 (미실행).';
  const age = formatAgeKo(Date.now() - at);
  return `직전 스캔 ${age} · 후보 ${summary.candidates ?? 0} / 진입 ${summary.entries ?? 0}. 차단 사유는 /scan_blockers.`;
}

const scan: TelegramCommand = {
  name: '/scan',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '직전 스캔 요약(즉시) · /scan fresh 로 강제 재스캔',
  usage: '/scan [fresh]',
  async execute({ args, reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }

    const fresh = (args[0] ?? '').toLowerCase() === 'fresh';

    if (!fresh) {
      // B2: 최신 요약 즉시 반환 (풀스캔 미실행 — 장중 지연 제거).
      const summary = getLastScanSummary();
      if (summary && getLastScanSummaryAt() > 0) {
        await reply(`📊 ${formatScanQuickSummary()}\n\n💡 강제 재스캔: /scan fresh`);
        return;
      }
      // 직전 스캔이 한 번도 없으면 백그라운드로 채워준다.
      const kicked = triggerScanInBackground({
        onDone: async () => { await reply(`✅ 스캔 완료 — ${formatScanQuickSummary()}`); },
      });
      await reply(
        kicked.alreadyRunning
          ? '⏳ 스캔 진행 중 — 잠시 후 /scan 으로 결과 확인.'
          : '🔍 직전 스캔 없음 — 백그라운드 스캔 시작. 완료되면 결과를 보냅니다.',
      );
      return;
    }

    // B1: /scan fresh — 백그라운드 강제 재스캔 + 중복 트리거 차단.
    const kicked = triggerScanInBackground({
      onDone: async () => { await reply(`✅ 강제 스캔 완료 — ${formatScanQuickSummary()}`); },
      onError: async () => { await reply('❌ 강제 스캔 실패 — 로그 확인 필요.'); },
    });
    await reply(
      kicked.alreadyRunning
        ? '⏳ 이미 스캔 진행 중 — 중복 트리거 생략. 잠시 후 /scan 으로 결과 확인.'
        : '🔍 강제 스캔 시작 — 완료되면 결과를 보냅니다.',
    );
  },
};

commandRegistry.register(scan);

export default scan;
