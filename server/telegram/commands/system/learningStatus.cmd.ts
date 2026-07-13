// @responsibility learningStatus.cmd 텔레그램 모듈
// @responsibility: /learning_status 명령 — 직전 nightly reflection 1건 + 편향 + 실험 + suggest 7일 요약.
import { getLearningStatus } from '../../../learning/learningHistorySummary.js';
import { formatLearningStatusMessage } from '../../../learning/learningHistoryFormatter.js';
import { buildNearMissOutcomeAnalyticsReport } from '../../../learning/nearMissOutcomeAnalytics.js';
import {
  buildGateReclassificationProposalReport,
  formatGateReclassificationProposalReport,
  isGateReclassificationProposalDisabled,
} from '../../../learning/gateReclassificationProposal.js';
import {
  buildGateReclassificationApprovalPlan,
  formatGateReclassificationApprovalPlan,
  isGateReclassificationApprovalPlanDisabled,
} from '../../../learning/gateReclassificationApprovalPlan.js';
import {
  formatGateReclassificationRolloutSummary,
  isGateReclassificationRolloutDisabled,
  summarizeGateReclassificationRollout,
} from '../../../learning/gateReclassificationRolloutPolicy.js';
import { loadGateReclassificationRolloutPlan } from '../../../persistence/gateReclassificationRolloutRepo.js';
import {
  buildRuntimePipelineAuditSnapshot,
  formatRuntimePipelineAuditCompactLine,
  isRuntimePipelineAuditDisabled,
} from '../../../diagnostics/runtimePipelineAudit.js';
import { emitReportSectionWarn } from '../../../observability/reportSectionWarn.js';

function emitLearningStatusSectionWarn(message: string, error?: unknown): void {
  emitReportSectionWarn({
    section: 'LEARNING_STATUS',
    code: 'P2_LEARNING_STATUS_SECTION_DEGRADED',
    message: String(message).slice(0, 180),
    error,
    dedupKey: `p2:telegram:section:LEARNING_STATUS:${String(message).slice(0, 96)}`,
  });
}

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const learningStatus: TelegramCommand = {
  name: '/learning_status',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '직전 reflection · 편향 · 실험 제안 · suggest 알림 7일 요약',
  async execute({ reply }) {
    try {
      const snapshot = getLearningStatus();
      let message = formatLearningStatusMessage(snapshot);

      if (!isGateReclassificationProposalDisabled() || !isGateReclassificationApprovalPlanDisabled()) {
        try {
          const analytics = buildNearMissOutcomeAnalyticsReport();
          const proposalReport = buildGateReclassificationProposalReport(analytics);

          if (!isGateReclassificationProposalDisabled()) {
            const section = formatGateReclassificationProposalReport(proposalReport);
            if (section) message += `\n\n${section}`;
          }

          if (!isGateReclassificationApprovalPlanDisabled()) {
            const plan = buildGateReclassificationApprovalPlan(proposalReport);
            const section = formatGateReclassificationApprovalPlan(plan);
            if (section) message += `\n\n${section}`;
          }
        } catch (e) {
          emitLearningStatusSectionWarn('[ADR-456] Gate reclassification proposal failed:', e instanceof Error ? e.message : e);
          emitLearningStatusSectionWarn('[ADR-457] Gate reclassification approval plan failed:', e instanceof Error ? e.message : e);
        }
      }

      if (!isGateReclassificationRolloutDisabled()) {
        try {
          const rolloutPlan = loadGateReclassificationRolloutPlan();
          const rolloutSection = formatGateReclassificationRolloutSummary(
            summarizeGateReclassificationRollout(rolloutPlan),
          );
          if (rolloutSection) message += `\n\n${rolloutSection}`;
        } catch (e) {
          emitLearningStatusSectionWarn('[ADR-459] Gate reclassification rollout failed:', e instanceof Error ? e.message : e);
        }
      }

      try {
        if (!isRuntimePipelineAuditDisabled()) {
          message += `\n\n${formatRuntimePipelineAuditCompactLine(buildRuntimePipelineAuditSnapshot())}`;
        }
      } catch (e) {
        emitLearningStatusSectionWarn('[ADR-461] Runtime audit compact line failed:', e instanceof Error ? e.message : e);
      }

      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /learning_status 실패:', e);
      await reply('❌ 학습 상태 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(learningStatus);
