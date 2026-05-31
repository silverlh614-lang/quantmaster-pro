// @responsibility useAppEffects React hook
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useSettingsStore } from '../stores';
import type { View } from '../stores/useSettingsStore';
import { buildPageTitle, THEME_BODY_CLASSES } from '../config';

type HistoryViewState = { qmpView?: View } | null;

/**
 * App-level side effects: document title, theme body class,
 * root font-size scaling, browser back-nav (section history), and notification permission.
 */
export function useAppEffects() {
  const { view, theme, fontSize } = useSettingsStore();

  useEffect(() => {
    document.title = buildPageTitle(view);
  }, [view]);

  // 브라우저 뒤로가기 = 이전 섹션 (웹 즉시 이탈 방지). 첫 진입 뷰를 baseline 으로 등록하고
  // popstate(뒤로/앞으로) 시 history.state 의 뷰로 복원한다. 한 번만 구독 — view 는 getState 로 읽어 stale 회피.
  useEffect(() => {
    if (!(window.history.state as HistoryViewState)?.qmpView) {
      window.history.replaceState({ qmpView: useSettingsStore.getState().view }, '');
    }
    const onPopState = (e: PopStateEvent) => {
      const restored = (e.state as HistoryViewState)?.qmpView;
      if (restored && restored !== useSettingsStore.getState().view) {
        useSettingsStore.getState().setView(restored);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 사용자 네비게이션(뷰 변경) 시 history push — popstate 로 인한 변경은 state 가 이미 같아 push 안 함.
  useEffect(() => {
    if ((window.history.state as HistoryViewState)?.qmpView !== view) {
      window.history.pushState({ qmpView: view }, '');
    }
  }, [view]);

  useEffect(() => {
    const body = document.body;
    body.classList.remove(...THEME_BODY_CLASSES.map(c => c));
    if (theme !== 'dark') body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${(fontSize / 16) * 100}%`;
  }, [fontSize]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);
}
