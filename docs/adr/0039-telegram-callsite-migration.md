# ADR-0039: Telegram callsite 시멘틱 별칭 마이그레이션 + sendPickChannelAlert 삭제

상태: 채택 (PR-X3, 2026-04-26)
영향 범위: 11 callsite + `server/alerts/telegramClient.ts` +
`scripts/check_channel_boundary.js`, ADR-0037/0038 후속

## 1. 배경

PR-X1 (alertRouter SSOT + VIBRATION_POLICY) + PR-X2 (sendPrivateAlert + 잔고
키워드 lint) 의 foundation 위에 실제 11 callsite 를 시멘틱 별칭으로 마이그레이션
하고 legacy `sendPickChannelAlert` 를 제거.

## 2. 마이그레이션 매핑

| Callsite | 변경 전 | 변경 후 | 채널 시멘틱 |
|----------|---------|---------|--------------|
| `positionMorningCard.ts` | `sendTelegramBroadcast` | `sendPrivateAlert` | 개인 DM (자산 구성 정보) |
| `weeklyConditionScorecard.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.JOURNAL)` | CH4 메타 학습 |
| `newHighMomentumScanner.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.SIGNAL)` | CH2 종목 픽 |
| `weeklyQuantInsight.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.JOURNAL)` | CH4 주간 메타 |
| `scanReviewReport.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.JOURNAL)` | CH4 스캔 회고 |
| `supplyChainAgent.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.REGIME)` | CH3 매크로 |
| `sectorCycleDashboard.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.REGIME)` | CH3 매크로 |
| `foreignFlowLeadingAlert.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.REGIME)` | CH3 매크로 |
| `stopLossTransparencyReport.ts` | `sendTelegramBroadcast` | `dispatchAlert(ChannelSemantic.JOURNAL)` | CH4 사후 복기 |
| `stockPickReporter.ts` | `sendPickChannelAlert` + `dispatchAlert(ANALYSIS)` 이중 발송 | `dispatchAlert(ChannelSemantic.SIGNAL)` 단일 | CH2 (이중 제거) |
| `weeklyDeepAnalysis.ts` | `sendPickChannelAlert` | `dispatchAlert(ChannelSemantic.JOURNAL)` | CH4 주간 심층 |

## 3. 핵심 변경 사항

### 3.1 sendPickChannelAlert 삭제

호출자 0건 마이그레이션 완료 후 `telegramClient.ts` 의 본체 제거. 신규 코드는
`dispatchAlert(ChannelSemantic.SIGNAL, message)` 사용. `alertRouter.ts` 의
`resolveAnalysisChannelId()` 가 `TELEGRAM_PICK_CHANNEL_ID` legacy fallback 을
계속 처리 — 환경변수 자체는 후방호환 유지.

### 3.2 stockPickReporter 이중 발송 제거

기존엔 `sendPickChannelAlert(message)` + `dispatchAlert(AlertCategory.ANALYSIS,
message, { disableNotification: true })` 두 번 발송 — `TELEGRAM_PICK_CHANNEL_ID`
와 `TELEGRAM_ANALYSIS_CHANNEL_ID` 가 동일 환경에서 같은 채널로 메시지 2번 출력
되는 명백한 회귀.

본 PR 에서 단일 호출 `dispatchAlert(ChannelSemantic.SIGNAL, message)` 로 통합.
`VIBRATION_POLICY[ANALYSIS]` 가 NORMAL/HIGH/LOW 모두 진동 OFF 이라 사용자 의도
(CH2 SIGNAL 픽은 FOMO 차단을 위해 조용히 누적) 와 정합.

### 3.3 positionMorningCard → sendPrivateAlert

보유 종목 카드는 사용자 자산 구성 (어떤 종목을 얼마나 가지고 있는지) 노출이라
미래에 가족/동료가 채널 구독 가능한 시나리오에서 누출 위험. 개인 DM 으로 격리.

### 3.4 ChannelBoundary 화이트리스트 축소

`telegramClient.ts` 의 `process.env.TELEGRAM_PICK_CHANNEL_ID` 직접 접근이
sendPickChannelAlert 삭제로 사라져 `scripts/check_channel_boundary.js` 의
`ALLOWED_FILES` 에서 telegramClient.ts 제거. 화이트리스트 4 → 3 파일:
`alertRouter.ts` / `alertCategories.ts` / `check_channel_boundary.js`.

### 3.5 옵션 정리

마이그레이션 과정에서 dispatchAlert 와 호환되지 않는 legacy 옵션 제거:
- `tier: 'T1_ALARM' | 'T2_REPORT'` — alertRouter 가 priority 별로 자동 결정
- `category: string` — alertRouter 가 채널 stat 자동 기록 (channelStatsRepo)
- `disableChannelNotification: boolean` — VIBRATION_POLICY 자동 적용으로 대체

`priority` 와 `dedupeKey` 는 그대로 유지 (dispatchAlert 와 1:1 호환).

## 4. 후속 PR

| PR | 범위 |
|---:|------|
| PR-X4 | CH3 매크로 다이제스트 정기 cron (08:30 + 16:00 KST) |
| PR-X5 | CH4 일요일 19:00 KST 주간 자기비판 리포트 |
| PR-X6 | /channel_test 명령 + 손절 카운트다운 사전 경보 (sendPrivateAlert 만) |

## 5. 회귀 안전장치

- `callsiteMigration.test.ts` 19 케이스 — sendPickChannelAlert 삭제 검증 3 +
  9 호출자 카테고리 매핑 검증 11 + stockPickReporter 이중 발송 제거 3 +
  ChannelBoundary 화이트리스트 축소 2.
- `validate:channelBoundary` 자동 통과 (telegramClient.ts 제외 후에도 누출 0건).
- `validate:sensitiveAlerts` 통과 (22→31 파일로 검사 범위 확대 — 마이그레이션
  으로 dispatchAlert 사용 파일 9건 추가, 누출 0건 유지).
- `npm run lint` (client + server tsc) 통과.

## 6. 거부된 대안

- **sendPickChannelAlert 본체에 `@deprecated` 만 표시**: 호출자 0건이므로
  남길 이유 없음. 삭제로 process.env 직접 접근까지 정리하면 ChannelBoundary
  화이트리스트 축소가 가능해져 boundary 정합성 강화.
- **stockPickReporter 의 ANALYSIS 발송을 PICK 채널로도 미러링 유지**: 사용자
  환경에서 두 채널 ID 가 동일이면 메시지 2번 노출. 환경 차이 호환은
  alertRouter.resolveAnalysisChannelId 의 legacy fallback 으로 충분.
- **모든 호출자를 `dispatchAlert(ChannelSemantic.X, msg)` 로 강제** (개인 DM
  포함): positionMorningCard 의 자산 구성 정보가 채널로 누출될 위험. 개인 DM
  은 sendPrivateAlert 로 분리 유지.
