// @responsibility stage1Audit.cmd 텔레그램 모듈
// @responsibility: /stage1_audit — Stage 1 정량 필터 탈락 사유 분포 리포트 (튜닝 가이드). TRD (read-only).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const stage1Audit: TelegramCommand = {
  name: '/stage1_audit',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Stage 1 정량 필터 탈락 분포 (임계값 튜닝 가이드)',
  async execute({ reply }) {
    const { getStage1RejectionCounts } = await import('../../../screener/pipelineHelpers.js');
    const s = getStage1RejectionCounts();
    if (s.totalEvaluated === 0) {
      await reply(
        `🔬 <b>[Stage 1 Audit]</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `아직 실행된 스캔이 없습니다. /scan 또는 /krx_scan 실행 후 다시 시도.`,
      );
      return;
    }
    const rows = Object.entries(s.byReason)
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => {
        const pct = s.totalRejected > 0 ? (count / s.totalRejected) * 100 : 0;
        const bar =
          count === 0
            ? '·'
            : pct >= 30
              ? '🔴'
              : pct >= 15
                ? '🟠'
                : pct >= 5
                  ? '🟡'
                  : '🟢';
        return `${bar} ${reason.padEnd(20)} ${count.toString().padStart(3)}건 (${pct.toFixed(0)}%)`;
      })
      .join('\n');
    const passPct = s.totalEvaluated > 0 ? (s.totalPassed / s.totalEvaluated) * 100 : 0;
    await reply(
      `🔬 <b>[Stage 1 Audit — 정량 필터 탈락 분포]</b>\n` +
      `평가 ${s.totalEvaluated} · 통과 ${s.totalPassed} (${passPct.toFixed(0)}%) · 탈락 ${s.totalRejected}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<pre>${rows}</pre>\n` +
      `<i>상위 원인이 30% 이상이면 임계값 완화 검토 — 예: OVEREXTENDED 집중 = 5일 ≥15% 상한이 엄격.</i>\n` +
      `<i>업데이트: ${new Date(s.lastUpdatedAt).toLocaleString('ko-KR')}</i>`,
    );
  },
};

commandRegistry.register(stage1Audit);

export default stage1Audit;
