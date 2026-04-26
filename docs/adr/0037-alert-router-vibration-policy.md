# ADR-0037: AlertRouter VIBRATION_POLICY + 채널 시멘틱 별칭 + boundary 가드

상태: 채택 (PR-X1, 2026-04-26)
영향 범위: `server/alerts/alertRouter.ts`, `server/alerts/alertCategories.ts`,
`scripts/check_channel_boundary.js`, `package.json`

## 1. 배경

사용자 알림 정책 개선안 12 아이디어 (텔레그램 채널 운영 재설계) 중 6+7 번
"alertRouter SSOT 도입 + 카테고리별 진동 정책 매트릭스" 를 1번 PR 로 분리.

기존 상태 audit 결과:
- `alertRouter.ts` 에 4 카테고리(TRADE/ANALYSIS/INFO/SYSTEM) + dispatchAlert
  단일 진입점 + 디지스트 라우팅(daily/weekly) 이미 존재.
- `channelPipeline.ts` 의 12개 발송 함수 모두 `dispatchAlert` 경유로 발송 중.
- 그러나 각 호출처가 `disableNotification: true/false` 를 임시방편으로 분산
  지정해 정책 일관성 부재.
- `process.env.TELEGRAM_*_CHANNEL_ID` 직접 접근이 alertRouter 외부로 누출될
  위험을 차단하는 자동화된 가드 부재.

## 2. 결정

### 2.1 사용자 의도 기반 시멘틱 별칭

기존 enum 값 (TRADE/ANALYSIS/INFO/SYSTEM) 은 환경변수 / 영속 데이터 / 채널 ID
매핑에 이미 깊게 박혀 있어 enum 자체를 변경하면 회귀 위험이 크다.
대신 **`ChannelSemantic`** 별칭 객체를 export 해 신규 코드는 사용자 의도에
맞는 이름으로 호출:

| Semantic   | enum 값  | 용도                                |
|-----------:|---------:|-------------------------------------|
| EXECUTION  | TRADE    | 매매 절대 채널 (체결/손절/비상정지) |
| SIGNAL     | ANALYSIS | 오늘 사냥감 (워치리스트/픽)         |
| REGIME     | INFO     | 매크로 사령탑 (레짐/글로벌)         |
| JOURNAL    | SYSTEM   | 메타 학습 (성과/주간 리포트)        |

기존 호출자(`AlertCategory.TRADE` 등) 는 100% 그대로 동작.

### 2.2 VIBRATION_POLICY 매트릭스

카테고리 × 심각도 (CRITICAL/HIGH/NORMAL/LOW) 별 **진동(알림 소리)** 결정 SSOT:

```ts
VIBRATION_POLICY: Record<AlertCategory, Record<AlertSeverity, boolean>> = {
  [AlertCategory.TRADE]:    { CRITICAL: true,  HIGH: true,  NORMAL: true,  LOW: true  },
  [AlertCategory.ANALYSIS]: { CRITICAL: true,  HIGH: false, NORMAL: false, LOW: false },
  [AlertCategory.INFO]:     { CRITICAL: true,  HIGH: true,  NORMAL: false, LOW: false },
  [AlertCategory.SYSTEM]:   { CRITICAL: false, HIGH: false, NORMAL: false, LOW: false },
};
```

- `true` = 진동 ON (`disableNotification: false`)
- `false` = 진동 OFF (`disableNotification: true`)

페르소나 원칙 매핑:
- **EXECUTION** — "매도가 매수보다 중요" → 모든 심각도 진동 ON. 체결/주문
  변동은 즉각 인지 필요.
- **SIGNAL** — "후회 회피 심리 경계" → CRITICAL 만 진동. 픽 알림 폭주 시
  FOMO 유발 차단. 사용자가 장 시작 30분 동안 한 번에 훑어볼 수 있게 누적.
- **REGIME** — "매크로 합치 검증" → CRITICAL/HIGH 만 진동. R-레짐 전환은
  진동, 일상 글로벌 스캔은 조용히.
- **JOURNAL** — "투자 90%는 자기 관리" → 모두 진동 OFF. 시간 격리(주말/저녁
  복기용).

### 2.3 호출자 override 정책

`resolveVibrationDecision(category, severity, override?)` SSOT:
- `override !== undefined` → 그대로 사용 (호출자 명시 우선)
- `override === undefined` → VIBRATION_POLICY[category][severity] 적용

