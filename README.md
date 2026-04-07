<div align="center">

# QuantMaster Pro

**AI 기반 한국 주식 퀀트 분석 시스템**

[![Node.js](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple)](https://railway.app)
[![License](https://img.shields.io/badge/License-Private-red)](#)

> **⚠️ 본 시스템은 개인 투자 연구 목적으로 제작되었습니다. AI 분석 결과는 투자 권유가 아니며, 모든 투자의 책임은 본인에게 있습니다.**

</div>

---

## 이 시스템이란

단순한 종목 추천기가 아닙니다.

**27개 투자 조건 + 4단계 Gate 필터 + 12개 글로벌 인텔리전스 레이어**를 통과한 종목에만 신호를 출력합니다. 매매 결과를 기록하고 조건별 실전 승률을 추적하여 시스템 스스로 가중치를 보정하는 **자기진화 구조**를 내장합니다.

```
일반 투자 앱   →  "이 종목 사세요"

QuantMaster   →  "CONFIRMED STRONG BUY
                  합치 4/4 BULLISH · 촉매 A등급 · 사이클 EARLY
                  Kelly 100% · Gate 3 도달 · 역검증 통과
                  분할매수 3단계 플랜: 30% → 30% → 40%"
```

---

## 핵심 구조

### Gate 피라미드 (4단계)

```
Gate 0  거시 환경 생존 게이트
        MHS(거시건강지수) 4축 평가 — 금리·유동성·경기·리스크
        MHS < 40 → 전면 매수 중단 / FSI CRISIS → 전량 현금

Gate 1  생존 필터 (5개 전부 통과 필수)
        주도주 사이클 / ROE 유형3 / Risk-On 환경
        기계적 손절 설정 / 신규 주도주 여부

Gate 2  성장 검증 (12개 중 9개 이상)
        수급 질 / 일목균형표 / 기관·외인 수급 / 거래량
        목표가 여력 / 실적 서프라이즈 / 정책·매크로 등

Gate 3  정밀 타이밍 (10개 중 7개 이상)
        VCP 패턴 / 다이버전스 / 마진 가속도
        터틀 돌파 / 피보나치 / 촉매제 등
```

### 신호 계층 (5단계)

| 등급 | 조건 | Kelly | 포지션 |
|------|------|-------|--------|
| **CONFIRMED STRONG BUY** | 7개 고도화 조건 전부 | 100% | 풀 포지션 · 자동매매 허용 |
| **STRONG BUY** | Gate 1~3 + RRR≥3.0 | 70% | 수동 교차검증 후 진입 |
| **BUY** | Gate 1~3 + RRR≥2.0 | 50% | 분할 매수 |
| **WATCH** | Gate 1~2 통과 | 0% | 관심 등록 · 진입 대기 |
| **HOLD** | Gate 1 미달 | 0% | 포지션 없음 |

---

## 판단엔진 고도화 — 7개 함수

STRONG BUY를 CONFIRMED STRONG BUY로 격상하기 위한 추가 검증 레이어입니다.

| 함수 | 역할 |
|------|------|
| `computeConfluence()` | 기술·수급·펀더멘털·매크로 4축 동시 BULLISH 확인 |
| `classifyCyclePosition()` | EARLY / MID / LATE 사이클 위치 분류 |
| `gradeCatalyst()` | 촉매 A(구조적) / B(사이클) / C(단기) 등급화 |
| `analyzeMomentumAcceleration()` | 주봉 RSI 3주 추이 + 기관 순매수 가속도 |
| `evaluateEnemyChecklist()` | 보호예수·공매도·최대주주 매도 등 역검증 7항목 |
| `computeDataReliability()` | 실계산 vs AI추정 비율 추적 → 신뢰도 하향 자동 적용 |
| `computeSignalVerdict()` | 7조건 종합 최종 판정 |

---

## 글로벌 인텔리전스 — 12개 레이어

한국 증시에 영향을 주는 글로벌 선행지표를 실시간 수집합니다.

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

## 자기진화 루프

```
매매 실행 → TradeRecord 저장
         ↓
    27조건별 승률 집계
    (수익 종목에서 높았던 조건 → 가중치 상향)
    (손실 종목에서 높았던 조건 → 가중치 하향)
         ↓
    10건 이상 누적 시 evaluationWeight 자동 재보정
         ↓
    evaluateStock() 다음 호출부터 반영
         ↓
    시스템이 참뮌님의 실전 데이터로 진화
```

매매 결과가 쌓일수록 시스템의 27개 조건 가중치가 실전 데이터 기반으로 자동 보정됩니다.

---

## 데이터 파이프라인

| 소스 | 항목 | 신뢰도 |
|------|------|--------|
| Yahoo Finance | 현재가·OHLCV·기술지표 9개 | ✅ 실계산 |
| DART 전자공시 | ROE·OCF·이자보상배율·부채비율 | ✅ 실계산 |
| KIS 한국투자증권 | 외국인·기관 수급·공매도·주봉RSI | ✅ 실계산 |
| Google Gemini AI | 정성 분석·섹터 판단·촉매 평가 | ⚠️ AI 추정 |

**27개 조건 중 실데이터 기반 실계산 비율: 약 48%**

---

## 주요 기능

- **9개 분석 탭** — DISCOVER / WATCHLIST / SCREENER / BACKTEST / MARKET / WALK_FORWARD / SUBSCRIPTION / MANUAL_INPUT / TRADE_JOURNAL
- **캔들차트** — lightweight-charts 기반, Gate 신호 마킹 포함
- **MHS 히스토리 차트** — 365일 거시건강지수 추이
- **글로벌 인텔 레이더** — 12개 레이어 Recharts 레이더 차트
- **매매일지** — TradeRecord 기록·조건 성과 분석·시스템 vs 직관 대결
- **PDF 리포트** — jsPDF + modern-screenshot 자동 생성
- **이메일 발송** — Gmail SMTP 연동
- **API 레이트 리미터** — Gemini 무료 티어 RPM 보호 (2초 간격)
- **Zustand 상태관리** — 7개 스토어 도메인 분리
- **Railway 배포** — 24시간 클라우드 실행

---

## 아키텍처

```
src/
  App.tsx                   메인 애플리케이션
  services/
    quantEngine.ts          퀀트 판단엔진 (Gate 0~3 + 고도화 7함수)
    stockService.ts         데이터 수집 (Yahoo·DART·KIS·Gemini)
  stores/                   Zustand 상태관리 (7개 스토어)
    useSettingsStore.ts
    useGlobalIntelStore.ts
    useRecommendationStore.ts
    useMarketStore.ts
    useAnalysisStore.ts
    usePortfolioStore.ts
    useTradeStore.ts
  hooks/
    useGlobalIntelQueries.ts  TanStack Query 글로벌 인텔 훅
  components/               25개 컴포넌트
  types/quant.ts            TypeScript 타입 정의
  utils/indicators.ts       기술지표 실계산 엔진
server.ts                   Express 서버 (API 프록시)
railway.json                Railway 배포 설정
```

---

## 시작하기

### 환경변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다.

```env
# 필수
GEMINI_API_KEY=AIza...

# 선택 (기능 확장)
DART_API_KEY=...
KIS_APP_KEY=...
KIS_APP_SECRET=...
KIS_ACCOUNT_NO=...
KIS_IS_REAL=false        # false=모의투자, true=실거래
EMAIL_USER=gmail주소
EMAIL_PASS=앱비밀번호
```

Gemini API 키만 있어도 기본 기능이 동작합니다. 앱 내 설정에서 직접 입력도 가능합니다.

### 로컬 실행

```bash
npm install
npm run dev
# http://localhost:3000 접속
```

### Railway 배포

```bash
# GitHub push → Railway 자동 배포
# railway.json에 빌드·시작 명령어 포함
```

---

## 완성도 현황

| 영역 | 완성도 | 비고 |
|------|--------|------|
| 투자 철학·알고리즘 | 95% | 27조건·Gate·Kelly·역발상 |
| 판단엔진 고도화 | 99% | 7개 함수 실데이터 연동 완료 |
| 글로벌 인텔리전스 | 97% | 12레이어 A~L 완전 구현 |
| 시각화 | 93% | 캔들·레이더·MHS·매매일지 |
| 아키텍처 | 95% | Zustand 7스토어·TanStack Query |
| 자기진화 루프 | 90% | 구조 완성, 실전 데이터 누적 필요 |
| 데이터 신뢰성 | 55% | AI 추정 항목 교차검증 필요 |
| 자동매매 | 0% | 추후 KIS 주문 API 연결 예정 |

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend | React 19 · TypeScript 5 · Vite · Tailwind v4 |
| 상태관리 | Zustand 5 · TanStack Query 5 |
| 차트 | Recharts · lightweight-charts |
| AI | Google Gemini 3 Flash (gemini-3-flash-preview) |
| Backend | Express · tsx |
| 배포 | Railway (24시간 클라우드) |
| 데이터 | Yahoo Finance · DART OpenAPI · KIS Developers API |

---

## 주의사항

- 본 시스템은 개인 투자 연구 목적으로 제작되었습니다
- AI 분석 결과는 추정값이며 정확성을 보장하지 않습니다
- 중요 수치(PER·ROE·이자보상배율 등)는 DART에서 직접 교차검증을 권장합니다
- 투자로 인한 손실에 대해 어떠한 책임도 지지 않습니다
- KIS API 실거래 연동은 한국투자증권 계좌가 필요합니다

---

<div align="center">

**"판단의 틀은 기관급, 판단의 재료는 지속적으로 고도화 중"**

*v13 · 2026.04*

</div>
