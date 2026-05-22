import { describe, expect, it } from 'vitest';
import { commandRegistry } from './commandRegistry.js';
import { canonicalizeCommand, resolveCommandAction } from './commandRouter.js';

import './commands/positions/index.js';
import './commands/trade/index.js';
import './commands/system/index.js';

describe('Simplification Step 8 command compatibility', () => {
  it('keeps core user commands registered or routable after Telegram alert diet', () => {
    for (const command of ['/pos', '/pnl', '/scan', '/ping', '/debug', '/why']) {
      expect(commandRegistry.resolve(command), `missing ${command}`).toBeDefined();
    }

    expect(canonicalizeCommand('/help')).toBe('/help');
    expect(resolveCommandAction('/help')).toBe('HELP_MENU');
  });

  it('keeps /debug and /why as aliases, not new decision paths', () => {
    expect(commandRegistry.resolve('/debug')).toBe(commandRegistry.resolve('/debug_command'));
    expect(commandRegistry.resolve('/why')).toBe(commandRegistry.resolve('/scan_blockers'));
  });
});
