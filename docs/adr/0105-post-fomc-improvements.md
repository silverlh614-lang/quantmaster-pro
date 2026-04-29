# ADR-0105 — Post-FOMC 4 항목 운영 개선

## Status
Accepted (2026-04-29)

## Context

사용자 4/29 운영 보고 4 항목 통합 처리:

1. **Shadow Advisory Mode** — `/shadow_advisory` 명령 + 일일 리포트 라인 (이미
   `shadowLearningSummary` 모듈로 존재) + UI 카드 Advisory 섹션.
2. **Yahoo heart ping 장시작 전 활성화** — 사용자 진단 *"장시작 전 yahoo heart
   ping 이 안 와서 역산갭/sanity 오류 (ADR-0091 STALE_BASE) 발생"*. 장시작
   직전 cron 으로 heartbeat warmup → autoPopulateWatchlist 의 base price
   fetch 가 정상값 받을 가능성 ↑.
3. **KIS 갱신 정책 변경** — 부팅 시마다 `forceRefreshKisTokens()` 호출 *제거*.
   기존 cron (`kis_token_refresh` 08:30/20:30 KST + lazy-refresh) 만 사용.
   사용자 의도: "기존처럼 정해진 시간에 자동 갱신".
4. **AUTO gate 품질 강화 (P0)** — 사용자 통찰 *"자동 시스템이 자기증식하기
   시작" — populate 빈도 감소보다 AUTO 후보 품질 강화 + stale eviction 강화가
   더 좋은 다음 단계*. 본 PR 은 Stage 1 (score 임계) + Stage 2-1 (거래대금)
   적용. Stage 2-2 (enemy/spread) + Stage 3 (momentum decay eviction) 후속.

## Decision

### 항목 1 — Shadow Advisory Mode

신규 텔레그램 명령 + UI 섹션 추가:

- `server/telegram/commands/system/shadowAdvisory.cmd.ts` 신설 — `/shadow_advisory`
  (alias `/sa_advisory`, `/sad`). 4 섹션: ① Rejection alpha 누락 (과엄격 의심)
  ② Over-Strict 조건 후보 ③ Good Defense 조건 (방어 성공) ④ Twin 우월. 자동
  임계 조정 *금지* 안내 명시 (PR-Y2 학습 정책 준수).
- `src/pages/ShadowLearningPage.tsx` 의 5 카드 위에 `ShadowAdvisorySection`
  헤더 카드 추가 — 3축 (과엄격/방어성공/트윈우월) 1줄 통합 진단 + 색상 분기
  (alpha 누락률 ≥30% → 적색, ≥15% → 황색, 그 외 녹색).
- 일일 리포트 라인은 기존 `shadowLearningSummary.ts` (`buildShadowLearningSummary`)
  로 이미 존재 — 추가 작업 불필요.

### 항목 2 — Yahoo heartbeat warmup cron

`server/scheduler/orchestratorJobs.ts` cron 1건 추가:

```ts
scheduledJob('55 23 * * 0-4', 'TRADING_DAY_ONLY', 'yahoo_heartbeat_warmup', ...)
```

- KST 08:55 (장시작 5분 전) — `fetchDailyBars('^KS11', '5d')` 1회 호출
- intent='HISTORICAL' (ADR-0058) — EgressGuard 시간 무관 통과
- 부수효과: `_yahooLastSuccessAt` heartbeat 갱신 → `getYahooHealthSnapshot()`
  status='OK' → autoPopulateWatchlist 의 base price fetch 가 stale 캐시 대신
  fresh 값 받을 가능성 ↑. ADR-0091 STALE_BASE 결함 사전 예방.

### 항목 3 — KIS 부팅 자동 갱신 제거

`server/index.ts` 의 `forceRefreshKisTokens()` 부팅 호출 *제거*. cron
(`kis_token_refresh` UTC 23:30 / 11:30 = KST 08:30 / 20:30, ALWAYS_ON) 정상
갱신 + lazy-refresh fallback 충분.

### 항목 4 — AUTO gate 품질 강화 (Stage 1 + 2-1)

`server/screener/stockScreener.ts` `autoPopulateWatchlist()` 의 시간대 프리셋
필터 *직후* + 섹션 분류 *전* 위치에 2 quality gate 추가:

