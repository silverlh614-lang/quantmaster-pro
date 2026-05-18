import { describe, expect, it } from 'vitest';

import { renderPositionSourceDiagnostics } from './positionOutputFormatters.js';
import type { NormalizedPosition } from './positionSourceTypes.js';

function position(): NormalizedPosition {
  return {
    symbol: '005930',
    qty: 1,
    sourceTag: 'SHADOW',
    mode: 'SHADOW',
  };
}

describe('position source diagnostics formatter', () => {
  it('renders source success, empty, and failure states compactly', () => {
    const lines = renderPositionSourceDiagnostics([
      {
        source: 'ShadowPositionLedger',
        kind: 'SUCCESS',
        positions: [position()],
      },
      {
        source: 'VirtualAccount',
        kind: 'FAILED',
        reason: 'compute failed',
        executionImpact: 'POSITION_QUERY_DEGRADED',
      },
      {
        source: 'KISLiveHolding',
        kind: 'EMPTY',
      },
    ]);

    const text = lines.join('\n');
    expect(text).toContain('[POSITION_SOURCE_DIAGNOSTICS]');
    expect(text).toContain('ShadowPositionLedger:SUCCESS(1)');
    expect(text).toContain('VirtualAccount:FAILED(POSITION_QUERY_DEGRADED)');
    expect(text).toContain('[SOURCE_FAILED] VirtualAccount reason=compute failed');
    expect(text).toContain('KISLiveHolding:EMPTY');
  });
});
