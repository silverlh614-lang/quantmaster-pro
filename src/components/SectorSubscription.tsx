import React, { useState } from 'react';
import { 
  Radar, 
  Plus, 
  X, 
  Bell, 
  Zap, 
  ChevronRight, 
  Target,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Activity,
  ShieldCheck,
  Building2,
  Flame,
  Globe,
  Brain
} from 'lucide-react';
import { StockRecommendation } from '../services/stockService';
import { cn } from '../utils/cn';


interface SectorSubscriptionProps {
  subscribedSectors: string[];
  onAddSector: (sector: string) => void;
  onRemoveSector: (sector: string) => void;
  recommendations: StockRecommendation[];
  loading: boolean;
}

const AVAILABLE_SECTORS = [
  '조선', '방산', '원자력', 'AI 반도체', '이차전지', '바이오', '로봇', '우주항공', '전력설비', '엔터테인먼트', '게임', '화장품'
];

export const SectorSubscription: React.FC<SectorSubscriptionProps> = ({ 
  subscribedSectors, 
  onAddSector, 
  onRemoveSector,
  recommendations,
  loading
}) => {
  const [newSector, setNewSector] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSector.trim()) {
      onAddSector(newSector.trim());
      setNewSector('');
    }
  };

  const filteredRecommendations = recommendations.filter(r => 
    subscribedSectors.some(s => r.relatedSectors?.includes(s) || (r.name || '').includes(s))
  );

  return (
    <div className="space-y-6">
      {/* Header & Management */}
      <div className="bg-[#151619] border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <Radar className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">관심 섹터 구독 시스템</h2>
              <p className="text-sm text-gray-400">구독한 섹터에서 Gate 1 조건을 통과하는 종목을 실시간 감지합니다.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Active Monitoring</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {subscribedSectors.map(sector => (
              <div 
                key={sector}
                className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 group hover:border-amber-500/30 transition-all"
              >
                <span className="text-sm font-medium text-gray-200">{sector}</span>
                <button 
                  onClick={() => onRemoveSector(sector)}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <form onSubmit={handleAdd} className="relative">
              <input
                type="text"
                onChange={(e) => setNewSector(e.target.value)}
                placeholder="섹터 추가..."
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50 w-32"
              />
              <button 
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-amber-400"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <span className="text-xs text-gray-500 font-medium py-1">추천 섹터:</span>
            {AVAILABLE_SECTORS.filter(s => !subscribedSectors.includes(s)).slice(0, 6).map(sector => (
              <button
                key={sector}
                onClick={() => onAddSector(sector)}
                className="text-xs text-gray-400 hover:text-amber-400 bg-white/5 hover:bg-amber-500/10 border border-white/5 hover:border-amber-500/20 rounded-md px-2 py-1 transition-all"
              >
                + {sector}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Monitoring Results */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-bold text-white">실시간 감지된 주도주 후보</h3>
            </div>
            <div className="text-xs text-gray-500">마지막 업데이트: {new Date().toLocaleTimeString()}</div>
          </div>

          {loading ? (
            <div className="bg-[#151619] border border-white/5 rounded-xl p-12 flex flex-col items-center justify-center space-y-4">
              <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
              <p className="text-gray-400 font-medium">구독 섹터 내 종목들을 스캔 중입니다...</p>
            </div>
          ) : filteredRecommendations.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {filteredRecommendations.map((stock, idx) => (
                <div
                  key={stock.code}
                  className="bg-[#151619] border border-white/10 rounded-xl p-5 hover:border-amber-500/30 transition-all group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-2">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <Bell className="w-3 h-3" />
                      NEW SIGNAL
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-xl font-bold text-amber-400">
                      {stock.name[0]}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-bold text-white">{stock.name}</h4>
                        <span className="text-xs text-gray-500 font-mono">{stock.code}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {stock.relatedSectors?.map(s => (
                          <span key={s} className="text-[10px] font-medium bg-white/5 text-gray-400 px-2 py-0.5 rounded border border-white/5">
                            {s}
                          </span>
                        ))}
                      </div>
                      <p className="text-sm text-gray-400 mt-3 line-clamp-2">{stock.reason}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-white">{stock.currentPrice?.toLocaleString()}원</div>
                      <div className="text-xs font-bold text-green-400 mt-1">Gate {stock.gate} 통과</div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-xs text-gray-400">모멘텀: {stock.momentumRank}위</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-xs text-gray-400">신뢰도: {stock.confidenceScore}%</span>
                      </div>
                    </div>
                    <button className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors">
                      상세 분석 보기 <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-[#151619] border border-white/5 rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <Radar className="w-8 h-8 text-gray-600" />
              </div>
              <div>
                <p className="text-gray-400 font-medium">현재 감지된 신규 종목이 없습니다.</p>
                <p className="text-sm text-gray-600 mt-1">구독 섹터를 추가하거나 다음 자동 스캔을 기다려주세요.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-[#151619] border border-white/10 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-blue-400" />
              시스템 가동 현황
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">모니터링 섹터</span>
                <span className="text-sm font-bold text-white">{subscribedSectors.length}개</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">스캔 주기</span>
                <span className="text-sm font-bold text-white">일 2회 (장 시작/마감)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">다음 스캔 예정</span>
                <span className="text-sm font-bold text-amber-400">오후 3:30</span>
              </div>
              <div className="pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  <Brain className="w-3.5 h-3.5" />
                  <span>AI 분석 가동 중</span>
                </div>
                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-600/20 to-orange-600/20 border border-amber-500/20 rounded-xl p-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">구독 시스템 활용 팁</h3>
            <ul className="space-y-3">
              <li className="flex gap-2 text-xs text-gray-300">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1 flex-shrink-0" />
                <span>섹터 대장주가 먼저 움직이면 구독 섹터 내 2등주를 주목하세요.</span>
              </li>
              <li className="flex gap-2 text-xs text-gray-300">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1 flex-shrink-0" />
                <span>Gate 1 통과 알림이 오면 즉시 2단계 AI 심층 분석을 실행하세요.</span>
              </li>
              <li className="flex gap-2 text-xs text-gray-300">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1 flex-shrink-0" />
                <span>여러 섹터에서 동시에 신호가 오면 시장의 주도권이 분산되고 있는 신호일 수 있습니다.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
