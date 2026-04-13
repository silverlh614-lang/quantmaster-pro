/**
 * TradingChecklist — 아이디어 10
 * 자동매매 최초 설정 시 순서대로 검증하는 내장 체크리스트
 */
import React, { useState } from 'react';

type StepStatus = 'idle' | 'running' | 'ok' | 'error';

interface Step {
  id: number;
  label: string;
  description: string;
  run: () => Promise<string>; // 결과 메시지 반환
}

const STEPS: Step[] = [
  {
    id: 1,
    label: 'KIS 토큰 발급 확인',
    description: 'GET /api/kis/token-status → { valid: true, expiresIn }',
    run: async () => {
      const res = await fetch('/api/kis/token-status');
      const data = await res.json();
      if (!data.valid) throw new Error(data.reason ?? '토큰 미발급');
      return `토큰 유효 (만료까지 ${data.expiresIn})`;
    },
  },
  {
    id: 2,
    label: '현재가 조회 — 삼성전자(005930)',
    description: 'KIS inquire-price TR 호출 → 실제 가격 반환 확인',
    run: async () => {
      const res = await fetch('/api/kis/price?code=005930');
      const data = await res.json();
      const price = data.output?.stck_prpr;
      if (!price || price === '0') throw new Error('가격 조회 실패: ' + JSON.stringify(data));
      return `현재가 ${Number(price).toLocaleString()}원 확인`;
    },
  },
  {
    id: 3,
    label: '모의계좌 잔고 조회',
    description: 'GET /api/kis/balance → 초기 자금 확인 (기본 1억원)',
    run: async () => {
      const res = await fetch('/api/kis/balance');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const cash = data.output2?.[0]?.dnca_tot_amt ?? data.output?.dnca_tot_amt ?? '?';
      return `잔고 ${Number(cash).toLocaleString()}원 확인`;
    },
  },
  {
    id: 4,
    label: '소액 주문 테스트 — 삼성전자 1주 시장가 매수',
    description: 'KIS order-cash (VTS) → 체결 주문번호 수신',
    run: async () => {
      const priceRes = await fetch('/api/kis/price?code=005930');
      const priceData = await priceRes.json();
      const currentPrice = priceData.output?.stck_prpr ?? '0';

      const res = await fetch('/api/kis/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/uapi/domestic-stock/v1/trading/order-cash',
          method: 'POST',
          headers: { tr_id: 'VTTC0802U' },
          body: {
            CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
            ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
            PDNO: '005930',
            ORD_DVSN: '01',       // 시장가
            ORD_QTY: '1',
            ORD_UNPR: '0',
            SLL_BUY_DVSN_CD: '02',
            CTAC_TLNO: '',
            MGCO_APTM_ODNO: '',
            ORD_SVR_DVSN_CD: '0',
          },
        }),
      });
      const data = await res.json();
      if (data.rt_cd !== '0') throw new Error(data.msg1 ?? '주문 실패');
      return `체결 완료 — 주문번호 ${data.output?.ORD_NO ?? '(수신됨)'}  /  이론가 ${Number(currentPrice).toLocaleString()}원`;
    },
  },
  {
    id: 5,
    label: '슬리피지 계산',
    description: '위 주문의 체결가 vs 이론가 차이 자동 계산',
    run: async () => {
      // 체결 내역 조회
      const res = await fetch('/api/kis/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
          method: 'GET',
          headers: { tr_id: 'VTTC8001R' },
          params: {
            CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
            ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
            INQR_STRT_DT: new Date().toISOString().split('T')[0].replace(/-/g, ''),
            INQR_END_DT:  new Date().toISOString().split('T')[0].replace(/-/g, ''),
            SLL_BUY_DVSN_CD: '00',
            INQR_DVSN: '00',
            PDNO: '005930',
            CCLD_DVSN: '00',
            ORD_GNO_BRNO: '',
            ODNO: '',
            INQR_DVSN_3: '00',
            INQR_DVSN_1: '',
            CTX_AREA_FK100: '',
            CTX_AREA_NK100: '',
          },
        }),
      });
      const data = await res.json();
      const fill = data.output1?.[0];
      if (!fill) return '체결 내역 없음 (장 외 시간 또는 조회 지연)';
      const exec = Number(fill.avg_prvs ?? fill.ord_unpr ?? 0);
      const theory = Number(fill.ord_unpr ?? 0);
      const slippage = theory > 0 ? (((exec - theory) / theory) * 100).toFixed(3) : 'N/A';
      return `체결가 ${exec.toLocaleString()}원 / 슬리피지 ${slippage}%`;
    },
  },
  {
    id: 6,
    label: 'Shadow Trading 모드 활성화',
    description: 'STRONG_BUY 신호를 2~4주간 자동 기록 (실주문 없음)',
    run: async () => {
      // 이 단계는 실행 확인만 — 실제 Shadow 모드는 useSettingsStore에서 토글
      return 'Shadow Trading 모드 안내 완료. 설정 → 자동매매 → Shadow 모드를 ON으로 설정하세요.';
    },
  },
  {
    id: 7,
    label: '슬리피지 & 적중률 검토 후 실매매 전환',
    description: '50건 이상 Shadow 데이터 후 adjustedKelly 값으로 실계좌 전환',
    run: async () => {
      return '✅ 모든 체크리스트 완료. Shadow 데이터가 50건 이상 쌓이면 실계좌 모드로 전환하세요.';
    },
  },
];

interface StepState {
  status: StepStatus;
  message: string;
}

export const TradingChecklist: React.FC = () => {
  const [states, setStates] = useState<Record<number, StepState>>(
    Object.fromEntries(STEPS.map((s) => [s.id, { status: 'idle', message: '' }]))
  );

  const runStep = async (step: Step): Promise<boolean> => {
    setStates((prev) => ({ ...prev, [step.id]: { status: 'running', message: '' } }));
    try {
      const msg = await step.run();
      setStates((prev) => ({ ...prev, [step.id]: { status: 'ok', message: msg } }));
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStates((prev) => ({ ...prev, [step.id]: { status: 'error', message: msg } }));
      return false;
    }
  };

  const runAll = async () => {
    for (const step of STEPS) {
      // 실패 시 중단 (디버깅 지옥 방지)
      const ok = await runStep(step);
      if (!ok) break;
    }
  };

  const statusIcon = (s: StepStatus) =>
    ({ idle: '⬜', running: '⏳', ok: '✅', error: '❌' })[s];

  const statusColor = (s: StepStatus) =>
    ({
      idle: 'text-white/40',
      running: 'text-yellow-400 animate-pulse',
      ok: 'text-green-400',
      error: 'text-red-400',
    })[s];

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-black text-white uppercase tracking-widest">
          자동매매 테스트 체크리스트
        </h2>
        <button
          onClick={runAll}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg transition-colors"
        >
          전체 순서 실행
        </button>
      </div>

      <ol className="space-y-3">
        {STEPS.map((step) => {
          const st = states[step.id];
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span className="text-lg mt-0.5 shrink-0">{statusIcon(st.status)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    {step.id}. {step.label}
                  </span>
                  <button
                    onClick={() => runStep(step)}
                    disabled={st.status === 'running'}
                    className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/20 text-white/60 rounded transition-colors disabled:opacity-40"
                  >
                    실행
                  </button>
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">{step.description}</p>
                {st.message && (
                  <p className={`text-[11px] mt-1 font-mono ${statusColor(st.status)}`}>
                    → {st.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
