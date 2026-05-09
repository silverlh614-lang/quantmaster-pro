import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOperatorActionQueueAdr0480, formatOperatorActionCompactSectionAdr0480, type OperatorActionSource } from './operatorActionRouterAdr0480.js';

function s(diagnosticValue: string): OperatorActionSource {
  return { adr: '0480', sectionId: 'budget', code: diagnosticValue, diagnosticKey: diagnosticValue, diagnosticValue, severity: 'DEGRADED' };
}

describe('ADR-0478 compact scan blockers output budget with ADR-0480', () => {
  it('Top Operator Actions compact section renders only top 3 action rows', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [
      s('selectedProvider=NONE'),
      s('semanticNetBuy=null'),
      s('CACHE_EMPTY'),
      s('PROVIDER_MISMATCH'),
    ] });
    const lines = formatOperatorActionCompactSectionAdr0480(report).split('\n');
    expect(lines[0]).toContain('Top Operator Actions');
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(3);
  });

  it('/scan_blockers wiring uses ADR-0480 safe compact formatter', () => {
    const src = fs.readFileSync(path.resolve('server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    expect(src).toContain('safeFormatOperatorActionCompactSectionAdr0480');
    expect(src).toContain('safeBuildOperatorActionQueueAdr0480');
  });
});
