import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal, ModalHeader, ModalBody } from '../ui/modal';
import { useSettingsStore } from '../stores';
import { MASTER_CHECKLIST_STEPS, SELL_CHECKLIST_STEPS } from '../constants/checklist';

export function MasterChecklistModal() {
  const { showMasterChecklist, setShowMasterChecklist } = useSettingsStore();

  return (
    <Modal open={showMasterChecklist} onClose={() => setShowMasterChecklist(false)} size="lg">
      <ModalHeader
        onClose={() => setShowMasterChecklist(false)}
        icon={<ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />}
        subtitle="Master Selection System"
      >
        27단계 마스터 체크리스트
      </ModalHeader>

      <ModalBody className="space-y-8 sm:space-y-10">
        {[1, 2, 3].map(gateNum => (
          <div key={gateNum} className="space-y-3 sm:space-y-4">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="px-3 py-1 bg-orange-500/15 rounded-full border border-orange-500/25">
                <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Gate {gateNum}</span>
              </div>
              <div className="h-px flex-1 bg-theme-border" />
              <span className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest hidden sm:block">
                {gateNum === 1 ? '기초 체력 및 사이클 검증' : gateNum === 2 ? '수급 및 실체적 모멘텀 확인' : '추세 가속 및 리스크 관리'}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:gap-3">
              {MASTER_CHECKLIST_STEPS.filter(s => s.gate === gateNum).map((step) => (
                <div
                  key={step.key}
                  className="flex gap-3 sm:gap-5 p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-theme-border/50 bg-white/[0.02] hover:bg-white/[0.06] transition-all group"
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-orange-500/10 transition-colors shrink-0">
                    <step.icon className="w-4 h-4 sm:w-5 sm:h-5 text-theme-text-muted group-hover:text-orange-500 transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs sm:text-sm font-black text-theme-text mb-0.5 sm:mb-1">{step.title}</h4>
                    <p className="text-[10px] sm:text-[11px] text-theme-text-muted font-medium leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Sell Checklist */}
        <div className="space-y-3 sm:space-y-4 pt-4 sm:pt-6">
          <div className="flex items-center gap-3 mb-3 sm:mb-4">
            <div className="px-3 py-1 bg-red-500/15 rounded-full border border-red-500/25">
              <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Sell Checklist</span>
            </div>
            <div className="h-px flex-1 bg-theme-border" />
            <span className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest hidden sm:block">매도 원칙 및 리스크 관리</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:gap-3">
            {SELL_CHECKLIST_STEPS.map((step, i) => (
              <div
                key={i}
                className="flex gap-3 sm:gap-5 p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-red-500/5 bg-red-500/[0.02] hover:bg-red-500/[0.06] transition-all group"
              >
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-red-500/10 transition-colors shrink-0">
                  <step.icon className="w-4 h-4 sm:w-5 sm:h-5 text-theme-text-muted group-hover:text-red-500 transition-colors" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-theme-text mb-0.5 sm:mb-1">{step.title}</h4>
                  <p className="text-[10px] sm:text-[11px] text-theme-text-muted font-medium leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-6 sm:pt-8 border-t border-theme-border text-center">
          <p className="text-xs text-theme-text-muted font-bold leading-relaxed">
            본 시스템은 과거 70년 한국 증시의 주도주 교체 패턴과<br />
            실체적 펀더멘털 데이터를 결합한 독자적인 분석 알고리즘입니다.
          </p>
        </div>
      </ModalBody>
    </Modal>
  );
}
