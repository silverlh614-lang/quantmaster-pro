// @responsibility: telegram setMyCommands 자동 동기화 가드 — META_COMMAND_REGISTRY ↔ MENU_DESCRIPTIONS drift 차단.
import { describe, it, expect } from 'vitest';

import {
  buildBotMenuCommands,
  META_COMMAND_REGISTRY,
} from './metaCommands.js';

describe('buildBotMenuCommands — Telegram 메뉴 자동 동기화 SSOT', () => {
  it('현재 노출 메뉴는 8개 (메타 5 + /help /status /now)', () => {
    const cmds = buildBotMenuCommands();
    expect(cmds).toHaveLength(8);
  });

  it('메뉴 첫 3개는 고정 prelude (help/status/now)', () => {
    const cmds = buildBotMenuCommands();
    expect(cmds[0]?.command).toBe('help');
    expect(cmds[1]?.command).toBe('status');
    expect(cmds[2]?.command).toBe('now');
  });

  it('메타 5개 (watch/positions/learning/control/admin) 가 prelude 뒤에 자동 추가', () => {
    const cmds = buildBotMenuCommands();
    const metaCmds = cmds.slice(3).map((c) => c.command).sort();
    expect(metaCmds).toEqual(['admin', 'control', 'learning', 'positions', 'watch']);
  });

  it('모든 command 는 슬래시 없이 lowercase + ≤32자 + /^[a-z0-9_]+$/', () => {
    const cmds = buildBotMenuCommands();
    for (const c of cmds) {
      expect(c.command).not.toMatch(/^\//);
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
    }
  });

  it('모든 description 은 비어있지 않고 ≤256자', () => {
    const cmds = buildBotMenuCommands();
    for (const c of cmds) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('META_COMMAND_REGISTRY 키 5개와 메뉴 메타 항목 5개가 동기화', () => {
    const registryKeys = Object.keys(META_COMMAND_REGISTRY)
      .map((k) => k.replace(/^\//, ''))
      .sort();
    const cmds = buildBotMenuCommands();
    const metaCmds = cmds
      .filter((c) => !['help', 'status', 'now'].includes(c.command))
      .map((c) => c.command)
      .sort();
    expect(metaCmds).toEqual(registryKeys);
  });

  it('JSON 직렬화 결과는 Telegram setMyCommands API 페이로드 형식', () => {
    const cmds = buildBotMenuCommands();
    const json = JSON.parse(JSON.stringify({ commands: cmds }));
    expect(json.commands).toBeInstanceOf(Array);
    expect(json.commands[0]).toHaveProperty('command');
    expect(json.commands[0]).toHaveProperty('description');
    // Telegram API 가 거부하는 추가 필드 없음
    expect(Object.keys(json.commands[0]).sort()).toEqual(['command', 'description']);
  });

  it('각 메타 description 은 메타 spec.title (이모지 포함) 과 다름 — 짧은 텍스트 별도', () => {
    const cmds = buildBotMenuCommands();
    for (const c of cmds.slice(3)) {
      const spec = META_COMMAND_REGISTRY['/' + c.command];
      expect(spec).toBeDefined();
      // spec.title 은 이모지 + 카테고리 라벨, description 은 짧은 텍스트.
      // 둘이 동일하면 실수로 spec.title 을 description 에 복사한 회귀.
      expect(c.description).not.toBe(spec.title);
    }
  });

  it('호출은 idempotent — 여러 번 호출해도 동일한 결과', () => {
    const a = buildBotMenuCommands();
    const b = buildBotMenuCommands();
    expect(a).toEqual(b);
  });
});
