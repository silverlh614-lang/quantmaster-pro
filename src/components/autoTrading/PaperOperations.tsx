// @responsibility Present workspace operational settings.
import React, { lazy, Suspense, useState } from 'react';
import type { EngineStatus } from '../../api/autoTradeClient';
import type { PaperOverviewView } from '../../types/paperExperiment';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { THEME_OPTIONS } from '../../config/themes';
import { paperTime } from './PaperOverview';

const Execution = lazy(() => import('../../pages/AutoTradePage').then(module => ({ default: module.AutoTradePage })));

export function PaperOperations({ engine, paused, view }: { engine?: EngineStatus; paused?: boolean; view?: PaperOverviewView }) {
  const [showExecution, setShowExecution] = useState(false);
  const theme = useSettingsStore(state => state.theme);
  const setTheme = useSettingsStore(state => state.setTheme);
  const fontSize = useSettingsStore(state => state.fontSize);
  const setFontSize = useSettingsStore(state => state.setFontSize);
  return <>
    <section className="workspace-card"><div className="workspace-card-heading"><h2>서버 운영 상태</h2><span className="workspace-eyebrow">서버 기준</span></div>
      <dl className="workspace-definition-list">
        <div><dt>실행 모드</dt><dd>{engine?.mode ?? '확인 불가'}</dd></div>
        <div><dt>자동 관측</dt><dd>{!engine?.mode || paused === undefined ? '확인 불가' : engine.mode !== 'SHADOW' ? 'Shadow 모드 아님' : paused ? '일시정지' : '매분 실행 예약'}</dd></div>
        <div><dt>마지막 관측 완료</dt><dd>{paperTime(view?.lastRun?.asOf)}</dd></div>
        <div><dt>과거 자료 연구</dt><dd>Shadow 스캔 시 시간당 갱신 · 연구 화면에서 수동 실행</dd></div>
      </dl>
      <p className="workspace-note">화면을 닫아도 서버의 관측·학습은 계속됩니다. 화면용 조회는 브라우저를 보고 있을 때만 갱신합니다.</p>
      {engine?.mode && engine.mode !== 'SHADOW' && <div className="mt-4"><button type="button" className="workspace-button" onClick={() => setShowExecution(value => !value)}>{showExecution ? '실행 관리 닫기' : '현재 모드 실행 관리 열기'}</button>
        {showExecution && <Suspense fallback={<p role="status">실행 관리 불러오는 중…</p>}><Execution /></Suspense>}
      </div>}
    </section>
    <section className="workspace-card"><h2>자료가 이어지는 경로</h2><ol className="workspace-data-path">
      <li><strong>관측 대상</strong><p>서버 관심 목록 전체 · 수집 뉴스와 공시의 연결 종목 · 가상 보유 종목</p></li>
      <li><strong>기본 관측</strong><p>진입 당시 가격·뉴스·20일선 위치를 고정하고 D1·D3·D5 종가로 평가</p></li>
      <li><strong>전략 학습</strong><p>완료된 기본 관측과 뉴스 확인이 가능한 과거 재현 표본을 함께 활용</p></li>
      <li><strong>조건별 연구</strong><p>저장 OHLCV·지수로 각 조건을 개별 검증하고 후반 기간의 대조군과 비교</p></li>
    </ol></section>
    <section className="workspace-card"><h2>화면 설정</h2>
      <fieldset className="mt-5"><legend className="workspace-note">테마</legend><div className="workspace-theme-options">{THEME_OPTIONS.map(option => <button type="button" key={option.id} className="workspace-button" aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>{option.label}</button>)}</div></fieldset>
      <label className="workspace-font-setting">글자 크기 <input type="range" min={14} max={20} step={1} value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /><output>{fontSize}px</output></label>
    </section>
  </>;
}
