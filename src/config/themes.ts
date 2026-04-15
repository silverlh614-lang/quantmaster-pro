/**
 * Theme configuration — single source of truth for all selectable themes.
 * SettingsModal and any future theme-picker reads from here.
 */
import type { ElementType } from 'react';
import { Moon, Sun, Contrast, Waves, Leaf } from 'lucide-react';
import type { ThemeMode } from '../stores/useSettingsStore';

export interface ThemeOption {
  id: ThemeMode;
  label: string;
  icon: ElementType;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark', label: '다크', icon: Moon },
  { id: 'light', label: '라이트', icon: Sun },
  { id: 'high-contrast', label: '고대비', icon: Contrast },
  { id: 'ocean', label: '오션', icon: Waves },
  { id: 'forest', label: '포레스트', icon: Leaf },
];

/** CSS class names applied to <body> for each theme (except 'dark' which is the default) */
export const THEME_BODY_CLASSES = THEME_OPTIONS
  .filter(t => t.id !== 'dark')
  .map(t => `theme-${t.id}`);
