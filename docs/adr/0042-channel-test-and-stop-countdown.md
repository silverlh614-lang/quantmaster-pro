# ADR-0042: /channel_test 4채널 헬스체크 + 손절 카운트다운 sendPrivateAlert 정합화

상태: 채택 (PR-X6, 2026-04-26)
영향 범위: `server/telegram/commands/alert/channelTest.cmd.ts`,
`server/trading/exitEngine/rules/stopApproachAlert.ts`, ADR-0037~0041 후속

## 1. 배경

사용자 12 아이디어 중 **8번 (손절 카운트다운 사전 경보 — 개인 DM 한정)** + **12번
(/channel_test 4채널 헬스체크)** 마무리 처리.

audit 결과:
- `stopApproachAlert` 규칙(ADR-0028)이 이미 -5%/-3%/-1% 3단계 손절 접근 경보를
  발송 중이지만 `sendTelegramAlert` 사용 — 함수 이름이 모호해 사용자 의도("개인
  DM 한정 — 패닉 매도 차단") 가 코드에서 직접 안 드러남.
- `/channel_test` 명령은 `TELEGRAM_CHAT_ID` 단일 채널만 테스트 — 사용자 의도
  ("4채널 동시 헬스체크 + 실패 시 환경변수 진단") 와 불일치.

## 2. 결정

### 2.1 stopApproachAlert sendPrivateAlert 마이그레이션

3단계 (-5%/-3%/-1%) 손절 접근 경보가 `sendTelegramAlert` → `sendPrivateAlert`
로 시멘틱 정합화. 동작은 동일 (`TELEGRAM_CHAT_ID` 만 발송) — 함수 이름이 사용자
의도와 직접 일치하도록 명문화.

페르소나 원칙:
> "손절은 운영 비용" 강화 + 사용자 패닉 매도 차단 — 사전 경보는 개인 DM 만,
> CH1 EXECUTION 채널은 실제 발동 후 사후 보고만 (channelSellSignal 기존 흐름).

### 2.2 /channel_test 4채널 헬스체크 확장

기존 `runChannelHealthCheck()` (alertRouter SSOT, PR-X1 부터 존재) 를 명령어로
노출. 4채널(TRADE/ANALYSIS/INFO/SYSTEM = EXECUTION/SIGNAL/REGIME/JOURNAL) 모두
동시 발송 후 결과 집계.

`formatChannelHealthCheckResult(result)` 순수 함수 신규 — 테스트 가능하도록
포맷 로직 분리.

#### 결과 메시지 분기

```
🧪 [4채널 헬스체크 결과]
━━━━━━━━━━━━━━━━
✅ CH1 EXECUTION (TRADE) — 정상 (msg #101)
✅ CH2 SIGNAL (ANALYSIS) — 정상 (msg #102)
❌ CH3 REGIME (INFO) — 채널 ID 미설정 (TELEGRAM_INFO_CHANNEL_ID)
✅ CH4 JOURNAL (SYSTEM) — 정상 (msg #104)
━━━━━━━━━━━━━━━━
요약: 3/4 채널 정상
⚠️ 미설정 환경변수: TELEGRAM_INFO_CHANNEL_ID
```

분기:
- **정상** → ✅ msg ID 노출
- **채널 ID 미설정** (`configured=false`) → ❌ + 환경변수 이름 안내
- **CHANNEL_ENABLED=false** (`enabled=false`) → ⏸️ 비활성 표시
- **발송 실패** (`ok=false` + configured + enabled) → ❌ + reason 노출
- **요약 라인** — N/4 채널 정상 + 미설정 환경변수 누적 안내
- **모두 정상** 시 추가 라인 ✨ "알림 라우팅 건강함"

### 2.3 명령어 메타

```ts
{
  name: '/channel_test',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 1,  // 4채널 발송 — 메시지 발송 부수효과
  description: '4채널(EXECUTION/SIGNAL/REGIME/JOURNAL) 헬스체크 + 미설정 진단',
}
```

### 2.4 부팅 reconcile 패턴 호환

bootReconcile dry-run (PR-50 ADR-0015) 과 동일 철학 — 운영자가 명령 1회로
환경변수 / 봇 권한 / 채널 ID 진단을 즉시 받는다. 차이점:
- bootReconcile: 부팅 시 자동 1회 dry-run (KIS 잔고 vs 로컬 장부)
- /channel_test: 운영자 수동 호출 (4채널 발송 → 결과 집계)

## 3. 12 아이디어 완주

본 PR-X6 으로 사용자 12 아이디어 모두 처리 완료:

| # | 아이디어 | PR |
|---|---------|------|
| 1 | CH1 EXECUTION = 매매 절대 채널 | PR-X1 (정책 명문화) |
| 2 | CH2 SIGNAL = 오늘 사냥감 | PR-X1 + X3 (`disableNotification` VIBRATION_POLICY 자동) |
| 3 | CH3 REGIME = 매크로 사령탑 | PR-X1 + X4 (정기 다이제스트) |
| 4 | CH4 JOURNAL = 메타 학습 | PR-X1 + X5 (주간 자기비판) |
| 5 | 개인 1:1 = 비상 회선 격리 | PR-X2 (sendPrivateAlert + lint) |
| 6 | alertRouter SSOT | PR-X1 |
| 7 | VIBRATION_POLICY 매트릭스 | PR-X1 |
| 8 | 손절 카운트다운 (개인 DM) | PR-X6 (sendPrivateAlert 정합화) |
| 9 | Track A vs B 시각 구분 | (기존 channelWatchlistSummary 가 SWING/CATALYST/MOMENTUM 3섹션으로 충족) |
| 10 | CH3 매크로 다이제스트 정기 cron | PR-X4 |
| 11 | CH4 주간 자기비판 리포트 | PR-X5 |
| 12 | /channel_test 4채널 헬스체크 | PR-X6 |

## 4. 회귀 안전장치

- `channelTest.test.ts` 15 케이스 — formatChannelHealthCheckResult 7 (모두 정상
  / 1개 미설정 / 비활성 / 발송 실패 / 다중 미설정 / 순서 / enum 4값 drift) +
  stopApproachAlert sendPrivateAlert 마이그레이션 4 (import / 호출 0건 /
  3단계 호출 / ADR 메모) + channelTest 등록 4 (registry / name·category /
  runChannelHealthCheck import / formatChannelHealthCheckResult export).
- 기존 `stopApproachAlert.test.ts` 6 케이스 — sendTelegramAlert mock 을
  sendPrivateAlert 로 sed 일괄 교체, 행위 동일.
- LIVE 매매 본체 0줄 변경 — sendTelegramAlert ↔ sendPrivateAlert 는 같은
  `sendTelegramAlert` 구현 위임이므로 행위 보존.

## 5. 거부된 대안

- **stopApproachAlert 임계값을 -7%/-5%/-3% (손익률 기준) 로 변경**: 현재 임계는
  손절가까지의 거리 (절대값) 기준으로 동작 중이고 의미가 다름. 사용자 의도가
  손익률 기준이라면 별도 PR 필요. 본 PR 은 시멘틱 정합화 (sendTelegramAlert →
  sendPrivateAlert) 만 처리.
- **/channel_test 실패 시 자동으로 운영자에게 별도 DM**: 명령어 자체가 운영자
  실행이라 reply() 가 운영자에게 직접 전달됨. 별도 DM 은 중복.
- **runChannelHealthCheck 캐시 (1분 dedupe)**: 본 명령은 운영자 진단 용도로
  실시간 결과가 핵심. 캐시는 의도 위반.
- **stopApproachAlert 본체에 ADR-0040 매크로 다이제스트와 동일 dedupeKey
  포맷**: 이미 `stop_approach_{1|2|3}:{stockCode}` 가 단계별 dedupe 충분.
  형식 통일은 cosmetic.
