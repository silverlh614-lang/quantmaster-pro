# ADR-0093 — FOMC/VIX 게이팅 알림 dedupeKey + 12h cooldown 정합

**상태**: Accepted (PR-Z6)
**작성일**: 2026-04-29
**관련**: ADR-0061 (FOMC DAY 청산 정책), ADR-0028 (exitEngine 분해)

## 배경

사용자 보고 (4/29 FOMC DAY): 매매 봇 채널에 다음 메시지가 매 1분마다 반복 발송되어
채팅창 도배.

```
📅 [FOMC 게이팅] 신규 진입 차단
FOMC 발표일 (2026-04-29) — 신규 진입 금지
포지션 모니터링만 수행합니다.
```

`orchestrator_tick` cron (`*/1 0-8 * * 1-5` UTC = KST 평일 09:00~17:00) 이 매 1분
`runAutoSignalScan` 호출 → FOMC DAY 약 480 분 동안 480회 동일 메시지 발송.

## 근본 원인

`signalScanner.ts:323-327` (VIX) 및 `signalScanner.ts:347-350` (FOMC) 의 게이팅
차단 알림 호출에 **`dedupeKey` 부재**. 텔레그램 인프라 (`telegramClient.ts:118`)
는 `dedupeKey + cooldownMs` 를 이미 지원 — 호출자만 미사용.

같은 파일(`preflight.ts:299-304`)의 *FOMC 우호 환경 완화* 알림은 이미
`dedupeKey: fomc_relaxed_${date}` + `cooldownMs: 12h` 사용 중 → **drift 결함**.

영향 범위:
- `signalScanner.ts` VIX 게이팅 차단 알림
- `signalScanner.ts` FOMC 게이팅 차단 알림
- `preflight.ts` VIX 게이팅 차단 알림 (PR-40 Phase A 추출 시 동일 결함 복제)
- `preflight.ts` FOMC 게이팅 차단 알림 (동일)

## 결정

4 호출 site 모두 `dedupeKey + cooldownMs` 인자 추가. 패턴은 같은 파일 라인 301
(`fomc_relaxed_`) 와 정합:

### FOMC 게이팅 차단

```ts
await sendTelegramAlert(
  `📅 <b>[FOMC 게이팅] 신규 진입 차단</b>\n...`,
  {
    dedupeKey: `fomc_gating_block:${fomcProximity.nextFomcDate ?? 'unknown'}`,
    cooldownMs: 12 * 60 * 60 * 1000,
  },
).catch(console.error);
```

- `nextFomcDate` 사용 — 같은 FOMC 회차 동안 1회 발송
- `unknown` fallback — `nextFomcDate` 누락 시에도 KST 시간 기반 throttle 동작

### VIX 게이팅 차단

```ts
const kstDateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
await sendTelegramAlert(
  `🚨 <b>[VIX 게이팅] 신규 진입 차단</b>\n...`,
  { dedupeKey: `vix_gating_block:${kstDateStr}`, cooldownMs: 12 * 60 * 60 * 1000 },
).catch(console.error);
```

- VIX 게이팅은 *이벤트 기반 종료일 부재* → KST 일자 1회 사용
- 다음 영업일 같은 상황 재발 시 새 dedupeKey 로 다시 1회 발송

## 회귀 테스트

`gatingAlertDedupe.test.ts` 6 케이스 — *정적 패턴 검증* (코드베이스 grep 기반):

1. `signalScanner.ts` VIX 게이팅 → `vix_gating_block:` + 12h cooldown
2. `signalScanner.ts` FOMC 게이팅 → `fomc_gating_block:` + `nextFomcDate`
3. `preflight.ts` VIX 게이팅 동일 패턴
4. `preflight.ts` FOMC 게이팅 동일 패턴
5. **회귀 차단 가드** — 4 site 모두 알림 본문 + `.catch(` 사이에 `dedupeKey` 의무
6. 기존 `fomc_relaxed_` 패턴 보존 검증

미래 PR 에서 동일 결함이 재발하면 **회귀 차단 가드** 가 자동 fail — 정적 grep 으로
영구 보호.

## 비결과 (out-of-scope)

- **dispatchAlert 마이그레이션**: ADR-0037 alertRouter SSOT 사용은 별도 PR (현재
  `sendTelegramAlert` 직접 호출 패턴 유지 — 다른 게이팅과 정합).
- **VIX 게이팅 종료일 추적**: VIX gating 이 멈추는 시점 (vixHistory 안정화) 의
  *해제* 알림 발송은 후속 PR.
- **데이터 빈곤 게이트**: 이미 `dedupeKey: 'data-starved-scan' + cooldownMs: 30min`
  적용됨 (preflight.ts:319) — 본 PR scope 밖.
- **R6_DEFENSE 게이팅**: `preflight.ts:250` 알림 site 도 dedupeKey 검토 필요 —
  다른 PR 분리.

## 운영 효과

배포 후 다음 FOMC DAY (2026-06-19 예정):

| 시간대 | 기존 (도배) | 본 PR 후 |
|--------|-------------|----------|
| 09:00~16:00 | 약 420 회 | **1 회** |
| FOMC 회차당 | 480 회 | 1 회 |

VIX 게이팅도 동일 — 시장 panic 시 매 분 발송하던 알림이 KST 일자 1회 발송.

채팅창 도배 영구 차단. 운영자가 진짜 신호 (R6_DEFENSE / 비상정지 / 손절 등) 에
집중 가능.

## 회귀 위험 평가

- **LIVE 매매 본체 0줄 변경** — 게이팅 결정 로직, KIS 호출, fills SSOT 모두 무수정.
- **알림 빈도만 변경** — *내용* 동일, *횟수* 만 480회 → 1회.
- **fallback 안전** — `nextFomcDate` 누락 시에도 `unknown` fallback 으로 dedupe 작동.
- **회귀 가드** — 정적 grep 6 케이스 + 향후 동일 결함 자동 fail.

## 후속 PR 후보

- VIX 게이팅 *해제* 알림 (선택적 — 해제 시점 알리는 게 운영자 인지에 도움)
- R6_DEFENSE 게이팅 알림 dedupeKey 검토 (preflight.ts:250)
- 데이터 빈곤 게이트 cooldown 정책 통일 검토 (현재 30분 → 12h 통일?)
