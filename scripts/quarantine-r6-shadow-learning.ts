// @responsibility One-shot learning quarantine CLI for forbidden Shadow R6 forced-exit samples
import { quarantineR6ShadowForcedExitLearningSamples } from '../server/trading/maintenance/rollbackR6ShadowForcedExit.js';

const dryRun = !process.argv.includes('--apply');
const result = quarantineR6ShadowForcedExitLearningSamples({ dryRun });

console.log(JSON.stringify(result, null, 2));
if (dryRun) {
  console.log('Dry run only. Re-run with --apply to quarantine matching learning samples.');
}
