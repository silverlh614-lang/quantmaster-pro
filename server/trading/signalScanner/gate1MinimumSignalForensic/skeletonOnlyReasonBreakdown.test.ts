import { describe, it, expect } from 'vitest';
import { resolveSkeletonOnlyReasonBreakdown } from './formatter.js';

describe('resolveSkeletonOnlyReasonBreakdown (P3 — skeletonOnlyReasonTop reconciliation)', () => {
  it('attributes the full remainder to the fallback reason when no specific reason is known', () => {
    const out = resolveSkeletonOnlyReasonBreakdown(5, 0, 0);
    expect(out.entries).toEqual([['TRACE_CONTAINER_CREATED_BUT_FULL_TECHNICAL_TRACE_NOT_COMPUTED', 5]]);
    expect(out.countSum).toBe(5);
    expect(out.invariant).toBe(true);
  });

  it('splits across known reasons + fallback, always summing to skeletonOnlyTrace', () => {
    const out = resolveSkeletonOnlyReasonBreakdown(5, 2, 1);
    expect(Object.fromEntries(out.entries)).toEqual({
      QUOTE_RETURN_FIELD_MISSING: 2,
      TECHNICAL_FIELD_NOT_COMPUTED: 1,
      TRACE_CONTAINER_CREATED_BUT_FULL_TECHNICAL_TRACE_NOT_COMPUTED: 2,
    });
    expect(out.countSum).toBe(5);
    expect(out.invariant).toBe(true);
  });

  it('caps known reasons so parts never overflow the total (invariant stays true)', () => {
    const out = resolveSkeletonOnlyReasonBreakdown(5, 9, 9);
    expect(Object.fromEntries(out.entries)).toEqual({ QUOTE_RETURN_FIELD_MISSING: 5 });
    expect(out.countSum).toBe(5);
    expect(out.invariant).toBe(true);
  });

  it('omits zero-count reasons and reconciles when fully explained by known reasons', () => {
    const out = resolveSkeletonOnlyReasonBreakdown(4, 4, 0);
    expect(out.entries).toEqual([['QUOTE_RETURN_FIELD_MISSING', 4]]);
    expect(out.countSum).toBe(4);
    expect(out.invariant).toBe(true);
  });
});
