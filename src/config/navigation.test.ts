/**
 * @responsibility navigation 그룹·메뉴 SSOT 회귀 테스트 — PR-I
 */
import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, PRIMARY_MOBILE_TABS, MORE_MOBILE_TABS } from './navigation';
import { VIEW_LABELS } from './viewRegistry';

describe('navigation SSOT — PR-I 신규 페이지 등록', () => {
  it('NAV_GROUPS 의 모든 view id 가 VIEW_LABELS 에 존재', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(VIEW_LABELS[item.id]).toBeDefined();
      }
    }
  });

  it('MORE_MOBILE_TABS 의 모든 view id 가 VIEW_LABELS 에 존재', () => {
    for (const item of MORE_MOBILE_TABS) {
      expect(VIEW_LABELS[item.id]).toBeDefined();
    }
  });

  it('PRIMARY_MOBILE_TABS 의 모든 view id 가 VIEW_LABELS 에 존재', () => {
    for (const item of PRIMARY_MOBILE_TABS) {
      expect(VIEW_LABELS[item.id]).toBeDefined();
    }
  });

  it('PR-I — RECOMMENDATION_HISTORY 가 NAV_GROUPS 에 등록됨', () => {
    const allItems = NAV_GROUPS.flatMap(g => g.items);
    expect(allItems.some(i => i.id === 'RECOMMENDATION_HISTORY')).toBe(true);
  });

  it('PR-I — MACRO_INTEL 이 NAV_GROUPS 에 등록됨', () => {
    const allItems = NAV_GROUPS.flatMap(g => g.items);
    expect(allItems.some(i => i.id === 'MACRO_INTEL')).toBe(true);
  });

  it('PR-I — 두 신규 항목이 MORE_MOBILE_TABS 에도 등록됨', () => {
    expect(MORE_MOBILE_TABS.some(i => i.id === 'RECOMMENDATION_HISTORY')).toBe(true);
    expect(MORE_MOBILE_TABS.some(i => i.id === 'MACRO_INTEL')).toBe(true);
  });

  it('NAV_GROUPS 에 중복된 view id 없음 (drift 가드)', () => {
    const allIds = NAV_GROUPS.flatMap(g => g.items).map(i => i.id);
    const uniq = new Set(allIds);
    expect(uniq.size).toBe(allIds.length);
  });

  it('인텔리전스 그룹 신규 추가됨', () => {
    const intel = NAV_GROUPS.find(g => g.label === '인텔리전스');
    expect(intel).toBeDefined();
    expect(intel?.items.length).toBeGreaterThanOrEqual(2);
  });
});
