<div align="center">

# QuantMaster Pro

**규칙 기반 한국 주식 퀀트 의사결정 시스템**
*(통계 학습 보조 · 운영자 인더루프 · LLM 정성분석 보조)*

[![Node.js](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple)](https://railway.app)
[![License](https://img.shields.io/badge/License-Private-red)](#)

> **⚠️ 본 시스템은 개인 투자 연구 목적으로 제작되었습니다. 분석 결과는 투자 권유가 아니며, 모든 투자의 책임은 본인에게 있습니다.**

</div>

---

## 이 시스템이란

종목 추천기가 아니라, **명시적 규칙으로 매수/매도를 판정하고 그 판단 근거를 전부 설명할 수 있는** 트레이딩 의사결정 엔진입니다.

**27항목 투자 체크리스트 → 4단계 Gate 필터 → 12개 글로벌 인텔리전스 레이어**를 통과한 종목에만 신호를 출력하며, 통과하지 못한 종목은 **왜 막혔는지(blockerReason)** 까지 기록합니다. 모든 판단은 단일 `SourceSnapshot` 에서 출발하고, 실주문은 서버 측 `autoTradeEngine` 단일 통로로만 집행됩니다.

```
일반 투자 앱   →  "이 종목 사세요"

QuantMaster   →  "CONFIRMED STRONG BUY
                  합치 4/4 BULLISH · 촉매 A등급 · 사이클 EARLY
                  Kelly 100% · Gate 3 도달 · 역검증 통과
                  분할매수 3단계 플랜: 30% → 30% → 40%"
                  (또는: "WAIT — Gate2 차단, 수급질 미달 / 데이터 STALE")
```

> **설계 철학:** 돈을 다루는 시스템에서 "왜 그 주문을 냈는지 설명 못 하는 똑똑한 블랙박스"는 위험합니다. 이 프로젝트는 의도적으로 **설명 가능성·재현성·안전 차단막**을 지능의 화려함보다 우선합니다. 임계값은 디버깅 가능하고, 학습 결과는 운영자가 검수하며, ML 블랙박스에 실거래를 맡기지 않습니다.

---

## 이 시스템이 맞는 것 / 아닌 것

정직하게 적습니다.

| ✅ 맞는 것 | ❌ 아닌 것 (흔한 오해) |
|-----------|----------------------|
| 다중 신호(기술·수급·펀더·매크로) 조합 규칙 엔진 | 자율 학습 AI / 신경망 기반 매매 |
| 통계 분석(ROC·Youden's J) 기반 임계값 **권고** | 파라미터를 스스로 바꾸는 자기진화 (현재 `autoApply: false`) |
| Counterfactual·Shadow 시뮬레이션으로 Gate 유효성 검증 | 강화학습/온라인러닝 실시간 적응 |
| 외부 LLM(Gemini)을 **정성 분석 보조**로 활용 | LLM이 매매를 직접 결정 (L4 데이터는 실거래 금지) |
| 명확한 단일 통로·데이터 신뢰 등급·9대 불변식 | 천재적 알파 생성기 |

**한 줄 요약:** 천재적이지 않지만, 트레이딩에서 천재성보다 중요한 **규율·재현성·안전장치**를 갖춘 시스템입니다.

---

## 핵심 구조

### Gate 피라미드 (4단계)

```
Gate 0  거시 환경 생존 게이트
        MHS(거시건강지수) 4축 평가 — 금리·유동성·경기·리스크
        MHS < 40 → 전면 매수 중단 / FSI CRISIS → 전량 현금

Gate 1  생존 필터 (핵심 조건 통과 필수)
        주도주 사이클 / ROE 유형 / Risk-On 환경
        기계적 손절 설정 / 신규 주도주 여부

Gate 2  성장 검증 (합치 점수 임계 통과)
        수급 질 / 일목균형표 / 기관·외인 수급 / 거래량
        목표가 여력 / 실적 서프라이즈 / 정책·매크로 등

Gate 3  정밀 타이밍 (정밀 조건 임계 통과)
        VCP 패턴 / 다이버전스 / 마진 가속도
        터틀 돌파 / 피보나치 / 촉매제 등
```

> Gate 임계값과 조건별 가중치는 현재 **정적 상수**입니다. 학습 루프는 이 임계값을 **자동으로 바꾸지 않고**, 통계적으로 더 나은 값을 *권고*만 합니다(아래 「학습 루프」 참조).

### 신호 계층 (5단계)

| 등급 | 조건 | Kelly | 포지션 |
|------|------|-------|--------|
| **CONFIRMED STRONG BUY** | 7개 고도화 조건 전부 | 100% | 풀 포지션 · 자동매매 허용 |
| **STRONG BUY** | Gate 1~3 + RRR≥3.0 | 70% | 수동 교차검증 후 진입 |
| **BUY** | Gate 1~3 + RRR≥2.0 | 50% | 분할 매수 |
| **WATCH** | Gate 1~2 통과 | 0% | 관심 등록 · 진입 대기 |
| **HOLD / WAIT** | Gate 미달 또는 데이터 차단 | 0% | 포지션 없음 (차단 사유 기록) |

---

## 27항목 체크리스트 — 자동 vs 정성

투자 철학은 **27항목 마스터 체크리스트**(`src/types/core.ts` ConditionId SSOT)로 구성됩니다. 이 중:

- **18개**는 자동 평가 레지스트리(`server/quant/conditions/`)로 **기계적으로 계산**됩니다.
  `momentum · maAlignment · volumeBreakout · per · turtleHigh · relativeStrength · breakoutMomentum · vcp · volumeSurge · rsiZone · macdBull · pullback · ma60Rising · weeklyRsiZone · supplyConfluence · earningsQuality · trendAcceleration · lastTrigger`
- **나머지**는 정성 판단·AI 추정·수동 입력 영역으로, 신뢰 등급이 낮아(L4) **실거래 결정에 직접 사용되지 않습니다.**

각 조건 평가기는 레지스트리 패턴(개방-폐쇄 원칙)으로 격리되어 있어 조건 추가/교체가 본체 변경 없이 가능합니다.

---

## 판단엔진 고도화 — 7개 함수

STRONG BUY를 CONFIRMED STRONG BUY로 격상하기 위한 추가 검증 레이어입니다.

| 함수 | 역할 |
|------|------|
| `computeConfluence()` | 기술·수급·펀더멘털·매크로 4축 동시 BULLISH 확인 |
| `classifyCyclePosition()` | EARLY / MID / LATE 사이클 위치 분류 |
| `gradeCatalyst()` | 촉매 A(구조적) / B(사이클) / C(단기) 등급화 |
| `analyzeMomentumAcceleration()` | 주봉 RSI 3주 추이 + 기관 순매수 가속도 |
| `evaluateEnemyChecklist()` | 보호예수·공매도·최대주주 매도 등 역검증 |
| `computeDataReliability()` | 실계산 vs AI추정 비율 추적 → 신뢰도 하향 자동 적용 |
| `computeSignalVerdict()` | 7조건 종합 최종 판정 |

---

## 글로벌 인텔리전스 — 12개 레이어

한국 증시에 영향을 주는 글로벌 선행지표를 수집해 Gate 판단에 반영합니다.

| 레이어 | 내용 | 한국 증시 연결 |
|--------|------|--------------|
| A | MHS 거시건강지수 (금리·유동성·경기·리스크) | Gate 0 직결 |
| B | Smart Money ETF 흐름 (EWY·MTUM·EEMV) | 외국인 수급 2~4주 선행 |
| C | 수출 모멘텀 (반도체·조선·방산·원자력 YoY) | 섹터 로테이션 |
| D | 지정학 리스크 GOS | 방산·조선 Gate 완화 |
| E | 크레딧 스프레드 (AA- OAS) | 금융시스템 조기경보 |
| F | 글로벌 상관관계 (KOSPI-S&P500 등) | 디커플링·동조화 감지 |
| G | 섹터-테마 역추적 엔진 | 글로벌 메가트렌드→숨은 수혜주 |
| H | 뉴스 빈도 역지표 (SILENT→OVERHYPED) | 사이클 위치 측정 |
| I | 공급망 물동량 (BDI·SEMI B/B·GCFI) | 조선·반도체 Gate 완화 |
| J | 섹터별 글로벌 수주 (방산예산·LNG·SMR) | 조방원 사이클 검증 |
| K | 금융시스템 스트레스 FSI (TED·HY·MOVE) | Gate 0 FULL_STOP 연동 |
| L | FOMC 감성 분석 (매파/비둘기 스코어) | 금리 방향성 정밀화 |

---

## 학습 루프 — 권고 기반 (자동 적용 아님)

> **중요:** 이 시스템의 학습은 "스스로 진화"가 아니라 **"통계 분석 → 권고 → 운영자 검수 → 수동 적용"** 구조입니다. 코드 전반에서 `autoApply: false`, `autoApplyAllowed: false` 가 강제됩니다(`server/learning/`).

```
매매/스캔 실행 → TradeRecord + SourceSnapshot 저장
         ↓
    조건별·Gate별 실전 성과 집계
         ↓
    Counterfactual / Shadow 시뮬레이션
    (탈락 종목이 실제로 올랐는지 추적 — 생존편향 제거)
         ↓
    ROC / Youden's J 분석으로 더 나은 임계값 산출
         ↓
    ⚠️ 자동 적용 차단 (autoApply: false)
       → 운영자에게 "권고"로 보고 (텔레그램/대시보드)
         ↓
    운영자 검수 → ENV/설정으로 수동 적용
```

- 표본 임계(예: 70개 이상) 미달 시 `DO_NOT_UPDATE_WEIGHT` 로 가중치 변경 자체를 보류합니다.
- Gemini LLM은 주간 회고(reflection)에서 **정성적 권고**를 생성할 뿐, 파라미터를 직접 바꾸지 않습니다.
- 즉, 실제 개선 주기의 마지막 단계는 **사람**입니다 (의도된 설계).

---

## 데이터 파이프라인 — 신뢰 등급 (L1~L4)

| 등급 | 소스 | 용도 |
|------|------|------|
| **L1** | **KIS 한국투자증권 · KRX** | 매수·매도 결정 (현재가·OHLCV·수급·공매도·주봉RSI) |
| **L2** | FRED · ECOS · DART | Gate 거시·펀더멘털 (ROE·OCF·이자보상배율·부채비율) |
| **L3** | Yahoo · Naver | KIS로 대체 불가능할 때만 **최후 fallback** |
| **L4** | Google Gemini (AI 추정) | 정성 분석·섹터·촉매 — **참조 전용, 실거래 결정 금지** |

> **KIS Primary Absolute (ADR-0561):** KIS(L1)가 공급 가능한 레이어에서는 Yahoo(L3)를 primary 로 쓰지 않습니다. Yahoo는 KIS 회로차단기 open + KRX 불가 등 **대체 불가 상황에서만** 차용합니다. (실행경로 Yahoo burn-down 완료 — ADR-0563)

---

## 주요 기능

- **분석 페이지** — DISCOVER/WATCHLIST · SCREENER · BACKTEST · MARKET · MACRO INTELLIGENCE · AUTO TRADE · SHADOW LEARNING · LEARNING/SANITY · TRADE JOURNAL · SUBSCRIPTION · MANUAL INPUT · PORTFOLIO EXTRACT · PUBLIC REPORT · RECOMMENDATION HISTORY
- **캔들차트** — lightweight-charts 기반, Gate 신호 마킹 포함
- **MHS 히스토리 차트** — 365일 거시건강지수 추이
- **글로벌 인텔 레이더** — 12개 레이어 Recharts 레이더 차트
- **매매일지** — TradeRecord 기록·조건 성과 분석·시스템 vs 직관 대결
- **PDF 리포트 / 이메일** — jsPDF + modern-screenshot 자동 생성, Gmail SMTP 발송
- **텔레그램 4채널 운영** — 신호/매크로/주간리포트 라우팅 + 30+ 운영자 진단 명령
- **자동매매** — KIS 단일 통로 · FOMC DAY 자동 청산 · Sanity Gate · Holiday Policy
- **Zustand 상태관리** — 도메인별 스토어 분리 · TanStack Query 서버 상태

---

## 아키텍처

```
src/                          프론트엔드 + 공유 타입·서비스 (Vite · React 19)
  pages/                      분석 페이지 (Auto Trade · Screener · Shadow Learning 등)
  components/ · ui/ · layout/ 시각화 · UI
  hooks/                      TanStack Query 훅
  stores/                     Zustand 상태관리
  services/                   stockService (외부 데이터 단일 통로) · quant*
  types/                      TypeScript 도메인 타입 (core.ts = ConditionId SSOT)
  utils/                      기술지표 실계산

server/                       백엔드 (Express · tsx)
  clients/kisClient/          KIS API 단일 통로 (raw REST 금지)
  quant/                      Gate 0~3 + 조건 평가기 레지스트리
  trading/                    signalScanner · autoTradeEngine · exitEngine
  screener/                   종목 스크리너
  learning/ · shadow/         학습 루프 (권고) · Counterfactual · Walk-Forward
  market/ · sector/ · supply/ 매크로 · 섹터 · 수급
  telegram/                   4채널 봇 · 명령 레지스트리
  providers/ · dataQuality/   provider 정책 · 회로차단기 · 교차검증
  services/aiUniverseService  AI 추천 유니버스 발굴 단일 통로

docs/                         ADR · 인시던트 플레이북 · ai/ 실행규칙 SSOT
scripts/                      자체 검증 (complexity · responsibility · exposure · sds)
```

> 단일 통로 규칙: KIS 호출은 `kisClient` 만, 외부 데이터는 `stockService`/`aiUniverseService` 만, 실주문은 `autoTradeEngine` 만 경유합니다. 파일당 1,500줄 복잡도 한계가 정적으로 강제됩니다.

---

## 시작하기

### 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다 (`.env.example` 참조).

```env
# 선택 (정성 분석 보조)
GEMINI_API_KEY=AIza...

# L1/L2 실데이터 (실거래·Gate에 권장)
KIS_APP_KEY=...
KIS_APP_SECRET=...
KIS_ACCOUNT_NO=...
KIS_IS_REAL=false        # false=모의투자, true=실거래
DART_API_KEY=...

# 자동매매 (기본 비활성)
AUTO_TRADE_ENABLED=false

# 알림·리포트 (선택)
TELEGRAM_BOT_TOKEN=...
EMAIL_USER=gmail주소
EMAIL_PASS=앱비밀번호
```

### 로컬 실행

```bash
npm install
npm run dev
# http://localhost:3000 접속
```

### 검증 · 배포

```bash
npm run validate:all      # complexity · responsibility · exposure · sds 정적 가드
npm run precommit         # 커밋 전 필수 (훅 우회 금지)
# GitHub push → Railway 자동 배포 (railway.json)
```

---

## 완성도 현황

| 영역 | 완성도 | 비고 |
|------|--------|------|
| 투자 철학·규칙 엔진 | 96% | 27항목 체크리스트 · Gate 0~3 · Kelly · 역검증 |
| 판단엔진 고도화 | 99% | 7개 함수 실데이터 연동 완료 |
| 글로벌 인텔리전스 | 97% | 12레이어 A~L 구현 |
| 시각화 | 95% | Verbosity 토글 · V-E-R Card · Survival Gauge |
| 아키텍처 | 96% | Data Trust Layer · 단일 통로 · 대형 파일 분해 |
| 학습 루프 (권고형) | 93% | Walk-Forward · Counterfactual · Drift — **자동 적용은 차단** |
| 데이터 신뢰성 | 88% | L1~L4 등급 · 교차검증 · Sanity Trade-Block |
| 자동매매 | 75% | KIS 단일 통로 · FOMC 청산 · Holiday · Sanity Gate |

> 완성도는 **구현 범위** 기준입니다. "지능 수준"은 별개 축으로, 본 시스템은 ML 자동 적응이 아닌 **규칙+통계+운영자 검수** 구조임을 명시합니다(「맞는 것/아닌 것」 참조).

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend | React 19 · TypeScript 5 · Vite · Tailwind v4 |
| 상태관리 | Zustand 5 · TanStack Query 5 |
| 차트 | Recharts · lightweight-charts |
| AI (정성 보조) | Google Gemini (gemini-2.5-flash · gemini-3-flash-preview) |
| Backend | Express · tsx |
| 배포 | Railway (24시간 클라우드) |
| 데이터 | KIS Developers API · KRX · DART OpenAPI · FRED · ECOS · (Yahoo/Naver fallback) |

---

## 거버넌스 · 문서

- **`CLAUDE.md`** — AI 실행 규칙 SSOT (9대 불변식 · 7대 단일 통로 · 데이터 신뢰 등급)
- **`ARCHITECTURE.md`** — 모듈 경계 · 단일 책임
- **`docs/ai/00`~`10`** — 도메인별 상세 규칙 (Gate · SourceSnapshot · Provider · Telegram · Learning)
- **`docs/adr/`** — Architecture Decision Record (ADR 0001~0586 발급 · 393건 보존, INDEX.md 가 발급 SSOT)
- **`docs/incident-playbook.md`** — 운영·인시던트 대응

---

## 주의사항

- 본 시스템은 개인 투자 연구 목적으로 제작되었습니다.
- AI(L4) 분석 결과는 추정값이며 실거래 결정에 직접 사용하지 않습니다.
- 중요 수치(PER·ROE·이자보상배율 등)는 DART에서 직접 교차검증을 권장합니다.
- 투자로 인한 손실에 대해 어떠한 책임도 지지 않습니다.
- KIS API 실거래 연동은 한국투자증권 계좌가 필요하며, 기본값은 모의투자(`KIS_IS_REAL=false`)입니다.

---

<div align="center">

**"판단의 틀은 기관급, 판단의 재료는 지속적으로 고도화 중 — 단, 결정의 책임은 사람에게."**

*ADR 0001~0586 누적 · 규칙 기반 + 통계 학습 보조 + 운영자 인더루프*

</div>