기존 callsite 가 명시적으로 `disableNotification: true/false` 지정한 경우는
그대로 보존되고, 미지정한 경우(implicit) 만 정책이 적용된다 — 후방호환 보장.

### 2.4 AlertSeverity 별칭

`DispatchPriority` 는 내부 cooldown 계산용 명칭이고, 사용자 의도 표현에는
`AlertSeverity` 가 더 자연스럽다. 둘은 동일 union type.
`DispatchAlertOptions.severity` 신규 옵셔널 필드 추가 — 명시 시 `priority`
보다 우선.

## 3. 채널 ID 직접 접근 boundary 가드

### 3.1 규칙

`process.env.TELEGRAM_TRADE_CHANNEL_ID` 같은 채널 ID env 의 **직접** 접근은
다음 SSOT 파일에서만 허용:
- `server/alerts/alertRouter.ts` — 채널 해석 SSOT
- `server/alerts/alertCategories.ts` — env parser
- `server/alerts/telegramClient.ts` — LEGACY (`sendPickChannelAlert`,
  PR-X3 에서 alertRouter 경유로 마이그레이션 예정)
- `scripts/check_channel_boundary.js` — 시그니처 정의 자체

탐지 시그니처 5종:
- `TELEGRAM_TRADE_CHANNEL_ID`
- `TELEGRAM_ANALYSIS_CHANNEL_ID`
- `TELEGRAM_INFO_CHANNEL_ID`
- `TELEGRAM_SYSTEM_CHANNEL_ID`
- `TELEGRAM_PICK_CHANNEL_ID` (legacy alias for ANALYSIS)

`TELEGRAM_CHAT_ID` 는 본 boundary 대상 아님 (개인 1:1 채팅 분리는 후속 PR-X2).

### 3.2 매칭 패턴

코드 영역만 검사 (블록/라인 주석 제거 후):
- `process.env.SIGNATURE`
- `process.env['SIGNATURE']` / `process.env["SIGNATURE"]`

단순 변수명 등장(`const TELEGRAM_TRADE_CHANNEL_ID = ...`) 은 위반 아님.

### 3.3 실행

- `npm run validate:channelBoundary` — 전체 스캔
- `npm run validate:all` 에 통합
- `npm run precommit` 에 통합 (커밋 전 자동 차단)

## 4. 후속 PR

본 ADR 은 사용자 12 아이디어 중 6+7 번만 처리. 잔여 후속 PR:

| PR | 범위 |
|---:|------|
| PR-X2 | 개인 1:1 채팅 분리 + sendTelegramBroadcast deprecated (잔고/자산 키워드 lint) |
| PR-X3 | 12개 callsite 시멘틱 별칭 마이그레이션 + telegramClient.sendPickChannelAlert deprecated |
| PR-X4 | CH3 매크로 다이제스트 정기 cron (08:30 + 16:00 KST) |
| PR-X5 | CH4 주간 자기비판 리포트 (일요일 19:00 KST, attribution + bias heatmap 결합) |
| PR-X6 | /channel_test 명령 + 손절 카운트다운 사전 경보 (개인 채팅 한정) |

## 5. 회귀 안전장치

- `alertRouter.vibration.test.ts` 21 케이스 — 매트릭스 정합성 + 우선순위 +
  ChannelSemantic 매핑.
- `channelBoundary.test.ts` 9 케이스 + 1 통합 실행 — 패턴 매칭 + 주석 제외 +
  TELEGRAM_CHAT_ID 제외 + 다중 위반 누적.
- 호출자 미수정 — 기존 `disableNotification: true/false` 명시 호출은 그대로
  동작, implicit 호출만 정책 적용.

## 6. 거부된 대안

- **enum 자체 rename (TRADE → EXECUTION)**: 영속 데이터(channelStatsRepo /
  alertHistoryRepo) 의 카테고리 키가 모두 string serialization 이라 마이그레
  이션 비용이 매우 큼. 시멘틱 별칭만으로 충분.
- **VIBRATION_POLICY 환경변수화**: 정책은 페르소나 원칙의 직접 구현이라
  배포마다 바뀌면 안 된다. 코드 레벨 SSOT 가 정합.
- **boundary WARN-only 모드**: SSOT 정합성은 경고가 아니라 차단이어야 의미가
  있다. 화이트리스트 3 파일로 충분히 좁다.
