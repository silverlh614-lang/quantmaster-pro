"""
validate_gemini_calls.py
빌드 시 자동 실행 (prebuild hook): npm run build → prebuild → python3 scripts/validate_gemini_calls.py

Gemini API 충돌 검사:
  - responseMimeType 과 tools: [{ googleSearch 를 동일 generateContent 블록에서 혼용하면
    Gemini API가 오류를 반환한다.
  - 각 generateContent({ ... }) 호출의 앞쪽 일정 범위에서 두 옵션이 공존하는지 탐지한다.
"""

import re
import sys

TARGET_FILE = "src/services/stockService.ts"

# 단일 generateContent 호출에서 config 옵션이 포함될 수 있는 최대 문자 범위.
# 실제 config 블록은 수백 자이지만 넉넉하게 2000자를 설정한다.
MAX_CONFIG_SEARCH_LENGTH = 2000

with open(TARGET_FILE, encoding="utf-8") as f:
    content = f.read()

# generateContent 호출 단위로 분리 (공백 변형 및 줄 바꿈 허용)
blocks = re.split(r"generateContent\s*\(", content)

# responseMimeType 프로퍼티 패턴 (property assignment 형태만 감지, 주석/문자열 오탐 방지)
MIME_PATTERN = re.compile(r"responseMimeType\s*:")
# googleSearch 도구 패턴 (tools 배열 내 googleSearch 키, 공백 변형 허용)
SEARCH_PATTERN = re.compile(r"tools\s*:\s*\[\s*\{\s*googleSearch")

conflicts = []

for i, block in enumerate(blocks[1:], start=1):
    chunk = block[:MAX_CONFIG_SEARCH_LENGTH]
    has_mime = bool(MIME_PATTERN.search(chunk))
    has_search = bool(SEARCH_PATTERN.search(chunk))
    if has_mime and has_search:
        conflicts.append(i)
        print(f"[CONFLICT] block {i}: responseMimeType + googleSearch 혼용 감지")

if conflicts:
    print(f"\n충돌이 발생한 블록 수: {len(conflicts)}")
    print("수정 방법: 동일 generateContent 호출에서 responseMimeType 또는 googleSearch 중 하나만 사용하세요.")
    sys.exit(1)

print("[OK] No Gemini API conflicts")
