// @responsibility RevalidationStep 패턴 모듈 barrel — 후속 PR 에서 다단계 step 추가 예정

export type {
  RevalidationStepResult,
  RevalidationStepPass,
  RevalidationStepFail,
} from './types.js';

export {
  entryRevalidationStep,
  type EntryRevalidationStepInput,
} from './entryRevalidationStep.js';
