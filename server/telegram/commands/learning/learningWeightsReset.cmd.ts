// @responsibility /learning_weights_reset command resets learned condition weights with backup confirmation.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  CONDITION_WEIGHT_REGIMES,
  loadConditionWeights,
  loadConditionWeightsByRegime,
  resetConditionWeightsToDefault,
  type ConditionWeightResetScope,
  type ConditionWeights,
} from '../../../persistence/conditionWeightsRepo.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../../../quantFilter.js';

type ParsedResetArgs = {
  dryRun: boolean;
  scope: ConditionWeightResetScope;
  regime?: string;
  error?: string;
};

const CONTROL_TOKENS = new Set(['confirm', '--confirm', 'dryrun', 'dry-run', 'preview']);
const EPSILON = 0.000001;

function parseResetArgs(args: string[]): ParsedResetArgs {
  const tokens = args.map((arg) => arg.trim()).filter(Boolean);
  const lowered = tokens.map((arg) => arg.toLowerCase());
  const hasConfirm = lowered.includes('confirm') || lowered.includes('--confirm');
  const hasDryRun = lowered.some((arg) => arg === 'dryrun' || arg === 'dry-run' || arg === 'preview');
  const dryRun = !hasConfirm || hasDryRun;
  const scopeToken = tokens.find((arg) => !CONTROL_TOKENS.has(arg.toLowerCase()));
  if (!scopeToken || scopeToken.toLowerCase() === 'global') {
    return { dryRun, scope: 'global' };
  }
  if (scopeToken.toLowerCase() === 'all') {
    return { dryRun, scope: 'all' };
  }
  const regime = scopeToken.toUpperCase();
  if (CONDITION_WEIGHT_REGIMES.includes(regime as (typeof CONDITION_WEIGHT_REGIMES)[number])) {
    return { dryRun, scope: 'regime', regime };
  }
  return {
    dryRun: true,
    scope: 'global',
    error: `unknown scope "${scopeToken}"`,
  };
}

function countDrift(weights: ConditionWeights): number {
  return Object.keys(DEFAULT_CONDITION_WEIGHTS)
    .filter((key) => {
      const conditionKey = key as keyof ConditionWeights;
      return Math.abs(weights[conditionKey] - DEFAULT_CONDITION_WEIGHTS[conditionKey]) > EPSILON;
    })
    .length;
}

function displayFile(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

function loadWeightsForScope(parsed: ParsedResetArgs): ConditionWeights {
  if (parsed.scope === 'regime' && parsed.regime) {
    return loadConditionWeightsByRegime(parsed.regime);
  }
  return loadConditionWeights();
}

function formatDryRun(parsed: ParsedResetArgs): string {
  const weights = loadWeightsForScope(parsed);
  const driftCount = countDrift(weights);
  const scopeText = parsed.scope === 'regime' ? `regime:${parsed.regime}` : parsed.scope;
  const confirmTarget = parsed.scope === 'regime' ? parsed.regime : parsed.scope;
  return [
    '<b>[Learning weights reset dry-run]</b>',
    `scope=${scopeText}`,
    `currentDriftCount=${driftCount}`,
    'mutation=false',
    'executionImpact=NONE',
    'liveExecutionAllowed=false',
    'shadowLearningImpact=NONE',
    '',
    `Apply: /learning_weights_reset confirm ${confirmTarget}`,
  ].join('\n');
}

const learningWeightsReset: TelegramCommand = {
  name: '/learning_weights_reset',
  aliases: ['/weights_reset', '/reset_weights'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 1,
  showInMenu: true,
  menuPriority: 0,
  description: 'Reset learned condition weights to defaults',
  usage: '/learning_weights_reset [dryrun|confirm] [global|all|R2_BULL]',
  async execute({ args, reply }) {
    const parsed = parseResetArgs(args);
    if (parsed.error) {
      await reply([
        '<b>[Learning weights reset]</b>',
        `error=${parsed.error}`,
        'usage=/learning_weights_reset [dryrun|confirm] [global|all|R2_BULL]',
        `knownRegimes=${CONDITION_WEIGHT_REGIMES.join(',')}`,
        'mutation=false',
      ].join('\n'));
      return;
    }
    if (parsed.dryRun) {
      await reply(formatDryRun(parsed));
      return;
    }

    const result = resetConditionWeightsToDefault({
      scope: parsed.scope,
      regime: parsed.regime,
    });
    await reply([
      '<b>[Learning weights reset applied]</b>',
      `scope=${result.scope}${parsed.regime ? `:${parsed.regime}` : ''}`,
      `resetGlobal=${result.resetGlobal}`,
      `resetRegimes=${result.resetRegimes.join(',') || 'none'}`,
      `backupFiles=${result.backupFiles.map(displayFile).join(',') || 'none'}`,
      `touchedFiles=${result.touchedFiles.map(displayFile).join(',') || 'none'}`,
      'executionImpact=NONE',
      'liveExecutionAllowed=false',
      'shadowLearningImpact=NONE',
    ].join('\n'));
  },
};

commandRegistry.register(learningWeightsReset);

export default learningWeightsReset;
