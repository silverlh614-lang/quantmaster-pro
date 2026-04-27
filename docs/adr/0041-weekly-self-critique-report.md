# ADR-0041: CH4 JOURNAL 주간 자기비판 리포트 — 일요일 19:00 KST 자동 발행

상태: 채택 (PR-X5, 2026-04-26)
영향 범위: `server/alerts/weeklySelfCritiqueReport.ts`,
`server/scheduler/alertJobs.ts`, ADR-0037~0040 후속

## 1. 배경

사용자 12 아이디어 중 **11번 — "CH4 JOURNAL 주간 자기 비판 리포트, 일요일 19:00"**
처리. 페르소나의 "보유 효과·후회 회피 경계" 원칙을 자동화된 거울로 구현.

이번 주 거래 결과 + 가장 큰 행동 편향 자동 진단 + 손절 패턴 메타 분석 →
"이번 주 -7% 손절 N건 중 M건이 R5_CAUTION 레짐에서 진입 — 레짐 필터 강화 권고"
같은 자동 권고를 매주 일요일 저녁 한 번 받는다. CH4 채널의 시간 격리 (주말
정독) 정체성을 강화.

## 2. 결정

### 2.1 발행 시간

- **SUN 19:00 KST** (UTC 10:00 일요일)
- cron `0 10 * * 0`

### 2.2 메시지 구조

```
🔍 [주간 자기 비판] 19:00 KST
━━━━━━━━━━━━━━━━

📅 주간 범위: 2026-04-19 ~ 2026-04-26 (KST)

📊 주간 거래 결산
  실현 fill: 12건 (승 7 / 패 5) | 가중 P&L: +2.30% | 실현: 1,250,000원
  부분익절 3건 / 전량청산 9건 (총 12개 trade)

💢 주요 행동 편향 (3일 연속 ≥ 0.5)
  🔴 손실 회피 평균 0.65 ↗ 악화
  🟡 과신 평균 0.55 → 정체

🛡️ 손절 패턴 분포
  총 손절 6건
  • R5_CAUTION / ATR_HARD_STOP: 4건 (66%)
  • R2_BULL / CASCADE_HALF: 2건 (33%)
  → R5_CAUTION 레짐 진입 후 손절 4건 (66%) — 해당 레짐에서 진입 임계값 +1점 강화 권고

🧪 학습 실험: 활성 2건 / 최근 완료 1건

📅 다음 주 점검 포인트
  • 손실 회피 편향 모니터링
  • R5_CAUTION 레짐 진입 임계값 +1점 강화 권고

━━━━━━━━━━━━━━━━
매주 일요일 19:00 KST 자동 발송 — 페르소나 자기통제 거울
```

### 2.3 데이터 소스

- **주간 거래 결산** — `aggregateFillStats(trades, { fromIso, toIso })` (PR-15~18 fill SSOT)
- **편향 진단** — `getLearningHistory(7).escalatingBiases` (3일 연속 ≥ 0.5)
- **손절 패턴** — `summarizeStopPatterns(weeklyStops)` 신규 함수, `entryRegime × exitRuleTag` 별 카운트
- **권고 생성** — `buildStopPatternRecommendation(buckets, total)` 신규 휴리스틱
- **학습 실험** — `getLearningStatus().experimentProposalsActive/CompletedRecent`
- **reflection 누락** — `getLearningStatus().consecutiveMissingDays` (≥3일 시 ⚠️ 경고)

`failurePatternDB.ts` 의 직접 활용은 본 PR 범위 밖 — 이번 주 손절 trade 만으로
패턴 분포가 충분히 의미 있고, failurePatternDB 는 더 긴 기간(30~90일)에서 활용
가치가 큼. 후속 PR 에서 보강 가능.

### 2.4 자동 권고 휴리스틱 (`buildStopPatternRecommendation`)

표본/비율 임계값:
- `top.count < 3` → null (표본 부족)
- `top.count / total < 40%` → null (분산 — 패턴 없음)

권고문 분기:
- **R5_CAUTION / R6_DEFENSE** 다수 → "해당 레짐에서 진입 임계값 +1점 강화"
- **ATR_HARD_STOP / HARD_STOP_LOSS** 다수 → "손절폭(ATR 배수) 검토"
- **CASCADE_FINAL / CASCADE_HALF** 다수 → "진입 시점 시장 모멘텀 검증 강화"
- 그 외 → "패턴 모니터링 권고"

### 2.5 편향 표시 정책

`escalatingBiases` 의 평균 점수 → 등급 이모지:
- ≥ 0.7 → 🔴
- ≥ 0.5 → 🟡
- < 0.5 → 🟢 (필터링 단계에서 이미 제외됨, 안전 fallback)

trend 표시 (recentScores 의 first → last):
- last - first ≥ 0.1 → ↗ 악화
- last - first ≤ -0.1 → ↘ 개선
- 그 외 → → 정체

상위 3개 편향만 표시 (인지 부담 최소화).

### 2.6 절대 규칙 준수

- **개별 종목 정보 절대 포함 금지** — CH4 JOURNAL 정체성: 메타 학습.
  회귀 테스트가 6자리 코드 패턴 부재 검증.
- **잔고 키워드 8종 누출 금지** — `validate:sensitiveAlerts` 자동 차단 +
  회귀 테스트 검증.
- **dispatchAlert(ChannelSemantic.JOURNAL) 단일 진입점** — `VIBRATION_POLICY[SYSTEM]`
  모든 심각도 OFF (시간 격리).

### 2.7 dedupeKey

`weekly_self_critique:{KST 일요일}` — 같은 일요일 재시작 시 이중 발송 차단.

## 3. 후속 PR

| PR | 범위 |
|---:|------|
| PR-X6 | /channel_test 명령 + 손절 카운트다운 사전 경보 (sendPrivateAlert 한정) |

## 4. 회귀 안전장치

- `weeklySelfCritiqueReport.test.ts` 29 케이스 — summarizeStopPatterns 5 +
  buildStopPatternRecommendation 8 + formatWeeklySelfCritique 11 + 절대 규칙 2 +
  dispatchAlert wiring 3.
- `validate:sensitiveAlerts` 통과 — formatWeeklySelfCritique 메시지에 잔고
  키워드 0건.
- `validate:channelBoundary` 통과 — TELEGRAM_*_CHANNEL_ID 직접 접근 없음
  (alertRouter.dispatchAlert 만 사용).

## 5. 거부된 대안

- **failurePatternDB 즉시 결합**: 주간 단위는 표본이 작아 cosineSimilarity 기반
  유사 패턴 매칭이 통계적으로 약함. 30~90일 누적 후 별도 PR 에서 추가.
- **개별 종목 손절 사례 인용** ("삼성전자 -8% 손절 - 진입 시점 R5_CAUTION"):
  CH4 정체성 위반. 종목 정보가 필요한 회고는 알림 스택 외 (예: /scan_review
  명령) 으로 분리.
- **동시각에 자동 매매 보수화 액션 적용**: 본 리포트는 *진단* 만. 실제 가중치
  조정은 nightlyReflectionEngine 의 experimentProposal / suggestNotifier 채널을
  통해 별도 승인 후 적용. 본 리포트는 "자동화된 거울" 로 한정.
- **Gemini API 호출로 권고 강화**: 결정적 휴리스틱이 회귀 안전. 외부 호출 없음
  → 본 cron 은 학습 budget 영향 없고 매주 동일 동작 보장.
