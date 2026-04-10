/**
 * @deprecated 새 코드는 도메인별 파일에서 직접 import하세요:
 *   import type { MacroEnvironment } from '../types/macro';
 *   import type { TMAResult }         from '../types/technical';
 *   import type { BearRegimeResult }  from '../types/bear';
 *   import type { EvaluationResult }  from '../types/core';
 *   import type { Portfolio }         from '../types/portfolio';
 *   import type { SectorOverheatResult } from '../types/sector';
 *
 * 기존 코드 호환성을 위해 모든 타입을 re-export합니다.
 */
export * from './index';
