import { runKisSupplyWiringAudit } from '../server/diagnostics/kisSupplyWiringAudit';

const result = runKisSupplyWiringAudit();
const asJson = process.argv.includes('--json');

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log('KIS Supply Wiring Audit');
console.log(`- detected paths: ${result.totalDetectedPaths}`);
console.log(`- registry coverage: ${result.registeredPaths}/${result.totalDetectedPaths}`);
console.log(`- missing registry paths: ${result.missingRegistryPaths.length}`);
console.log(`- order endpoints detected: ${result.orderEndpointsDetected.length}`);
console.log(`- supply endpoints: ${result.supplyEndpointsDetected.length}`);
console.log(`- diagnostic/shadow/advisory: ${result.diagnosticOnlyEndpoints.length + result.shadowOnlyEndpoints.length + result.advisoryEndpoints.length}`);
console.log(`- weighted or higher: ${result.weightedOrHigherEndpoints.length}`);
console.log(`- providerIssueMarketSignalLeak: ${result.summary.hasProviderIssueMarketSignalLeak}`);
console.log(`- unexpectedCoreSupplyConnection: ${result.summary.hasUnexpectedCoreSupplyConnection}`);
console.log(`Recommended: ${result.summary.recommendedNextAction}`);
