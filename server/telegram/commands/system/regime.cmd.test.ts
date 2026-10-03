// @responsibility 폐기한 레짐 명령의 등록·현행 기능 안내를 검증한다.
import { describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import './regime.cmd.js';

describe('/regime retired command', () => {
  it('remains a read-only administrative command', () => {
    expect(commandRegistry.resolve('/regime')).toMatchObject({
      name: '/regime', category: 'SYS', visibility: 'ADMIN', riskLevel: 0,
    });
  });

  it('replies once with the current observation and research commands', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await commandRegistry.resolve('/regime')!.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledExactlyOnceWith(
      '레짐 기반 기능은 폐기되었습니다. 새 모델 현황은 /paper, 학습·연구는 /paper_research에서 확인하세요.',
    );
  });
});
