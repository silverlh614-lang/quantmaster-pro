// @responsibility commandRegistry 텔레그램 모듈
// @responsibility: TelegramCommand 등록·조회 SSOT. name/alias 일치를 단일 Map 으로 관리하고 중복은 명시 차단.
//
// ADR-0017 §Stage 2 Phase A — webhookHandler.ts 가 switch 진입 직전 본 레지스트리를 먼저
// 조회한다. 매칭되면 execute() 위임, 미매칭이면 기존 switch 가 처리 (점진 이전).
// 명령어 파일은 자기 자신을 import 시점에 register 호출로 등록한다 (side-effect).
// 새 디렉토리 추가 시 server/telegram/commands/<group>/index.ts 에서 .cmd.ts 들을
// barrel import 하고, 본 모듈을 import 하는 곳에서 그 barrel 도 import 해야 등록 트리거가 동작한다.

import type { TelegramCommand } from './commands/_types.js';

class CommandRegistry {
  private readonly byName = new Map<string, TelegramCommand>();

  /**
   * 명령어 등록. name 과 aliases 가 같은 인스턴스를 가리키도록 모두 동일 Map 에 저장.
   * 동일 키가 이미 등록되어 있으면 throw — drift 차단.
   */
  register(cmd: TelegramCommand): void {
    const keys = [cmd.name, ...(cmd.aliases ?? [])];
    for (const k of keys) {
      const norm = k.toLowerCase();
      if (this.byName.has(norm)) {
        const existing = this.byName.get(norm)!;
        if (existing === cmd) continue; // 동일 instance 중복 등록은 무시 (HMR 안전).
        throw new Error(
          `[commandRegistry] 중복 등록: ${norm} 이미 ${existing.name} 으로 점유됨 (신규: ${cmd.name})`,
        );
      }
      this.byName.set(norm, cmd);
    }
  }

  /** 사용자 입력에서 명령 부분 (`/status`) 을 받아 등록된 핸들러 반환. */
  resolve(input: string): TelegramCommand | undefined {
    return this.byName.get(input.toLowerCase());
  }

  /** 등록된 모든 unique 명령어 (alias 중복 제거). */
  all(): TelegramCommand[] {
    return Array.from(new Set(this.byName.values()));
  }

  /** 등록 키 (name + alias) 전체. setMyCommands 동기화 등에 사용. */
  keys(): string[] {
    return Array.from(this.byName.keys());
  }

  /** 테스트 전용 — 등록 상태 초기화. 프로덕션 코드는 호출 금지. */
  __resetForTests(): void {
    this.byName.clear();
  }
}

/** 프로세스 전역 단일 인스턴스. import 시점에 .cmd.ts 들이 register 호출. */
export const commandRegistry = new CommandRegistry();
