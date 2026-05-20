// @responsibility CLI diagnostic for Shadow Always-On policy invariants across defensive modes.
import { resolveShadowAlwaysOnPolicy } from '../server/shadow/shadowAlwaysOnPolicy.js';

const ALL_MODES = [
  'NORMAL',
  'DEGRADED',
  'SELL_ONLY',
  'SHADOW_ONLY',
  'OBSERVE_ONLY',
  'R6_DEFENSE',
  'HARD_BLOCK',
] as const;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function resolveModes(): string[] {
  const mode = argValue('--mode');
  if (!mode) return [...ALL_MODES];
  return [mode.toUpperCase()];
}

function isJsonMode(): boolean {
  return process.argv.includes('--json');
}

function diagnose(mode: string) {
  return {
    mode,
    policy: resolveShadowAlwaysOnPolicy({
      engineMode: mode,
      effectiveRegime: mode === 'R6_DEFENSE' ? 'R6_DEFENSE' : undefined,
      marketSession: mode === 'NORMAL' || mode === 'DEGRADED' ? 'OPEN' : undefined,
      liveExecutionAllowed: mode === 'NORMAL' || mode === 'DEGRADED',
      realOrderAllowed: mode === 'NORMAL' || mode === 'DEGRADED',
    }),
  };
}

function invariantStatus(policy: ReturnType<typeof resolveShadowAlwaysOnPolicy>): 'PASS' | 'FAIL' {
  return policy.invariant.liveBlockedDoesNotBlockShadow
    && policy.invariant.providerIssueDoesNotBecomeMarketSignal
    && policy.invariant.shadowLearningAlwaysOn
    ? 'PASS'
    : 'FAIL';
}

const rows = resolveModes().map(diagnose);

if (isJsonMode()) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('Shadow Always-On Policy Diagnostic');
  for (const row of rows) {
    const { mode, policy } = row;
    console.log(`mode=${mode}`);
    console.log(`liveBuyAllowed=${policy.liveBuyAllowed}`);
    console.log(`liveSellAllowed=${policy.liveSellAllowed}`);
    console.log(`shadowScanAllowed=${policy.shadowScanAllowed}`);
    console.log(`shadowSignalAllowed=${policy.shadowSignalAllowed}`);
    console.log(`shadowPaperFillAllowed=${policy.shadowPaperFillAllowed}`);
    console.log(`shadowPositionManagementAllowed=${policy.shadowPositionManagementAllowed}`);
    console.log(`shadowExitAllowed=${policy.shadowExitAllowed}`);
    console.log(`shadowLearningAllowed=${policy.shadowLearningAllowed}`);
    console.log(`counterfactualAllowed=${policy.counterfactualAllowed}`);
    console.log(`executionImpact=${policy.executionImpact}`);
    console.log(`reason=${policy.reason}`);
    console.log(`invariant=${invariantStatus(policy)}`);
    console.log('');
  }
}
