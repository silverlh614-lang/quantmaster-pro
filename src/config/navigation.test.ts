import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, PRIMARY_MOBILE_TABS, MORE_MOBILE_TABS, getVisibleNavGroups, resolveWorkspaceView } from './navigation';
import { VIEW_LABELS } from './viewRegistry';
describe('workspace navigation', () => {
  it('exposes the same five destinations on desktop and mobile without reviving retired tools', () => {
    const ids = ['DASHBOARD', 'PAPER_OBSERVATIONS', 'PAPER_STRATEGY', 'PAPER_RESEARCH', 'OPERATIONS'];
    expect(NAV_GROUPS.flatMap(group => group.items.map(item => item.id))).toEqual(ids);
    expect(PRIMARY_MOBILE_TABS.map(item => item.id)).toEqual(ids);
    expect(MORE_MOBILE_TABS).toEqual([]);
    expect(getVisibleNavGroups(true)).toEqual(getVisibleNavGroups(false));
    for (const item of PRIMARY_MOBILE_TABS) expect(VIEW_LABELS[item.id]).toBe(item.label);
  });
  it('restores old browser history to a working current destination', () => {
    expect(resolveWorkspaceView('DISCOVER')).toBe('DASHBOARD');
    expect(resolveWorkspaceView('PUBLIC_REPORT')).toBe('DASHBOARD');
    expect(resolveWorkspaceView('AUTO_TRADE')).toBe('PAPER_STRATEGY');
    expect(resolveWorkspaceView('SHADOW_LEARNING')).toBe('PAPER_RESEARCH');
    expect(resolveWorkspaceView('PAPER_OBSERVATIONS')).toBe('PAPER_OBSERVATIONS');
  });
});
