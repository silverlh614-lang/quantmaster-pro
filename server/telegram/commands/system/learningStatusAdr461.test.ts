import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync(path.resolve('server/telegram/commands/system/learningStatus.cmd.ts'), 'utf-8');

describe('ADR-461 /learning_status wiring', () => {
  it('/learning_status에 compact Runtime Audit 추가', () => {
    expect(src).toContain('formatRuntimePipelineAuditCompactLine');
    expect(src).toContain('buildRuntimePipelineAuditSnapshot');
  });

  it('ENV disabled 시 compact line skip', () => {
    expect(src).toContain('isRuntimePipelineAuditDisabled');
    expect(src).toContain('!isRuntimePipelineAuditDisabled()');
  });
});
