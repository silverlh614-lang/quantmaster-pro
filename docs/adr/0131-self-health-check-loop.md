# ADR-0131 — 자가점검 헬스 루프 + 인증키 만료 알림 + 휴장 후 첫 거래일 가속 점검

**상태:** 채택 (2026-04-30)
**대상 PR:** `claude/add-health-check-scheduling-TD1nz`
**선행 ADR:** ADR-0017 (Telegram Meta Commands), ADR-0043 (MarketDayClassifier + ScheduleGuard), ADR-0049 (PR-49 헬스 진단 SSOT), ADR-0056 (06:30 KST self-diagnosis cron)

## 배경

지난 9일간 운영자에게 진단 명령 12개 (`/health` `/regime` `/scheduler` `/learning_status` 등) 모두를 외우게 하는 건 비현실적. 실제 운영 패턴은:

1. 정상 → 정상 상태 전환은 인지할 가치 없음 → Telegram 노이즈만 됨
2. 정상 → 비정상 전환은 *즉시* 인지가 필요 (예: KIS 토큰 만료 임박 / master count 50% 감소 / Tier 4 fallback 진입)
3. 동일 임계 반복 알림은 노이즈 (예: master 988개일 때 매 5분마다 "Tier 4!" 알림)

또한 `4/27~5/01` 패턴 (어린이날 + 부처님오신날 연휴 직후 첫 거래일 시스템 점검 부재) 재발 방지 + KRX_API_KEY 만료 (2027/04/19) 사전 알림 부재.

## 결정

3종 SSOT 모듈 + 1 텔레그램 명령 신설:

### 1. `server/scheduler/healthLoop.ts` — 3티어 자가점검

| Tier | Cron | 정책 |
|------|------|------|
| 1 (5분) | `*/5 * * * *` | KIS 토큰 6h bucket / master 50% drop / Tier 4 진입회복 / autoTrade 토글 |
| 2 (1시간) | `0 * * * *` | (시드만 — 향후 Yahoo probe / KRX 회로 등) |
| 3 (일일 09:00) | `0 0 * * *` UTC = KST 09:00 | 종합 점검 (시드만) |

**중복 알림 차단:** `state.alertedKeys[key] = ymd` 영속 — 같은 임계는 같은 날 1회만 알림.

### 2. `server/health/credentialExpiryWatchdog.ts` — D-90/30/7/1/0 단계별

KRX_API_KEY (2027-04-19) 만료 임박 자동 알림. D-90/30/7/1/0 임계 *도달 시*에만 알림 (임계 변화). 만료 후 (D-0) 매일 1회.

### 3. `server/scheduler/postHolidayKickstart.ts` — 휴장 후 첫 거래일 가속 점검

- **07:30 1차** — 5 check (KRX Master / KIS Token / KRX OpenAPI 응답성 / Auto Trade / Watchlist).
- **08:30 추적** — 1차 fail 항목 해소 여부 비교, 변화만 보고.
- **`isPostHolidayFirstDay()` 가드** — 일반 거래일은 cron 진입 즉시 silent return.

### 4. `/health_loop_status` (alias `/hls`) — 통합 진단

3티어 마지막 실행 + KIS/master/autoTrade 현재 상태 + KNOWN_CREDENTIALS 남은 일수 + Pre-Market Kickstart 마지막 실행 1 메시지 통합.

## 4 알림 정책

```
정상 → 정상   : Telegram 무알림 (Railway 로그만)
정상 → 비정상 : 즉시 Telegram 🚨 (priority='HIGH'/'CRITICAL', dedupeKey + 24h cooldown)
비정상 → 정상 : ✅ 회복 알림 1회
비정상 → 비정상 (지속) : 무알림 (alertedKeys 24h dedupe)
```

## 절대 금지

- 일반 거래일에 Pre-Market Kickstart 실제 점검 실행 (`isPostHolidayFirstDay()` 가드 의무)
- 정상 상태 Telegram 자주 알림 (alertOnce dedupe 의무)
- 한 임계당 중복 알림
- 알림에 자동 수리 시도 (운영자 결정 영역, remediation 텍스트만)
- KRX_API_KEY 환경변수 변경
- collectHealthSnapshot 외부 추가 호출 (read-only 만)
- KIS/KRX 신규 라이브 호출 (절대 규칙 #2/#3/#4)

## ENV 우회

- `HEALTH_LOOP_DISABLED=true` — 3티어 모두 cron skip
- `CREDENTIAL_WATCHDOG_DISABLED=true` — 인증키 watchdog cron skip
- `POST_HOLIDAY_KICKSTART_DISABLED=true` — 휴장후 점검 cron skip

## 후속 PR (scope 외)

- Tier 2 / Tier 3 점검 항목 확장 (Yahoo probe / KRX 회로 / Gemini budget)
- KIS 토큰 / Naver / 기타 credentials KNOWN_CREDENTIALS 등록
- 자동 수리 액션 (고급 — 운영자 승인 후 trigger)
- 24h 미해결 escalate 정책

## 검증

- vitest 신규 ≥40 케이스
- `npm run lint` (client + server tsc) 0 에러
- `npm run validate:all` 12종 통과
- `ALLOW_DEPLOY_WINDOW=1 npm run precommit` EXIT=0
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경
