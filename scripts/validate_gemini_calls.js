/**
 * validate_gemini_calls.js
 * 빌드 시 자동 실행 (prebuild hook): npm run build → prebuild → node scripts/validate_gemini_calls.js
 *
 * Gemini API 충돌 검사:
 *   - responseMimeType 과 tools: [{ googleSearch 를 동일 generateContent 블록에서 혼용하면
 *     Gemini API가 오류를 반환한다.
 *   - 각 generateContent({ ... }) 호출의 앞쪽 일정 범위에서 두 옵션이 공존하는지 탐지한다.
 */

import { readFileSync, existsSync } from 'fs';

const TARGET_FILE = 'src/services/stockService.ts';
const MAX_CONFIG_SEARCH_LENGTH = 2000;

if (!existsSync(TARGET_FILE)) {
  console.log(`[OK] ${TARGET_FILE} not found — skipping Gemini conflict check`);
  process.exit(0);
}

const content = readFileSync(TARGET_FILE, 'utf-8');

// generateContent 호출 단위로 분리
const blocks = content.split(/generateContent\s*\(/);

const MIME_PATTERN   = /responseMimeType\s*:/;
const SEARCH_PATTERN = /tools\s*:\s*\[\s*\{\s*googleSearch/;

const conflicts = [];

for (let i = 1; i < blocks.length; i++) {
  const chunk = blocks[i].slice(0, MAX_CONFIG_SEARCH_LENGTH);
  const hasMime   = MIME_PATTERN.test(chunk);
  const hasSearch = SEARCH_PATTERN.test(chunk);
  if (hasMime && hasSearch) {
    conflicts.push(i);
    console.error(`[CONFLICT] block ${i}: responseMimeType + googleSearch 혼용 감지`);
  }
}

if (conflicts.length > 0) {
  console.error(`\n충돌이 발생한 블록 수: ${conflicts.length}`);
  console.error('수정 방법: 동일 generateContent 호출에서 responseMimeType 또는 googleSearch 중 하나만 사용하세요.');
  process.exit(1);
}

console.log('[OK] No Gemini API conflicts');
