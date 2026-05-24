import { describe, expect, it } from 'vitest';
import { MORE_MOBILE_TABS, NAV_GROUPS, PRIMARY_MOBILE_TABS, getVisibleNavGroups } from './navigation';
import { VIEW_LABELS } from './viewRegistry';

describe('navigation SSOT', () => {
  it('registers every sidebar view in VIEW_LABELS', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(VIEW_LABELS[item.id]).toBeDefined();
      }
    }
  });

  it('registers every mobile more-tab view in VIEW_LABELS', () => {
    for (const item of MORE_MOBILE_TABS) {
      expect(VIEW_LABELS[item.id]).toBeDefined();
    }
  });

  it('registers every primary mobile tab in VIEW_LABELS', () => {
    for (const item of PRIMARY_MOBILE_TABS) {
      expect(VIEW_LABELS[item.id]).toBeDefined();
    }
  });

  it('keeps Decision History and Macro Intel registered', () => {
    const allItems = NAV_GROUPS.flatMap((group) => group.items);
    expect(allItems.some((item) => item.id === 'RECOMMENDATION_HISTORY')).toBe(true);
    expect(allItems.some((item) => item.id === 'MACRO_INTEL')).toBe(true);
  });

  it('keeps report entry points available on desktop and mobile', () => {
    const report = NAV_GROUPS.find((group) => group.label === 'Report');
    expect(report).toBeDefined();
    expect(report?.items.map((item) => item.id)).toEqual(['PUBLIC_REPORT', 'BLOG_EXPORT', 'TELEGRAM_SUMMARY', 'PAID_PREVIEW']);
    expect(MORE_MOBILE_TABS.some((item) => item.id === 'BLOG_EXPORT')).toBe(true);
  });

  it('has no duplicate sidebar view ids', () => {
    const allIds = NAV_GROUPS.flatMap((group) => group.items).map((item) => item.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('hides operator navigation unless operator mode is enabled', () => {
    expect(NAV_GROUPS.some((group) => group.label === 'Operator')).toBe(true);
    expect(getVisibleNavGroups(false).some((group) => group.label === 'Operator')).toBe(false);
    expect(getVisibleNavGroups(true).some((group) => group.label === 'Operator')).toBe(true);
    const operator = getVisibleNavGroups(true).find((group) => group.label === 'Operator');
    expect(operator?.items.map((item) => item.id)).toEqual([
      'MACRO_INTEL',
      'DIAGNOSTICS',
      'PROVIDER_HEALTH',
      'EXECUTION_TRACE',
      'LEARNING_SANITY',
      'RAW_SNAPSHOT',
    ]);
  });
});