**Stage 1 — AUTO 최소 score 임계** (`AUTO_MIN_SCORE` ENV, default 7.8):
```ts
if (gate.signalType === 'SKIP' && gate.gateScore < AUTO_MIN_SCORE) {
  rejectionLog.push({ ..., reason: `AUTO 최소 점수 미달 ${score}/10 (임계 ${AUTO_MIN_SCORE})` });
  continue;
}
```
SKIP signalType 종목 (Gate 7~9 미통과) 중 gateScore 7.8 미달은 watchlist
등록 거부. 기존엔 SKIP 도 MOMENTUM 으로 자동 등록되어 watchlist 가 *창고화*.

**Stage 2-1 — 거래대금 하위 제거** (`AUTO_MIN_TURNOVER_KRW` ENV, default
500,000,000원 = 5억원):
```ts
const turnoverKrw = quote.price * quote.volume;
if (turnoverKrw < AUTO_MIN_TURNOVER_KRW) {
  rejectionLog.push({ ..., reason: `거래대금 부족 ${억}억원 (최소 5억)` });
  continue;
}
```
거래대금 충분해야 진입/청산 시 슬리피지 ↓ 보장.

**ENV 우회**: `AUTO_MIN_SCORE=0` + `AUTO_MIN_TURNOVER_KRW=0` 으로 본 gate
완전 비활성 가능 (운영 비상 시).

### 본 PR scope 외 (후속 명시)

- **Stage 2-2 — enemy / spread quality gate**: `enemyAutoBlock` 모듈은 이미
  `buyPipeline.ts` 진입 직전에 wired (ADR-0078). AUTO gate 단계에서 *추가*
  호출은 KIS 호출 비용 부담 — 후속 PR 분리. spread (호가 갭) 데이터는 Yahoo
  부재 → KIS 호가 보드 데이터 wiring 후속 PR.
- **Stage 3 — momentum decay eviction**: 현재 watchlist 만료 정책은 MOMENTUM
  2영업일 / SWING 7영업일. 사용자 요청 *"2일 이상 momentum 유지 실패 → auto
  demotion"* 은 *gateScore 재평가 + 기준 미달 시 demotion* 로직. 별도 cron
  + watchlistManager 리팩터 필요 — 후속 PR.

## Consequences

### 즉시 효과 (배포 후)

- `/shadow_advisory` 운영자 메타 진단 명령 즉시 사용 가능 + UI 페이지에
  ShadowAdvisorySection 섹션 표시.
- 평일 KST 08:55 Yahoo heartbeat warmup → 09:00 장시작 직후 `autoPopulateWatchlist`
  의 첫 base price fetch 가 stale 가능성 ↓.
- KIS 토큰 갱신 빈도 ↓ (재배포마다 OAuth2 호출 → cron 1일 2회).
- AUTO gate 품질 ↑ — gateScore 7.8 미달 + 거래대금 5억 미만 종목 자동 거부.

### 회귀 위험

- 항목 4 (AUTO gate) 가 가장 큰 변경. 기존 watchlist 가 7.8 미달 + 5억 미만
  종목으로 *유입* 되던 비율이 운영 데이터에 따라 다름. ENV 우회로 안전망.
- 나머지 3 항목은 *추가 cron / 명령 / UI 섹션* 으로 LIVE 매매 본체 무영향.

### 회귀 테스트 18 신규

- `shadowAdvisory.test.ts` 10 — formatShadowAdvisoryMessage 7 분기 + cmd
  메타데이터 3 (name/aliases/category + execute 정상/throw)
- `autoQualityGate.test.ts` 8 — Stage 1 패턴 3 + Stage 2-1 패턴 3 + 위치 정합 1
  + 사용자 통찰 주석 보존 1

## References

- ADR-0058 — EgressGuard IntentTag (HISTORICAL intent 시간 무관 통과)
- ADR-0078 — Enemy Auto Block (buyPipeline 진입 직전 차단)
- ADR-0091 — Yahoo STALE_BASE Fallback (사용자 진단의 직접 후속)
- 사용자 보고 (2026-04-29 FOMC DAY 운영 종료 후)
