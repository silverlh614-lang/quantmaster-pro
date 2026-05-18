// @responsibility callbackRouter 텔레그램 모듈
// @responsibility: Telegram 버튼 callback 전용 라우터. 텍스트 commandRouter 와 분리하되 동일 command service 를 호출한다.

import { commandRegistry } from './commandRegistry.js';
import { handleMetaCommand, parseMetaCallback, type InlineKeyboardMarkup } from './metaCommands.js';

export interface CallbackDispatchContext {
  data: string;
  reply: (message: string, replyMarkup?: InlineKeyboardMarkup) => Promise<void>;
}

const BUTTON_TO_COMMAND = new Map<string, string>([
  ['BTN_POSITION', '/pos'],
  ['BTN_POSITIONS', '/pos'],
  ['BTN_PNL', '/pnl'],
]);

export async function dispatchTelegramCallback(ctx: CallbackDispatchContext): Promise<boolean> {
  const mappedCommand = BUTTON_TO_COMMAND.get(ctx.data);
  if (mappedCommand) {
    const handler = commandRegistry.resolve(mappedCommand);
    if (!handler) return false;
    await handler.execute({ args: [], reply: ctx.reply });
    return true;
  }

  const metaParsed = parseMetaCallback(ctx.data);
  if (metaParsed) {
    const direct = commandRegistry.resolve(metaParsed.targetCmd);
    if (direct) {
      await direct.execute({ args: [], reply: ctx.reply });
      return true;
    }
    await handleMetaCommand(metaParsed.targetCmd, ctx.reply);
    return true;
  }

  return false;
}
