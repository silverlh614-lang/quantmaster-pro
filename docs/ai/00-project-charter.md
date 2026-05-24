# 00 · Project Charter (정체성·9대 불변식·데이터 신뢰 등급)

> **Read this file only when working on:** 프로젝트 정체성을 이해해야 할 때,
> 9대 불변식의 의미·배경을 확인할 때, 데이터 신뢰 등급(L1~L4) 철학을 적용할 때,
> 또는 신규 ADR/패치가 핵심 원칙을 위반하는지 판정할 때.

---

## 프로젝트 정체성

QuantMaster Pro 는 AI 기반 한국 주식 퀀트 트레이딩 시스템이다.
**27개 조건 + 4단계 Gate(0/1/2/3) 필터**를 통과한 종목에만 신호를 출력하며,
KIS(한국투자증권) API 로 실제 주문을 집행한다.

- `src/` — 프론트엔드 + 공유 타입·서비스 (Vite + React 19 + Zustand + TanStack Query)
- `server/` — Express 백엔드 (KIS 클라이언트, 트레이딩 엔진, 스크리너, 텔레그램)
- `scripts/` — 자체 검증 파이프라인 (complexity/responsibility/exposure/sds/gemini)
- `docs/` — 인시던트 플레이북, ADR

핵심 참조:
- 요구사항·도메인 → `README.md`
- 모듈 경계 → `ARCHITECTURE.md`
- 운영·인시던트 → `docs/incident-playbook.md`
- 환경/비밀 분리 → `.env.example`
- AI 협업 전체 지침 → `CLAUDE_patch_section.md`

---

## 9대 불변식 (VERBATIM — 절대 삭제·변경 금지)

이 9개는 시스템의 헌법이다. 어떤 ADR·패치도 이를 위반할 수 없다.

1. **Trading Engine은 항상 살아 있어야 한다.**
2. **Shadow Learning은 어떤 상황에서도 멈추면 안 된다.**
3. **모든 판단은 단일 SourceSnapshot에서 출발한다.**
4. **R6, SELL_ONLY, HOLIDAY, 장전/장후, providerIssue는 SourceSnapshot을 바꾸지 않는다.**
5. **위 상태들은 Policy, Confidence, ExecutionPermission, LearningLabel만 바꾼다.**
6. **Provider 장애는 market signal이 아니다.**
7. **AI_ESTIMATED 데이터는 live execution에 사용하면 안 된다.**
8. **실거래 차단과 Shadow 판단 차단은 분리한다.**
9. **SourceSnapshot을 우회하여 Gate 내부에서 provider를 직접 조회하지 않는다.**

### 불변식 의미 (적용 가이드)

- **#1·#2 (Always-On):** 보조 데이터(섹터에너지·수급·진단)가 결손/오류여도
  매매 엔진과 Shadow Learning 은 멈추지 않는다. 보조 신호는 hard-block 할 수 없고,
  score 0 / STRONG_BUY 제한 / 운영자 warning 까지만 가능하다 (ADR-0448).
- **#3 (SourceSnapshot SSOT):** 가격·거래량·캔들·수급·매크로 등 모든 입력은
  단일 SourceSnapshot 에서 출발한다. 호출자가 provider 를 개별 조회하면 drift 발생.
  상세 → `docs/ai/03-source-snapshot-ssot.md`
- **#4·#5 (상태 ≠ 데이터):** R6_DEFENSE / SELL_ONLY / 휴장 / 장전·장후 / providerIssue 는
  *데이터를 바꾸지 않고* Policy·Confidence·ExecutionPermission·LearningLabel 만 바꾼다.
  데이터 자체(가격·수급)는 동일하게 유지된다.
- **#6 (provider 장애 ≠ 약세):** KIS 500 / KRX 빈 응답 / Yahoo stale 은 provider issue 이지
  bearish market signal 이 아니다. confidence downgrade·fallback·circuit breaker·
  Shadow case recording 으로 처리한다 (Patch KIS500 provider health isolation).
- **#7 (AI_ESTIMATED ≠ live):** L4 등급 데이터는 참조 전용. 직접 매매 결정 금지.
- **#8 (실거래 차단 ≠ Shadow 차단):** SELL_ONLY / R6 / 비상정지가 실거래를 막아도
  Shadow Learning 표본 수집은 계속한다. 차단된 날도 학습은 살아있다 (ADR-0173).
- **#9 (Gate 내부 provider 우회 금지):** Gate 평가는 SourceSnapshot 입력만 사용.
  Gate 내부에서 KIS/KRX/Yahoo 를 직접 fetch 하면 #3 위반.

---

## 데이터 신뢰 등급 (L1~L4)

| 등급 | 출처 | 용도 |
|------|------|------|
| **L1** | KIS·KRX 공식 | 매수·매도 결정 (live execution) |
| **L2** | FRED·ECOS·DART | Gate 통과 판정 입력 |
| **L3** | Yahoo·Naver | fallback (L1/L2 결손 시 보조) |
| **L4** | AI 추정 | 참조 전용 — **직접 매매 결정 금지** (불변식 #7) |

- L4 (AI_ESTIMATED) 는 어떤 경로에서도 live execution 입력으로 사용 불가.
- L3 fallback 은 stale/sanity 검증 통과 후에만 사용 (ADR-0028 safePctChange, ADR-0190 KRX calendar).
- provider 결손 시 등급 강등은 데이터 품질 문제로 분류 — market signal 변환 금지 (불변식 #6).

상세 provider 정책 → `docs/ai/05-provider-policy.md`
