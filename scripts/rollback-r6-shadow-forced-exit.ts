// @responsibility One-shot rollback CLI for forbidden Shadow R6 forced-exit fills
import { rollbackR6ShadowForcedExitPolicyViolations } from '../server/trading/maintenance/rollbackR6ShadowForcedExit.js';

const dryRun = !process.argv.includes('--apply');
const result = rollbackR6ShadowForcedExitPolicyViolations({ dryRun });

console.log(JSON.stringify(result, null, 2));
if (dryRun) {
  console.log('Dry run only. Re-run with --apply to restore matching Shadow positions.');
}
