// @responsibility runtimeAudit.cmd 텔레그램 모듈
/** ADR-461 Runtime Pipeline Audit — read-only post-rollout safety verification. */
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  buildRuntimePipelineAuditSnapshot,
  formatRuntimePipelineAuditDetails,
  isRuntimePipelineAuditDisabled,
} from '../../../diagnostics/runtimePipelineAudit.js';

const runtimeAudit: TelegramCommand = {
  name: '/runtime_audit',
  aliases: ['/ra'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'ADR-461 런타임 파이프라인 사후 안전 감사',
  usage: '/runtime_audit 또는 /ra',
  async execute({ reply }) {
    if (isRuntimePipelineAuditDisabled()) {
      await reply('📍 Runtime Pipeline Audit (ADR-461): disabled by RUNTIME_PIPELINE_AUDIT_DISABLED=true');
      return;
    }
    try {
      await reply(formatRuntimePipelineAuditDetails(buildRuntimePipelineAuditSnapshot()));
    } catch (e) {
      console.error('[TelegramBot] /runtime_audit 실패:', e);
      await reply('❌ Runtime Pipeline Audit 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(runtimeAudit);

export default runtimeAudit;
