# ADR-0040: CH3 REGIME 매크로 다이제스트 정기 발행 cron (08:30 + 16:00 KST)

상태: 채택 (PR-X4, 2026-04-26)
영향 범위: `server/alerts/macroDigestReport.ts`, `server/scheduler/alertJobs.ts`,
ADR-0037/0038/0039 후속

## 1. 배경

사용자 12 아이디어 중 **10번 — "CH3 REGIME 전용 매크로 다이제스트, 1일 2회
정기 발행"** 처리. 페르소나의 "글로벌 스마트 머니 ETF 추적" 원칙을 일과화.

이 채널은 정기 리듬을 가진 유일한 채널로 만들어, 사용자가 무의식적으로 시간을
동기화하게 한다. 같은 시각·같은 형식으로 발송되어야 매크로 합치 검증의 기준점
역할을 할 수 있다.

## 2. 결정

### 2.1 시간

- **PRE_OPEN** — KST 08:30 (UTC 23:30 일~목)
  - 한국 장 시작 30분 전, 간밤 미국 시장 + 환율 + 한국 사전 컨텍스트
  - cron `30 23 * * 0-4` (UTC 일~목 23:30 = KST 월~금 08:30)
- **POST_CLOSE** — KST 16:00 (UTC 07:00 월~금)
  - 한국 장 마감 30분 후, 결산 + 글로벌 컨텍스트 + 매크로 헬스
  - cron `0 7 * * 1-5` (UTC 월~금 07:00 = KST 월~금 16:00)

`preMarketSignal` 가 동시각(KST 08:30)에 별개 작업으로 등록돼 있지만 메시지가
다르고 채널 카테고리(JOURNAL vs REGIME)도 다르므로 충돌 없음.

### 2.2 메시지 구조

#### PRE_OPEN (08:30)
```
🌅 [매크로 다이제스트 (장 전)] 08:30 KST
━━━━━━━━━━━━━━━━

🇺🇸 간밤 미국
  VIX {n} (전일 대비 {±%})
  US10Y-2Y 스프레드: {n} (음수 시 ⚠️ 역전)
  DXY {강세|약세} (5d {±%})

💱 환율
  USD/KRW {n}원 (당일 {±%} · 20d {±%})

🇰🇷 한국 사전
  VKOSPI {n} (5d {↑↓→})
  외국인 5d 누적: {±조원|±억원}
  EWY ADR: {±%}

📊 매크로 헬스
  MHS {n} {↗→↘} | {Regime}
━━━━━━━━━━━━━━━━
```

#### POST_CLOSE (16:00)
```
🌆 [매크로 다이제스트 (장 후)] 16:00 KST
━━━━━━━━━━━━━━━━

🇰🇷 한국 결산
  KOSPI 일변동 {±%} | 20d {±%}
  VKOSPI {n} (5d {↑↓→})
  외국인 5d 누적: {±조원|±억원}
  신용잔고 5d 변화: {±%}

💱 환율
  USD/KRW {n}원 (당일 {±%})

🌐 글로벌 컨텍스트
  S&P500 20d {±%}
  DXY 5d {±%}
  WTI {n} USD/배럴
  HY 스프레드: {n}%  (옵셔널)

📊 매크로 헬스
  MHS {n} {↗→↘} | {Regime}
━━━━━━━━━━━━━━━━
```

### 2.3 데이터 소스

`macroStateRepo.loadMacroState()` 단일 SSOT. 외부 호출 0건 — 다른 cron(예:
`marketDataRefresh`)이 이미 갱신해둔 macroState 만 읽음. 매크로 다이제스트
자체가 데이터 수집 책임을 갖지 않는다.

### 2.4 Graceful fallback

`macroState=null` 또는 개별 필드 누락(undefined/NaN) 시 `'N/A'` 로 표시.
메시지 자체는 항상 발송 — 데이터 갱신 작업이 실패해도 매크로 다이제스트의
"정기 리듬" 은 깨지지 않는다.

`hySpread` 같은 옵셔널 필드는 누락 시 라인 자체 생략 (`filter(Boolean)`).

### 2.5 절대 규칙 준수

- **개별 종목 정보 절대 포함 금지** — CH3 REGIME 정체성: "시장 전체 상태만
  다룬다". 회귀 테스트가 6자리 코드 패턴 부재 검증.
- **잔고 키워드 누출 금지** — `validate:sensitiveAlerts` (ADR-0038) 가 자동
  차단. 회귀 테스트가 8 키워드 부재 검증.
- **dispatchAlert(ChannelSemantic.REGIME) 단일 진입점** — alertRouter SSOT
  (ADR-0037) 통과. `VIBRATION_POLICY[INFO][NORMAL]=false` 자동 적용 →
  진동 OFF (일상 매크로는 조용히).

### 2.6 dedupeKey

`macro_digest:{PRE_OPEN|POST_CLOSE}:{YYYY-MM-DD KST}` — 같은 KST 일자에
동일 mode 중복 발송 자동 차단 (서버 재시작 시 발생할 수 있는 이중 cron 등록).

## 3. 후속 PR

| PR | 범위 |
|---:|------|
| PR-X5 | CH4 일요일 19:00 KST 주간 자기비판 리포트 |
| PR-X6 | /channel_test 명령 + 손절 카운트다운 사전 경보 (sendPrivateAlert 한정) |

## 4. 회귀 안전장치

- `macroDigestReport.test.ts` 23 케이스 — PRE_OPEN 6 + POST_CLOSE 3 + 외국인
  단위 분기 5 + 잔고 키워드 누출 방지 3 + dispatchAlert wiring 4 +
  dedupeKey KST 자정 정합 2.
- `validate:sensitiveAlerts` 자동 통과 — formatMacroDigest 메시지에 잔고
  키워드 0건.
- cron 등록 시각이 KST 08:30 / 16:00 정확히 매칭 (회귀 테스트가 dedupeKey 의
  KST 일자 변환 검증).

## 5. 거부된 대안

- **외부 호출(KRX/Yahoo) 직접 수행**: 매크로 다이제스트는 데이터 *전달* 역할.
  데이터 수집은 marketDataRefresh 등 별도 cron 책임. 단일 책임 원칙.
- **3회 이상 발행** (예: 점심 12:00 추가): "정기 리듬" 의 미덕은 적은 횟수에서
  나옴. 사용자가 시간을 동기화할 수 있는 정도 = 1일 2회 (PRE_OPEN/POST_CLOSE).
- **시각화 차트 첨부 (이미지/그래프)**: Telegram 채널 메시지 본문 텍스트만으로
  충분 — 일과화 의도에 시각 자극은 오히려 방해.
