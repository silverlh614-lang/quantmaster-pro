// @responsibility Seal generated calculation programs with deterministic executable fingerprints.
import { createHash } from 'node:crypto';
import { paperProgramCode, paperProgramIssue, validPaperIndicatorProgram, type PaperIndicatorProgram } from '../../../src/types/paperIndicatorProgram.js';
import { validPaperIndicatorFormula, type PaperIndicatorFormula } from '../../../src/types/paperIndicatorFormula.js';

export function paperProgramDigest(program: PaperIndicatorProgram): string {
  return createHash('sha256').update(`${program.version}:${paperProgramCode(program.expression)}`).digest('hex');
}
export function validSealedPaperFormula(value: unknown): value is PaperIndicatorFormula {
  return validPaperIndicatorFormula(value) && (value.version !== 'feature-program-v1' || value.digest === paperProgramDigest(value));
}
export function sealPaperProgram(value: unknown): PaperIndicatorProgram {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('계산 프로그램 형식 오류');
  const program = { ...value, version: 'feature-program-v1', digest: '0'.repeat(64) };
  if (!validPaperIndicatorProgram(program)) throw new Error(paperProgramIssue(program) ?? '계산 검사 실패');
  program.digest = paperProgramDigest(program);
  return program;
}
