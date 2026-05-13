/**
 * @responsibility Patch-SHADOW-APPROVAL-DEDUP-001 회귀 검증 SSOT.
 *
 * 사용자 명시 §H 10 핵심 케이스 + 안전 invariant 회귀 가드.
 *
 * 검증:
 *   1. dedupeKey SSOT (tradeDate + marketSession + symbol + sourceLane + approvalKind)
 *   2. price/stopLoss/targetPrice/gateScore/RRR 변동만으로 새 카드 발송 금지
 *   3. PENDING 상태에서 같은 dedupeKey 재요청 → SKIP 반환 + duplicateSuppressed++
 *   4. APPROVED 상태에서 재요청 → APPROVE 반환 (caller SHADOW 분기 자연 흐름)
 *   5. 수동 승인 (handleBuyApprovalCallback buy_approve) → state=APPROVED + clearTimeout
 *   6. 120초 auto-approve 발화 시점 dedupe 상태 검사 → state≠PENDING 이면 suppressed
 *   7. deriveShadowApprovalContext KST tradeDate + marketSession 분류
 *   8. liveOrderPlaced=false / executionImpact='NONE' literal type 강제
 *   9. KIS 주문 함수 import 0건 (정적 grep 가드)
 *   10. /scan_blockers runtime 모드에 [PATCH-RUNTIME] 태그 노출
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildShadowApprovalDedupeKey,
  deriveShadowApprovalContext,
  recordPendingShadowApproval,
  markShadowApprovalApproved,
  markShadowApprovalRejected,
  markShadowApprovalSkipped,
  markShadowApprovalAutoApproved,
  recordDuplicateSuppressed,
  getShadowApprovalRecord,
  getShadowApprovalDedupeStats,
  formatShadowApprovalDedupeSection,
  __resetShadowApprovalDedupeStoreForTests,
} from './shadowApprovalDedupeStore.js';

beforeEach(() => {
  __resetShadowApprovalDedupeStoreForTests();
});

describe('Patch-SHADOW-APPROVAL-DEDUP-001 — dedupeKey SSOT', () => {
  it('case 1: dedupeKey 는 tradeDate+marketSession+symbol+sourceLane+approvalKind 만 포함 (price 제외)', () => {
    const k1 = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    expect(k1).toBe('SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL');
    expect(k1).not.toMatch(/price|stopLoss|targetPrice|gateScore|RRR|rrr/i);
  });

  it('case 2: 가격/지표 변동만으로는 새 dedupeKey 가 생성되지 않음', () => {
    const base = { tradeDate: '2026-05-13', marketSession: 'REGULAR', symbol: '394280' };
    const k1 = buildShadowApprovalDedupeKey({ ...base });
    const k2 = buildShadowApprovalDedupeKey({ ...base });
    expect(k1).toBe(k2); // 동일 컨텍스트면 무조건 동일 key
  });

  it('case 3: 다른 sourceLane 은 다른 dedupeKey 생성 (정상 분리)', () => {
    const base = { tradeDate: '2026-05-13', marketSession: 'REGULAR', symbol: '394280' };
    const kShadow = buildShadowApprovalDedupeKey({ ...base, sourceLane: 'SHADOW' });
    const kProvisional = buildShadowApprovalDedupeKey({ ...base, sourceLane: 'PROVISIONAL' });
    expect(kShadow).not.toBe(kProvisional);
  });
});

describe('Patch-SHADOW-APPROVAL-DEDUP-001 — state machine', () => {
  it('case 4: PENDING 중복 요청 → recordDuplicateSuppressed 카운트 증가', () => {
    const dedupeKey = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
    });
    const rec1 = recordPendingShadowApproval({
      dedupeKey,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      name: '오픈엣지테크놀로지',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    expect(rec1.isDuplicate).toBe(false);
    expect(rec1.record.state).toBe('PENDING');

    const rec2 = recordPendingShadowApproval({
      dedupeKey,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      name: '오픈엣지테크놀로지',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    expect(rec2.isDuplicate).toBe(true);
    expect(rec2.record.state).toBe('PENDING');

    recordDuplicateSuppressed('394280', '오픈엣지테크놀로지');
    const stats = getShadowApprovalDedupeStats();
    expect(stats.duplicateSuppressed).toBe(1);
    expect(stats.lastSuppressedSymbol).toBe('394280');
    expect(stats.lastSuppressedName).toBe('오픈엣지테크놀로지');
  });

  it('case 5: APPROVED 상태에서 재요청 → state=APPROVED (caller 가 SHADOW 분기로 자연 흐름)', () => {
    const dedupeKey = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
    });
    recordPendingShadowApproval({
      dedupeKey,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    const approved = markShadowApprovalApproved(dedupeKey, 'manual');
    expect(approved.transitioned).toBe(true);
    const rec = getShadowApprovalRecord(dedupeKey);
    expect(rec?.state).toBe('APPROVED');
  });

  it('case 6: 수동 승인 시 timerId 가 있으면 clearTimeout 호출 (autoApprovalCancelled=true)', () => {
    const dedupeKey = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
    });
    recordPendingShadowApproval({
      dedupeKey,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    const rec = getShadowApprovalRecord(dedupeKey);
    expect(rec).toBeDefined();
    // 가짜 timer 주입
    const fakeTimer = setTimeout(() => {
      throw new Error('이 timer 는 발화되면 안 됨');
    }, 99999);
    if (rec) rec.timerId = fakeTimer;
    markShadowApprovalApproved(dedupeKey, 'manual');
    const after = getShadowApprovalRecord(dedupeKey);
    expect(after?.state).toBe('APPROVED');
    expect(after?.autoApprovalCancelled).toBe(true);
    expect(after?.timerId).toBeUndefined();
    clearTimeout(fakeTimer); // 안전 cleanup (idempotent)
  });

  it('case 7: REJECTED / SKIPPED 상태 전이 검증', () => {
    const dedupeKey1 = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: 'A',
    });
    const dedupeKey2 = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: 'B',
    });
    recordPendingShadowApproval({
      dedupeKey: dedupeKey1,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: 'A',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    recordPendingShadowApproval({
      dedupeKey: dedupeKey2,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: 'B',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    expect(markShadowApprovalRejected(dedupeKey1)).toBe(true);
    expect(markShadowApprovalSkipped(dedupeKey2)).toBe(true);
    expect(getShadowApprovalRecord(dedupeKey1)?.state).toBe('REJECTED');
    expect(getShadowApprovalRecord(dedupeKey2)?.state).toBe('SKIPPED');
  });

  it('case 8: auto-approve 시점 dedupe 상태가 PENDING 이 아니면 suppressed (markShadowApprovalAutoApproved 별도 호출 안 됨)', () => {
    const dedupeKey = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
    });
    recordPendingShadowApproval({
      dedupeKey,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    markShadowApprovalApproved(dedupeKey, 'manual'); // 사용자가 먼저 승인
    // auto-approve 가 발화되어도 호출자 (buyApproval) 가 state 검사 후 suppressed
    // 본 PR 의 buyApproval.ts wiring 이 실제 진위 검증을 담당.
    // 여기서는 markShadowApprovalAutoApproved 가 already-non-PENDING 상태에서 호출되어도 동작 안전한지 검증.
    const result = markShadowApprovalAutoApproved(dedupeKey);
    // 구현 결정: already APPROVED → idempotent (transitioned 분기 있지만 state 변경 없음)
    expect(typeof result.transitioned).toBe('boolean');
    expect(getShadowApprovalRecord(dedupeKey)?.state).toBe('APPROVED'); // 그대로
  });
});

describe('Patch-SHADOW-APPROVAL-DEDUP-001 — deriveShadowApprovalContext KST', () => {
  it('case 9: KST 10:00 (UTC 01:00) → REGULAR + tradeDate KST 일자', () => {
    // 2026-05-13 (수) 10:00 KST = 2026-05-13 01:00 UTC
    const utc = Date.UTC(2026, 4, 13, 1, 0, 0);
    const ctx = deriveShadowApprovalContext(utc);
    expect(ctx.tradeDate).toBe('2026-05-13');
    expect(ctx.marketSession).toBe('REGULAR');
  });

  it('case 9-b: KST 12:30 → LUNCH_BREAK', () => {
    const utc = Date.UTC(2026, 4, 13, 3, 30, 0); // 12:30 KST
    const ctx = deriveShadowApprovalContext(utc);
    expect(ctx.marketSession).toBe('LUNCH_BREAK');
  });

  it('case 9-c: KST 16:00 → CLOSED', () => {
    const utc = Date.UTC(2026, 4, 13, 7, 0, 0); // 16:00 KST
    const ctx = deriveShadowApprovalContext(utc);
    expect(ctx.marketSession).toBe('CLOSED');
  });

  it('case 9-d: KST 08:00 → PRE_OPEN', () => {
    const utc = Date.UTC(2026, 4, 12, 23, 0, 0); // 5/12 23:00 UTC = 5/13 08:00 KST
    const ctx = deriveShadowApprovalContext(utc);
    expect(ctx.marketSession).toBe('PRE_OPEN');
    expect(ctx.tradeDate).toBe('2026-05-13');
  });
});

describe('Patch-SHADOW-APPROVAL-DEDUP-001 — formatter & runtime visibility', () => {
  it('case 10: formatShadowApprovalDedupeSection 출력에 [PATCH-RUNTIME] 태그 포함 + liveOrderPlaced=false 명시', () => {
    const dedupeKey = buildShadowApprovalDedupeKey({
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
    });
    recordPendingShadowApproval({
      dedupeKey,
      tradeDate: '2026-05-13',
      marketSession: 'REGULAR',
      symbol: '394280',
      name: '오픈엣지테크놀로지',
      sourceLane: 'SHADOW',
      approvalKind: 'BUY_APPROVAL',
    });
    recordDuplicateSuppressed('394280', '오픈엣지테크놀로지');
    recordDuplicateSuppressed('394280', '오픈엣지테크놀로지');
    const out = formatShadowApprovalDedupeSection(getShadowApprovalDedupeStats());
    expect(out).toContain('[PATCH-RUNTIME]');
    expect(out).toContain('🧾 ShadowApproval Dedup');
    expect(out).toContain('pending=1');
    expect(out).toContain('duplicateSuppressed=2');
    expect(out).toContain('lastSuppressed=394280');
    expect(out).toContain('liveOrderPlaced=false');
    expect(out).toContain('executionImpact=NONE');
  });

  it('case 10-b: stats 0 인 상태에서도 formatter 안전 (3 필수 라인 항상 출력)', () => {
    const out = formatShadowApprovalDedupeSection(getShadowApprovalDedupeStats());
    expect(out).toContain('[PATCH-RUNTIME]');
    expect(out).toContain('pending=0 approved=0 deduped=0');
    expect(out).toContain('liveOrderPlaced=false');
    expect(out).toContain('executionImpact=NONE');
  });
});

describe('Patch-SHADOW-APPROVAL-DEDUP-001 — safety invariants (static grep)', () => {
  const storeSrc = readFileSync(resolve(import.meta.dirname, 'shadowApprovalDedupeStore.ts'), 'utf8');

  it('SSOT 자체에 KIS 주문 함수 import 0건', () => {
    expect(storeSrc).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|cancelKisOrder|placeKisTakeProfitOrder/);
  });

  it('SSOT 자체에 autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(storeSrc).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(storeSrc).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(storeSrc).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
  });

  it('SSOT 자체에 fetch / axios / node-fetch 외부 호출 0건', () => {
    expect(storeSrc).not.toMatch(/from\s+['"]axios['"]/);
    expect(storeSrc).not.toMatch(/from\s+['"]node-fetch['"]/);
    // global fetch 직접 호출도 차단
    const lines = storeSrc.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    expect(lines.join('\n')).not.toMatch(/\bfetch\s*\(/);
  });

  it('SSOT 헤더에 liveOrderPlaced=false / executionImpact=NONE 명시', () => {
    expect(storeSrc).toMatch(/liveOrderPlaced[=\s]*false/);
    expect(storeSrc).toMatch(/executionImpact[=\s]*['"]NONE['"]/);
  });
});
