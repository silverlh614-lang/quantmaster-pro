// @responsibility /strategy ADR-0526 Strategy Versioning and Rollback UX. Version registry only; no direct runtime config mutation.
import {
  formatStrategyCompact,
  formatStrategyDetail,
  formatStrategyDiff,
  formatStrategyVersion,
  strategyVersionRepo,
  type RolloutStage,
} from '../../../learning/strategyVersioning.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { CommandContext, TelegramCommand } from '../_types.js';

type StrategyAction = 'read' | 'apply_shadow' | 'apply_canary' | 'apply_live' | 'rollback';

function splitIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
}

export function resolveStrategyPermission(ctx: Pick<CommandContext, 'userId'>, action: StrategyAction): boolean {
  if (action === 'read') return true;
  const userId = ctx.userId;
  const operatorIds = splitIds(process.env.TELEGRAM_OPERATOR_USER_IDS);
  const adminIds = splitIds(process.env.TELEGRAM_ADMIN_USER_IDS);
  if (operatorIds.length || adminIds.length) {
    if (action === 'apply_live') return !!userId && adminIds.includes(userId);
    if (action === 'rollback') return !!userId && (operatorIds.includes(userId) || adminIds.includes(userId));
    return !!userId && (operatorIds.includes(userId) || adminIds.includes(userId));
  }
  if (!userId) return true;
  if (action === 'apply_live') return userId === 'admin' || userId === 'system';
  return userId === 'operator' || userId === 'admin' || userId === 'system';
}

function guard(ctx: CommandContext, action: StrategyAction): string | null {
  if (resolveStrategyPermission(ctx, action)) return null;
  return `UNAUTHORIZED_STRATEGY_ACTION action=${action} executionImpact=NONE`;
}

function parseStage(op: string): RolloutStage | null {
  if (op === 'apply_shadow') return 'SHADOW';
  if (op === 'apply_canary') return 'CANARY';
  if (op === 'apply_live') return 'LIVE';
  return null;
}

const strategy: TelegramCommand = {
  name: '/strategy',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'Strategy version registry, diff, apply and rollback controls',
  usage: '/strategy [detail|version|diff|apply_shadow|apply_canary|apply_live|rollback_live|rollback_shadow]',
  async execute(ctx) {
    const { args, reply } = ctx;
    const op = (args[0] ?? '').toLowerCase();
    try {
      if (op === 'detail') return reply(formatStrategyDetail(strategyVersionRepo));
      if (op === 'version') {
        const version = strategyVersionRepo.getVersion(args[1] ?? '');
        return reply(version ? formatStrategyVersion(version) : `STRATEGY_VERSION_NOT_FOUND:${args[1] ?? ''}`);
      }
      if (op === 'diff') {
        const version = strategyVersionRepo.getVersion(args[1] ?? '');
        return reply(version ? formatStrategyDiff(version) : `STRATEGY_VERSION_NOT_FOUND:${args[1] ?? ''}`);
      }
      const stage = parseStage(op);
      if (stage) {
        const action = op as StrategyAction;
        const blocked = guard(ctx, action);
        if (blocked) return reply(blocked);
        const versionId = args[1] ?? '';
        if (!versionId) return reply(`USAGE: /strategy ${op} {versionId}`);
        const result = strategyVersionRepo.safeApplyStrategyVersion(versionId, stage, ctx.userId ?? 'operator');
        return reply([
          '[Strategy Apply]',
          `version: ${versionId}`,
          `stage: ${stage}`,
          `ok: ${result.ok}`,
          `safeMode: ${result.safeMode}`,
          `reason: ${result.reason ?? 'N/A'}`,
          'shadowLearning: true',
          'impact: NONE',
        ].join('\n'));
      }
      if (op === 'rollback_live' || op === 'rollback_shadow' || op === 'rollback_canary') {
        const blocked = guard(ctx, 'rollback');
        if (blocked) return reply(blocked);
        const target = op === 'rollback_live' ? 'LIVE' : op === 'rollback_shadow' ? 'SHADOW' : 'CANARY';
        const registry = strategyVersionRepo.rollbackStrategyVersion(target, args.slice(1).join(' ') || 'operator rollback', ctx.userId ?? 'operator');
        return reply([
          '[Strategy Rollback]',
          `target: ${target}`,
          `live: ${registry.liveVersionId}`,
          `shadow: ${registry.shadowVersionId}`,
          `canary: ${registry.canaryVersionId ?? 'none'}`,
          'shadowLearning: true',
          'impact: NONE',
        ].join('\n'));
      }
      return reply(formatStrategyCompact(strategyVersionRepo));
    } catch (error) {
      return reply(`STRATEGY_COMMAND_FAILED: ${error instanceof Error ? error.message : String(error)}\nshadowLearning=true\nexecutionImpact=NONE`);
    }
  },
};

commandRegistry.register(strategy);

export default strategy;
