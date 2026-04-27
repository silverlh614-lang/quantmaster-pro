# ADR-0038: 개인 회선(DM) vs 채널 분리 + 잔고 키워드 누출 차단

상태: 채택 (PR-X2, 2026-04-26)
영향 범위: `server/alerts/telegramClient.ts`, `scripts/check_sensitive_alerts.js`,
`package.json`, ADR-0037 (alertRouter SSOT) 후속

## 1. 배경

사용자 알림 정책 개선안 12 아이디어 중 **5번 — 개인 1:1 채팅은 4채널과 별개의
"비상 회선" 으로 격리** 를 처리. ADR-0037 (PR-X1) 의 alertRouter SSOT 위에
올라가는 안전장치 레이어.

audit 결과:
- `sendTelegramBroadcast` 는 코드베이스 코멘트에 따르면 이미 `sendTelegramAlert`
  의 alias (`TELEGRAM_CHAT_ID` 단일 변수 운영 환경) — 이름이 "broadcast" 라
  채널 누출로 오해 소지 있음.
- `dispatchAlert(category, ...)` 는 4채널(TRADE/ANALYSIS/INFO/SYSTEM) 로 발송.
  메시지 본문에 잔고/자산 키워드가 들어가면 채널 구독자 누구나 볼 수 있는
  민감 정보 누출이 됨.
- 현재 코드베이스에서 dispatchAlert 호출 메시지에 잔고 키워드 누출 0건 (clean
  baseline). 향후 회귀 차단을 위해 lint 가드 도입.

## 2. 결정

### 2.1 sendPrivateAlert SSOT — 개인 DM 전용 시멘틱 별칭

```ts
export async function sendPrivateAlert(
  message: string,
  opts?: TelegramAlertOptions,
): Promise<number | undefined>;
```

- 내부 구현은 `sendTelegramAlert` 와 동일 (`TELEGRAM_CHAT_ID` 한 곳만 발송).
- JSDoc 으로 "private DM only, never reaches channel" 명시.
- 신규 코드의 잔고/자산/비상정지/손절 접근/KIS 오류/EgressGuard 차단 같은
  민감 정보는 본 함수 사용 권장.

### 2.2 sendTelegramBroadcast deprecated 표시

```ts
/**
 * @deprecated PR-X2 (ADR-0038) — 신규 코드는 sendPrivateAlert 또는 dispatchAlert 사용.
 */
export async function sendTelegramBroadcast(...);
```

- 9개 기존 호출자(weeklyConditionScorecard / supplyChainAgent /
  foreignFlowLeadingAlert / stopLossTransparencyReport / newHighMomentumScanner
  / positionMorningCard / sectorCycleDashboard / weeklyQuantInsight /
  scanReviewReport) 는 PR-X3 에서 일괄 마이그레이션.
- 본 PR 에서는 표시만, 호출 동작은 그대로 (sendTelegramAlert 위임).

### 2.3 잔고 키워드 누출 차단 lint

`scripts/check_sensitive_alerts.js` 신설.

**대상**: 채널 발송 함수(`dispatchAlert` / `channelBuySignalEmitted` 등 12종) 를
`import` 한 파일.

**탐지 키워드** (8종):
- `총자산`, `총 자산`
- `주문가능현금`
- `잔여 현금`, `잔여현금`
- `보유자산`, `보유 자산`
- `평가손익`

**매칭**: string literal (`"..."`) / template literal (`` `...` ``) /
single-quote (`'...'`) 안에서만 검사. 식별자/변수명/주석 등장은 허용.

**제외 컨텍스트** (false positive 차단):
- `console.log/warn/error/debug/info(...)` — Railway 서버 로그, Telegram 미전송
- `throw new Error(...)` — 예외 메시지, Telegram 미전송
- 인라인 `// safe-channel-keyword` 주석 (해당 라인 또는 직전 라인)

**화이트리스트**:
- `server/alerts/alertRouter.ts` (라우팅 SSOT)
- `server/alerts/telegramClient.ts` (전송 로직)
- `scripts/check_sensitive_alerts.js` (시그니처 정의)
- `server/persona/personaIdentity.ts` (페르소나 분석 어휘 — "총자산회전율")

**실행**:
- `npm run validate:sensitiveAlerts` — 전체 스캔
- `npm run validate:all` 에 통합 (8종으로 확장)
- `npm run precommit` 에 통합

## 3. 후속 PR

| PR | 범위 |
|---:|------|
| PR-X3 | 9 callsite (sendTelegramBroadcast → sendPrivateAlert) 마이그레이션 + 채널 시멘틱 별칭(EXECUTION/SIGNAL/REGIME/JOURNAL) 사용 |
| PR-X4 | CH3 매크로 다이제스트 정기 cron (08:30 + 16:00 KST) |
| PR-X5 | CH4 일요일 19:00 KST 주간 자기비판 리포트 |
| PR-X6 | /channel_test 명령 + 손절 카운트다운 사전 경보 (sendPrivateAlert 만) |

## 4. 회귀 안전장치

- `sensitiveAlerts.test.ts` 17 케이스 — 통합 실행 1 + sendPrivateAlert 시그니처
  4 + 패턴 매칭 12 (탐지 / 제외 컨텍스트 / opt-out / 다중 키워드).
- 호출자 무수정 — sendTelegramBroadcast 는 그대로 동작 (deprecated 주석만 추가).
- 기존 dispatchAlert 호출 본체 0줄 변경 — lint 는 신규 누출 차단만 담당.

## 5. 거부된 대안

- **PRIVATE_ONLY enum 값 추가**: AlertCategory enum 에 5번째 값 추가 시
  채널 ID 매핑 / VIBRATION_POLICY / 영속 데이터 카테고리 키 모두 마이그레이션
  필요. sendPrivateAlert 별칭만으로 동일 효과 달성하면서 방사 범위 최소화.
- **AST 기반 lint**: TypeScript Compiler API 도입 비용 대비 효과 낮음. 정규식
  + 컨텍스트 휴리스틱(console.log / throw 제외) + opt-out 주석으로 충분.
- **WARN 모드 lint**: SSOT 정합성은 경고가 아니라 차단이어야 의미가 있다.
  False positive 는 `// safe-channel-keyword` opt-out 주석으로 명시 처리.
- **dispatchPrivate 별도 라우터 함수**: alertRouter 에 dispatchPrivate 추가 시
  cooldown / dedupe / channelStat 모두 변경 필요. sendPrivateAlert (telegramClient
  레이어) 만으로 충분 — alertRouter 는 채널 발송 전담으로 책임 명확화.
