// @responsibility kellySurface.cmd 텔레그램 모듈
// @responsibility: /kelly_surface — signalType × regime 버킷별 (p, b) Kelly 학습 상태 + 신뢰구간 폭.
import { formatKellySurface } from '../../../learning/kellySurfaceMap.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const kellySurface: TelegramCommand = {
  name: '/kelly_surface',
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Kelly Surface — signalType × regime (p, b) 학습 상태',
  async execute({ reply }) {
    await reply(formatKellySurface());
  },
};

commandRegistry.register(kellySurface);

export default kellySurface;
