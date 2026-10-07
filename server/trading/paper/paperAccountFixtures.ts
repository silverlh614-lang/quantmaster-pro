// @responsibility Supply validated account fixtures through the production signal pipeline.
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';

const reference = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), adaptiveTestSnapshot().asOf);
export function accountSignalFixture() {
  const snapshot = adaptiveTestSnapshot(); snapshot.observations[0].price = 100;
  const strategy = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, structuredClone(reference));
  if (!strategy.trades[0]?.entryDecision.adaptiveEvidence) throw new Error('Account fixture needs a verified signal');
  return { snapshot, strategy, trade: strategy.trades[0] };
}
