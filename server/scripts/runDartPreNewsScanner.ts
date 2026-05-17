// @responsibility DART 선행공시 스캐너 CLI 실행
import { runDartPreNewsPipeline } from '../dart/dartPreNewsPipeline.js';

runDartPreNewsPipeline().then((result) => {
  console.log(JSON.stringify({ candidates: result.candidates.length, storedCount: result.storedCount, executionImpact: result.executionImpact }, null, 2));
}).catch((error: unknown) => {
  console.error('[DART_PRE_NEWS_FATAL]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
