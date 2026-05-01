<!--
QuantMaster Pro PR 자가 review 체크리스트 (사용자 4-항목 거버넌스 추천 #4)
ADR-0146 (10-PR audit 룰) + 단일 인력 리스크 완화.
LIVE 매매 회귀 위험 격리를 위해 모든 PR 이 본 체크리스트 답변 의무.
-->

## Summary

<!-- PR 의도 / 사용자 요청 인용 / 도메인 (trading / learning / ui / infra / governance) -->

## Changes

<!-- 주요 변경 파일 + 신규/수정/삭제 분류 -->

## 자가 review 체크리스트

### 🛑 LIVE 매매 영향

- [ ] LIVE 매매 본체 (`server/trading/exitEngine` / `server/clients/kisClient` / `server/orchestrator/tradingOrchestrator` / `server/trading/autoTradeEngine` / `server/trading/signalScanner`) 변경 *없음* / 또는 변경 시 회귀 격리 명시.
- [ ] KIS/KRX 자동매매 quota 침범 *0건* (절대 규칙 #2 kisClient 단일 통로 / #4 autoTradeEngine 단일 통로).
- [ ] AUTO_TRADE_ENABLED + getEmergencyStop() 가드 모든 진입점 적용 (cron / 텔레그램 / HTTP).
- [ ] 변경 시 ENV 롤백 스위치 (`<DOMAIN>_DISABLED=true`) 도입 — 즉시 복원 가능.

### 🧪 회귀 테스트

- [ ] 신규 회귀 케이스 추가 ≥1건 / 또는 *문서/설정만* PR 으로 면제 사유 명시.
- [ ] vitest 영향 영역 무회귀 (변경 모듈 + 인접 모듈).
- [ ] 정적 grep 가드 (regex / drift 차단) 추가 시 문서화.

### 🔌 wiring 완료 vs 인프라만

- [ ] 본 PR 이 *영속 schema + SSOT 함수만 신설* + 호출자 wiring 부재인 경우, `_workspace/PENDING_WIRING.md` 등재 (ADR + 차단 사유 + 우선순위 P0/P1/P2/P3).
- [ ] 본 PR 이 *인프라 + wiring 통합* 인 경우, PENDING_WIRING 잔여 항목 갱신 또는 제거.
- [ ] *영원히 dead code 로 남는* 의도된 SSOT (helper / 백테스트 전용) 는 `DECIDED_NOT_WIRING` 명시.

### 📜 ADR 발급

- [ ] 새 ADR 작성 시 `docs/adr/INDEX.md` §"다음 발급" 번호 사용 (충돌 0건).
- [ ] PR 머지 후 INDEX.md §"전체 인덱스" 한 줄 추가 의무.
- [ ] 기존 ADR 번호 변경 *없음* (git diff·외부 참조 무결성 보호).

### ✅ 검증

- [ ] `npm run lint` EXIT=0 (client + server tsc).
- [ ] `npm run validate:all` 13종 모두 OK (Gemini / ACMA / SDS / PRES / Responsibility / SymbolBoundary / ChannelBoundary / SensitiveAlerts / MarketOverviewBoundary / YahooRange / UILanguage / DataTrust / SilentDegradation).
- [ ] `ALLOW_DEPLOY_WINDOW=1 npm run precommit` 본체 EXIT=0.
- [ ] `git merge-tree` 충돌 검사 통과 (또는 충돌 해소 명시).

### 📅 거버넌스 (10-PR audit 룰, ADR-0146)

- [ ] 본 PR 이 N0 boundary (PR-100/110/120/...) 에 *근접* 한 경우, 직전 10 PR audit-only PR 트리거 일정 인지.
- [ ] CLAUDE.md "변경 이력" 한 줄 추가 (PR 의도 + 도메인 + 검증 + KIS/LIVE 영향).

## Test plan

- [ ] (수동 / 자동 테스트 항목)

<!--
참고:
- 이슈 자동 해결: "Fixes #N" / "Closes #N" 명시
- Stack PR: base = 의존 PR 의 브랜치 (PR 머지 시 자동 main 으로 변경)
- 머지 시점: validate:all + precommit + 회귀 테스트 모두 PASS 확인 후

자동매매 LIVE 영향 큰 PR 은 SHADOW 모드 1주 검증 후 LIVE 활성화 권장.
-->
