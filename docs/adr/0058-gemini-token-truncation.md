# ADR-0058 — Gemini 응답 절삭 방지 — callGemini opts.maxOutputTokens 시그니처 확장

**상태**: Accepted (2026-04-26)
**관련 PR**: claude/fix-telegram-text-truncation
**관련 ADR**: ADR-0023 (PR-23 reflection Gemini token 4096)

## 1. 배경

사용자 보고 (2026-04-26) — 텔레그램 `[글로벌 스캔 06:00] 간밤 시장 요약` 메시지가 `**주` 에서 갑자기 잘림. 첨부 스크린샷:

```
1. **KOSPI 전망:** 간밤 글로벌 증시의 혼조세로 KOSPI는 뚜렷한 방향성 없이
보합권 내 변동성 장세가 [INFERRED] 예상된다. 이는 주요 시장 간 모멘텀 불균형에
기인한다. (Regime: UNCERTAIN / RANGE_BOUND)

2. **주     ← 잘림
```

### 진단

추정 원인 3종 후보:

1. **Telegram 4096자 한도** — 이미 `telegramClient.ts:269,320` 자동 청크 분할 로직 존재. 4096자 채워서 끊겼다면 본문이 더 길어야 함. **기각**.
2. **HTML 태그 중간 절삭** — `**주` 는 마크다운 bold 진입 직후. HTML 파싱 실패 시 plain text fallback 동작 정상 (라인 292). **기각**.
3. **Gemini maxOutputTokens 자체 절삭** — `callGemini` 가 `callGeminiText` 호출 시 `maxOutputTokens: 2048` 강제. 한국어 + 마크다운 + 다중 분석 본문은 token 효율이 낮아(한글 1자 ≈ 2~3 token) 1500~2000자 수준에서도 한도 초과 가능. **채택**.

## 2. 결정

### 2.1 `callGemini` 시그니처 확장

`server/clients/geminiClient.ts:363` 의 `callGemini(prompt, caller)` 에 옵셔널 3번째 인자 `opts?: { maxOutputTokens?: number; temperature?: number }` 추가. 기존 호출자(13건) 영향 0건 — 미전달 시 default 2048 / 0.4 유지.

```ts
export function resolveGeminiOpts(
  opts: { maxOutputTokens?: number; temperature?: number } = {},
): { maxOutputTokens: number; temperature: number } {
  return {
    maxOutputTokens: opts.maxOutputTokens ?? 2048,
    temperature:     opts.temperature ?? 0.4,
  };
}

export async function callGemini(
  prompt: string,
  caller = 'unknown',
  opts: { maxOutputTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  const resolved = resolveGeminiOpts(opts);
  return callGeminiText(prompt, {
    caller,
    model: AI_MODELS.SERVER_SIDE,
    temperature:     resolved.temperature,
    maxOutputTokens: resolved.maxOutputTokens,
  });
}
```

`resolveGeminiOpts` 별도 export 헬퍼 — opts 처리 SSOT 단위 테스트 가능 (ESM 모듈 내부 호출은 vi.mock partial 우회 불가).

### 2.2 긴 본문 출력 의도 함수 — 4096 token 명시

| 호출자 | 본문 형태 | token 한도 | 변경 |
|--------|-----------|:----------:|:----:|
| `globalScanAgent.ts:327` | KOSPI 전망 + 섹터 + 리스크 3분석 | **4096** | ✅ |
| `weeklyQuantInsight.ts:94` | 핵심 데이터 3 + BASE/BULL/BEAR 시나리오 3 | **4096** | ✅ |
| `reportGenerator.ts:288` | daily narrative 시장 분석 + 매매 회고 + 익일 전략 | **4096** | ✅ |
| `weeklyDeepAnalysis.ts:51` | 종목별 1~2문장 | 2048 | 유지 |
| `reportGenerator.ts:684` | pre-market 한국어 2문장 | 2048 | 유지 |
| `reportGenerator.ts:834` | post-market 1문장 + bullet 1~2 | 2048 | 유지 |
| `qualityScorecard.ts:330` | bullet 150자 이내 | 2048 | 유지 |
| 기타 7건 | dart-impact / pre-mortem / condition-auditor 등 | 2048 | 유지 |

### 2.3 dead code 제거

`callGemini` 본체에 `return callGeminiText(...)` 직후 도달 불가 코드 약 25줄(getGeminiClient/withRetry/generateContent 본체 중복 잔존) 정리. v3.1 Stage 2 정리 후속.

## 3. 회귀 영향 / 안전성

- **호출자 영향**: 13건 모두 무영향 (default 2048 유지, 미전달 호환)
- **API 비용 영향**: 4096 token 사용처 3건만 — 글로벌 스캔 일 1회 + 주간 인사이트 주 1회 + daily narrative 일 1회. 월 약 90회 추가 token = 월 0.5~1k token 증가 (무시 가능)
- **응답 품질**: 한국어 + 마크다운 본문 절삭 차단으로 KOSPI 분석/시나리오/회고가 완전 출력
- **자동매매 영향**: 0건 — 알림/리포트 채널만 영향, signalScanner/entryEngine 무관

## 4. 검증 계획

- 회귀 테스트 11 케이스 — `resolveGeminiOpts` SSOT 8 + `callGemini` opts wiring 정합성 3 (globalScanAgent / weeklyQuantInsight / reportGenerator)
- 운영 검증: 배포 후 06:00 KST 글로벌 스캔 메시지가 "리스크" 섹션까지 완전 출력되는지 확인
- 손절 조건: 4096 도 초과하면 *다중 메시지 분할 송출* 로 대응 (telegramClient 자동 분할 이미 동작)

## 5. 후속 PR 후보

- finishReason='MAX_TOKENS' 감지 → 운영자 INFORMATIONAL 알림 (Gemini 응답 절삭 자동 표면화)
- callGemini 호출자 종합 audit — 다른 함수에서도 절삭 발생 사례 누적 시 추가 wiring
