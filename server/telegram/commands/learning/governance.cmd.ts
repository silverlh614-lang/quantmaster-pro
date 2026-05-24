// @responsibility /governance ADR-0525 Promotion Governance review UX. Approval-gated; no runtime CORE mutation.
import { buildWeightFeedbackReport } from '../../../learning/dynamicWeightFeedback.js';
import { outcomeClosureRepo } from '../../../learning/outcomeClosure.js';
import {
  formatGovernanceCompact,
  formatGovernanceDetail,
  formatGovernanceItem,
  promotionGovernanceRepo,
} from '../../../learning/promotionGovernance.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';

type GovernanceAction =
  | 'read'
  | 'simulate'
  | 'approve'
  | 'reject'
  | 'defer'
  | 'quarantine'
  | 'create_draft'
  | 'apply_draft'
  | 'rollback';

function splitIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
}

export function resolveGovernancePermission(ctx: Pick<CommandContext, 'userId'>, action: GovernanceAction): boolean {
  if (action === 'read') return true;
  const userId = ctx.userId;
  const operatorIds = splitIds(process.env.TELEGRAM_OPERATOR_USER_IDS);
  const adminIds = splitIds(process.env.TELEGRAM_ADMIN_USER_IDS);
  if (operatorIds.length || adminIds.length) {
    if (action === 'apply_draft' || action === 'rollback') return !!userId && adminIds.includes(userId);
    return !!userId && (operatorIds.includes(userId) || adminIds.includes(userId));
  }
  if (!userId) return true;
  if (action === 'apply_draft' || action === 'rollback') return userId === 'admin' || userId === 'system';
  return userId === 'operator' || userId === 'admin' || userId === 'system';
}

function ensureReviewItemsLoaded(): void {
  if (promotionGovernanceRepo.listItems().length > 0) return;
  const report = buildWeightFeedbackReport({
    seeds: outcomeClosureRepo.listSeeds(),
    createdAt: new Date().toISOString(),
  });
  promotionGovernanceRepo.loadFromFeedbackReport(report);
}

function reasonFrom(args: string[], start: number): string {
  return args.slice(start).join(' ').trim() || 'operator review action';
}

function requirePermission(ctx: CommandContext, action: GovernanceAction): string | null {
  if (resolveGovernancePermission(ctx, action)) return null;
  return `UNAUTHORIZED_GOVERNANCE_ACTION action=${action} executionImpact=NONE`;
}

function formatDraftList(): string {
  const drafts = promotionGovernanceRepo.listDrafts();
  if (!drafts.length) return '[Strategy Draft]\nnone\nimpact: NONE';
  return [
    '[Strategy Draft]',
    ...drafts.map(draft => `- ${draft.draftId} ${draft.status} base=${draft.baseVersion} proposed=${draft.proposedVersion} rollback=${draft.rollbackPlanId}`),
    'impact: NONE',
  ].join('\n');
}

const governance: TelegramCommand = {
  name: '/governance',
  aliases: ['/strategy_draft', '/strategy_rollback'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'Promotion governance review, simulation, draft and rollback controls',
  usage: '/governance [detail|item|simulate|approve|reject|defer|quarantine] | /strategy_draft create|apply | /strategy_rollback <version>',
  async execute(ctx) {
    const { args, command, reply } = ctx;
    ensureReviewItemsLoaded();
    const cmd = command ?? '/governance';
    const op = (args[0] ?? '').toLowerCase();
    try {
      if (cmd === '/strategy_draft') {
        if (op === 'create') {
          const block = requirePermission(ctx, 'create_draft');
          if (block) return reply(block);
          const draft = promotionGovernanceRepo.createDraftFromApproved({ actor: ctx.userId ?? 'operator' });
          return reply(`[Strategy Draft]\ncreated: ${draft.draftId}\nstatus: ${draft.status}\nrollbackPlan: ${draft.rollbackPlanId}\nautoApply: false\nimpact: NONE`);
        }
        if (op === 'apply') {
          const block = requirePermission(ctx, 'apply_draft');
          if (block) return reply(block);
          const draftId = args[1];
          if (!draftId) return reply('USAGE: /strategy_draft apply {draftId}');
          const draft = promotionGovernanceRepo.applyDraft(draftId, ctx.userId ?? 'admin');
          return reply(`[Strategy Draft]\napplied: ${draft.draftId}\nstatus: ${draft.status}\nruntimeCoreMutation=false\nimpact: NONE`);
        }
        return reply(formatDraftList());
      }

      if (cmd === '/strategy_rollback') {
        const block = requirePermission(ctx, 'rollback');
        if (block) return reply(block);
        const versionId = args[0];
        if (!versionId) return reply('USAGE: /strategy_rollback {versionId}');
        const draft = promotionGovernanceRepo.rollback(versionId, ctx.userId ?? 'admin');
        return reply(`[Strategy Rollback]\nversion: ${versionId}\nstatus: ${draft.status}\nrestoredFromRollbackMetadata=true\nimpact: NONE`);
      }

      if (op === 'detail') return reply(formatGovernanceDetail(promotionGovernanceRepo.listItems()));
      if (op === 'item') {
        const item = promotionGovernanceRepo.getItem(args[1] ?? '');
        return reply(item ? formatGovernanceItem(item) : `GOVERNANCE_ITEM_NOT_FOUND:${args[1] ?? ''}`);
      }
      if (op === 'simulate') {
        const block = requirePermission(ctx, 'simulate');
        if (block) return reply(block);
        const item = promotionGovernanceRepo.runSimulation(args[1] ?? '', outcomeClosureRepo.listSeeds(), ctx.userId ?? 'operator');
        return reply(formatGovernanceItem(item));
      }
      if (['approve', 'reject', 'defer', 'quarantine'].includes(op)) {
        const action = op as 'approve' | 'reject' | 'defer' | 'quarantine';
        const block = requirePermission(ctx, action);
        if (block) return reply(block);
        const itemId = args[1] ?? '';
        const reason = reasonFrom(args, 2);
        const item = action === 'approve'
          ? promotionGovernanceRepo.approve(itemId, reason, ctx.userId ?? 'operator')
          : action === 'reject'
            ? promotionGovernanceRepo.reject(itemId, reason, ctx.userId ?? 'operator')
            : action === 'defer'
              ? promotionGovernanceRepo.defer(itemId, reason, ctx.userId ?? 'operator')
              : promotionGovernanceRepo.quarantine(itemId, reason, ctx.userId ?? 'operator');
        return reply(formatGovernanceItem(item));
      }
      return reply(formatGovernanceCompact(promotionGovernanceRepo.listItems()));
    } catch (error) {
      return reply(`GOVERNANCE_COMMAND_FAILED: ${error instanceof Error ? error.message : String(error)}\nexecutionImpact=NONE`);
    }
  },
};

commandRegistry.register(governance);

export default governance;
