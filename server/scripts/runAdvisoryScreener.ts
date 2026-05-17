/**
 * @responsibility Advisory screener manual runner
 */

import { runAdvisoryScreenerPipeline } from '../screener/advisoryScreenerPipeline.js';

const aiEnabled = process.env.ADVISORY_SCREENER_AI_ENABLED === 'true';

runAdvisoryScreenerPipeline({ aiEnabled, persist: true })
  .then((result) => {
    console.log(JSON.stringify({
      count: result.candidates.length,
      executionImpact: result.executionImpact,
      liveExecutionAllowed: result.liveExecutionAllowed,
      shadowLearning: result.shadowLearning,
    }, null, 2));
  })
  .catch((error: unknown) => {
    console.error('[ADVISORY_SCREENER_FAILED]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
