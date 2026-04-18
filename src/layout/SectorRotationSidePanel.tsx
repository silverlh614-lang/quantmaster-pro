/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SectorRotationPanel } from '../components/sector/SectorRotationPanel';
import { useSettingsStore } from '../stores';
import { SECTOR_PANEL_VIEWS } from '../config';

/**
 * Desktop-only side panel that mounts the sector rotation panel
 * only on views declared in `SECTOR_PANEL_VIEWS`.
 */
export function SectorRotationSidePanel() {
  const { view } = useSettingsStore();
  if (!(SECTOR_PANEL_VIEWS as readonly string[]).includes(view)) return null;

  return (
    <div className="hidden xl:block w-[260px] shrink-0 p-4 pt-6 sticky top-0 h-screen overflow-y-auto no-scrollbar">
      <SectorRotationPanel />
    </div>
  );
}
