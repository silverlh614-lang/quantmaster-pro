/**
 * @responsibility ADR-454 compatibility export — Near-Miss Outcome Ledger repository facade.
 *
 * ADR-454 문서의 nearMissOutcomeRepo 명칭을 유지하면서 현행 구현(nearMissOutcomeLedger)
 * 을 재노출한다. 실매수 승격 경로가 아니며 executionImpact=NONE ledger 만 다룬다.
 */
export * from './nearMissOutcomeLedger.js';
