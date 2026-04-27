// @responsibility useAppEffects React hook
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useSettingsStore } from '../stores';
import { buildPageTitle, THEME_BODY_CLASSES } from '../config';

/**
 * App-level side effects: document title, theme body class,
 * root font-size scaling, and notification permission request.
 */
export function useAppEffects() {
  const { view, theme, fontSize } = useSettingsStore();

  useEffect(() => {
    document.title = buildPageTitle(view);
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
