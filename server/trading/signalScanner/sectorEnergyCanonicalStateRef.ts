/**
 * @responsibility Lightweight runtime ref for the latest SectorEnergy canonical state used by diagnostic renderers.
 */

import type { SectorEnergyCanonicalState } from '../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';

let lastSectorEnergyCanonicalState: SectorEnergyCanonicalState | null = null;

export function setLastSectorEnergyCanonicalState(
  canonical: SectorEnergyCanonicalState | null | undefined,
): void {
  lastSectorEnergyCanonicalState = canonical ?? null;
}

export function getLastSectorEnergyCanonicalState(): SectorEnergyCanonicalState | null {
  return lastSectorEnergyCanonicalState;
}
