/**
 * @responsibility Advisory screener snapshot persistence
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../persistence/paths.js';
import type { AdvisoryScreenerCandidate } from './quantScreenerTypes.js';

const ADVISORY_WATCHLIST_FILE = path.join(DATA_DIR, 'advisory-screener-watchlist.json');

export function saveAdvisoryWatchlist(candidates: AdvisoryScreenerCandidate[], file = ADVISORY_WATCHLIST_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), candidates }, null, 2));
}
