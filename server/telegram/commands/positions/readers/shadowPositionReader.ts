// @responsibility ShadowPositionRegistry position source reader.

import type { PositionSourceResult } from '../positionSourceTypes.js';

export async function readShadowPositionRegistryPositions(): Promise<PositionSourceResult> {
  return {
    source: 'ShadowPositionRegistry',
    kind: 'EMPTY',
    diagnostics: {
      reason: 'SHADOW_POSITION_REGISTRY_NOT_CONFIGURED',
    },
  };
}
