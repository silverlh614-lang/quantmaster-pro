/** @responsibility ADR-0493 audit result persistence boundary with no live side effects. */
import type { DataPromotionAuditResult, StoredPromotionAuditRecord } from '../../types/dataPromotion.types';

export interface PromotionAuditStore {
  save(result: DataPromotionAuditResult): StoredPromotionAuditRecord;
  list(): readonly StoredPromotionAuditRecord[];
  clear(): void;
}

function toStoredRecord(result: DataPromotionAuditResult): StoredPromotionAuditRecord {
  return {
    auditId: result.auditId,
    dataLineId: result.dataLineId,
    currentStage: result.currentStage,
    requestedNextStage: result.requestedNextStage,
    status: result.status,
    decision: result.decision,
    score: result.score,
    blockReasons: [...result.blockReasons],
    warnings: [...result.warnings],
    auditedAt: result.auditedAt,
  };
}

export function createInMemoryPromotionAuditStore(initialRecords: readonly StoredPromotionAuditRecord[] = []): PromotionAuditStore {
  const records = initialRecords.map((record) => ({ ...record, blockReasons: [...record.blockReasons], warnings: [...record.warnings] }));
  return {
    save(result) {
      const record = toStoredRecord(result);
      records.push(record);
      return { ...record, blockReasons: [...record.blockReasons], warnings: [...record.warnings] };
    },
    list() {
      return records.map((record) => ({ ...record, blockReasons: [...record.blockReasons], warnings: [...record.warnings] }));
    },
    clear() {
      records.length = 0;
    },
  };
}

export const defaultPromotionAuditStore = createInMemoryPromotionAuditStore();
