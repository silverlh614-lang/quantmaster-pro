# QuantMaster Pro

## 프로젝트 개요

AI 기반 한국 주식 퀀트 트레이딩 시스템. 27개 조건 + 4단계 Gate 필터를 통과한
종목에만 신호를 출력하며, KIS API로 실제 주문을 집행한다.

핵심 참조 문서:
- 요구사항·도메인: `README.md`
- 모듈 경계: `ARCHITECTURE.md`
- 운영·인시던트: `docs/incident-playbook.md`
- 환경/비밀 분리: `.env.example`
- 품질 게이트: `npm run validate:all`, `npm run precommit`

디렉토리 구조 요지:
- `src/` — 프론트엔드 + 공유 타입·서비스 (Vite + React 19 + Zustand + TanStack Query)
- `server/` — Express 기반 백엔드 (KIS 클라이언트, 트레이딩 엔진, 스크리너, 텔레그램)
- `scripts/` — 자체 검증 파이프라인 (complexity/responsibility/exposure/sds/gemini)
- `docs/` — 인시던트 플레이북, ADR

## 하네스: QuantMaster Harness

**트리거:** 매매 엔진 / 퀀트 필터(Gate 0~3) / 대시보드 / 변곡점 모듈(THS/VDA/FSS/IPS) /
서버 리팩토링 관련 작업 요청 시 `.claude/skills/quantmaster-orchestrator` 스킬을 사용하라.

추가 전용 스킬:
- `.claude/skills/server-refactor-orchestrator` — 1,000줄 이상 서버 파일 분해 전용
- `.claude/skills/incident-responder` — Telegram/로그 인시던트 진단 전용

**단순 질문은 직접 응답 가능.** (예: "이 함수가 뭐야?", "타입 오류 한 줄 수정")
**복잡 작업은 하네스 필수.** (예: "새 Gate 조건 추가", "signalScanner 분해", "webhookHandler 재설계")

## 에이전트 팀 (4인)

| 역할 | 담당 영역 | DoD |
|------|-----------|------|
| `architect` | `ARCHITECTURE.md` 경계 설계, `src/types/`, ADR 작성 | `npm run validate:responsibility` 통과 |
| `engine-dev` | `server/trading/*`, `server/clients/kisClient.ts`, `server/quant*`, `src/services/quant*` | `npm run lint` + 해당 `*.test.ts` 통과 |
| `dashboard-dev` | `src/pages/*`, `src/components/*`, `src/hooks/*`, Zustand 스토어 | `npm run validate:complexity` 통과 |
| `quality-guard` | QA + 보안 + 경계면 교차 비교 | `npm run validate:all` 전체 통과 |

보안/이상감지는 `scripts/scan_exposure.js`, `scripts/silent_degradation_sentinel.js`가 이미
기계 에이전트로 동작 중이므로 AI 에이전트는 조율·해석·수정 위임에 집중한다.

## 절대 규칙

1. **@responsibility 태그 의무**: 모든 새 파일은 상단 20줄 내 25단어 이내 책임 명시
   (`scripts/check_responsibility.js`로 강제).
2. **kisClient 단일 통로**: KIS API 호출은 `server/clients/kisClient.ts` 경유만 허용.
   다른 모듈은 raw KIS REST 호출 금지.
3. **stockService 단일 통로**: 외부 데이터(Yahoo/DART/Gemini/KIS 프록시) 페칭은
   `src/services/stockService.ts`에서만 시작한다.
4. **autoTradeEngine 단일 통로**: `AUTO_TRADE_ENABLED=true` 상태에서 실주문은
   서버 측 `autoTradeEngine`만 집행한다. 클라이언트는 실주문 금지.
5. **ARCHITECTURE.md 경계 준수**: 수정 전 해당 모듈의 Single Responsibility 재확인.
6. **복잡도 한계**: 파일당 1,500줄, 함수당 한계는 `scripts/check_complexity.js` 기준.
   초과 시 즉시 분할.
7. **커밋 전**: `npm run precommit` 필수 통과. 훅 우회(`--no-verify`) 금지.

## 기존 복잡도 위반 (리팩토링 우선순위)

하네스 도입 시점 기준 1,000줄 초과 서버 파일:

| 파일 | 줄 수 | 우선순위 |
|------|------:|----------|
| `server/trading/signalScanner.ts` | 1,820 | P0 — 변동성 최대 지점 |
| `server/telegram/webhookHandler.ts` | 1,700 | P1 |
| `server/screener/stockScreener.ts` | 1,571 | P1 |
| `server/trading/exitEngine.ts` | 1,233 | P2 |

분해 설계는 `docs/adr/` 에 ADR로 선행 기록 후 `server-refactor-orchestrator` 스킬로 진행한다.

## 검증 파이프라인 요약

| 스크립트 | 검사 항목 |
|----------|-----------|
| `npm run validate:gemini` | Gemini 호출 규약 위반 탐지 |
| `npm run validate:complexity` | 파일·함수 복잡도 임계 초과 탐지 |
| `npm run validate:sds` | Silent Degradation(조용한 성능 저하) 패턴 탐지 |
| `npm run validate:exposure` | 비밀·토큰 노출 스캔 |
| `npm run validate:responsibility` | `@responsibility` 태그 존재·길이 검사 |
| `npm run lint` | `tsc --noEmit` (클라 + 서버 tsconfig 각각) |
| `npm run precommit` | 배포창 + 노출(증분) + 복잡도 + 책임(변경분) + Gemini + lint |

## 하네스 사용 워크플로 (요약)

1. 사용자 요청 → 본 문서의 "트리거" 판정
2. 해당 스킬 호출 → `_workspace/{YYYY-MM-DD}_{task}/` 생성
3. `architect` → (`engine-dev` ∥ `dashboard-dev`) → `quality-guard` 순서로 위임
4. 통합 검증(Phase 4): `npm run lint` → `npm run validate:all` → 해당 테스트 → 교차 비교 → `npm run precommit`
5. Phase 5: CLAUDE.md 하단 "변경 이력"에 한 줄 추가 → 의미 있는 커밋 메시지 작성

상세는 `.claude/skills/quantmaster-orchestrator/SKILL.md` 참조.

## 변경 이력

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-04-23 | 하네스 신규 구축 (CLAUDE.md + agents/skills) | `.claude/`, `CLAUDE.md` | AI 조율 레이어 도입 |
