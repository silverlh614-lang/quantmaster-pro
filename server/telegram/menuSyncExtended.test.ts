// @responsibility: 긴급패치(2026-04-26) buildBotMenuCommandsExtended 자동완성 확장 회귀 테스트.
//
// 사용자 요청 "/ 누르면 명령어 목록 호출" — Telegram 클라이언트는 setMyCommands 결과를
// 슬래시 자동완성으로 표시한다. 본 함수는 기존 8개 메타 위에 commandRegistry 의 모든
// 51개 alias 를 합쳐 자동완성에 노출한다.
//
// ADR-0017 Stage 1 의 "메뉴 8개 압축" 정책은 buildBotMenuCommands() 회귀 테스트 그대로
// 유지 — 본 테스트는 확장판이 추가로 등록 명령을 모두 노출하는지만 검증.

import { describe, it, expect, beforeAll } from 'vitest';

// commands barrel 을 명시 import 해 commandRegistry 가 채워지도록 보장.
// 부팅 시점엔 webhookHandler 가 이미 import 했지만 테스트 환경에선 명시 필요.
import '../telegram/commands/system/index.js';
import '../telegram/commands/watchlist/index.js';
import '../telegram/commands/positions/index.js';
import '../telegram/commands/alert/index.js';
import '../telegram/commands/learning/index.js';
import '../telegram/commands/control/index.js';
import '../telegram/commands/trade/index.js';
import '../telegram/commands/infra/index.js';

import {
  buildBotMenuCommandsExtended,
  buildBotMenuCommands,
  META_COMMAND_REGISTRY,
} from './metaCommands.js';
import { commandRegistry } from './commandRegistry.js';

describe('buildBotMenuCommandsExtended — / 자동완성 확장 (긴급패치 2026-04-26)', () => {
  let extended: ReturnType<typeof buildBotMenuCommandsExtended>;
  let baseLen: number;

  beforeAll(() => {
    extended = buildBotMenuCommandsExtended();
    baseLen = buildBotMenuCommands().length;
  });

  it('확장판 길이는 base(8) 보다 크고 Telegram 한도(100) 이하', () => {
    expect(extended.length).toBeGreaterThan(baseLen);
    expect(extended.length).toBeLessThanOrEqual(100);
  });

  it('첫 8개는 기존 base 와 정확히 동일 (prelude + meta SSOT 보존)', () => {
    const base = buildBotMenuCommands();
    expect(extended.slice(0, base.length)).toEqual(base);
  });

  it('commandRegistry.all() 의 모든 정식 name 이 자동완성에 포함 (HIDDEN 포함)', () => {
    const allRegistry = commandRegistry.all();
    const extendedCmds = new Set(extended.map((e) => e.command));

    for (const cmd of allRegistry) {
      const name = cmd.name.replace(/^\//, '').toLowerCase();
      // base prelude/meta 와 충돌하는 이름은 base 에서 이미 노출됨 (e.g. /status).
      if (!/^[a-z0-9_]{1,32}$/.test(name)) continue;
      expect(extendedCmds.has(name)).toBe(true);
    }
  });

  it('alias 는 자동완성에 중복 노출되지 않음 (정식 name 만)', () => {
    const cmds = extended.map((e) => e.command);
    const dupes = cmds.filter((c, i) => cmds.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });

  it('모든 command 는 Telegram 제약 매치 — /^[a-z0-9_]{1,32}$/', () => {
    for (const e of extended) {
      expect(e.command).toMatch(/^[a-z0-9_]{1,32}$/);
    }
  });

  it('모든 description 은 비어있지 않고 ≤256자', () => {
    for (const e of extended) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('META_COMMAND_REGISTRY 5 키 + prelude 3 + registry 의 전체 unique cmd 가 자동완성에 포함', () => {
    const metaKeys = Object.keys(META_COMMAND_REGISTRY)
      .map((k) => k.replace(/^\//, ''));
    const prelude = ['help', 'status', 'now'];
    const cmds = new Set(extended.map((e) => e.command));
    for (const k of [...metaKeys, ...prelude]) {
      expect(cmds.has(k)).toBe(true);
    }
  });

  it('호출은 idempotent — 동일 결과', () => {
    const a = buildBotMenuCommandsExtended();
    const b = buildBotMenuCommandsExtended();
    expect(a).toEqual(b);
  });

  it('JSON 직렬화 결과는 Telegram setMyCommands 페이로드 형식', () => {
    const json = JSON.parse(JSON.stringify({ commands: extended }));
    expect(json.commands).toBeInstanceOf(Array);
    for (const c of json.commands) {
      expect(Object.keys(c).sort()).toEqual(['command', 'description']);
    }
  });

  it('카테고리 정렬 우선순위 — SYS 가 EMR 보다 먼저 등장', () => {
    // 자동완성에서 SYS(시스템 현황) 가 EMR(비상정지) 보다 먼저 나오는 것이 안전.
    const syscmds = commandRegistry.all()
      .filter((c) => c.category === 'SYS')
      .map((c) => c.name.replace(/^\//, '').toLowerCase());
    const emrcmds = commandRegistry.all()
      .filter((c) => c.category === 'EMR')
      .map((c) => c.name.replace(/^\//, '').toLowerCase());

    if (syscmds.length === 0 || emrcmds.length === 0) return; // skip if empty.

    const sysIdx = syscmds
      .map((c) => extended.findIndex((e) => e.command === c))
      .filter((i) => i >= 0);
    const emrIdx = emrcmds
      .map((c) => extended.findIndex((e) => e.command === c))
      .filter((i) => i >= 0);

    if (sysIdx.length === 0 || emrIdx.length === 0) return;

    const minSys = Math.min(...sysIdx);
    const minEmr = Math.min(...emrIdx);
    expect(minSys).toBeLessThan(minEmr);
  });
});
