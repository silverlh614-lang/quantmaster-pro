import React from 'react';
import { 
  Calendar as CalendarIcon, 
  AlertTriangle, 
  TrendingDown, 
  TrendingUp, 
  Clock, 
  ChevronRight,
  Info,
  Zap,
  Target,
  ShieldAlert
} from 'lucide-react';
import { MacroEvent } from '../types/quant';
import { cn } from '../utils/cn';


interface EventCalendarProps {
  events: MacroEvent[];
}

export const EventCalendar: React.FC<EventCalendarProps> = ({ events }) => {
  if (!events || events.length === 0) {
    return (
      <div className="bg-[#151619] border border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
          <CalendarIcon className="w-8 h-8 text-gray-600" />
        </div>
        <div>
          <p className="text-gray-400 font-medium">예정된 주요 이벤트가 없습니다.</p>
          <p className="text-sm text-gray-600 mt-1">시장 상황을 실시간으로 모니터링 중입니다.</p>
        </div>
      </div>
    );
  }

  const sortedEvents = [...events].sort((a, b) => a.dDay - b.dDay);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
            <CalendarIcon className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">매크로 이벤트 달력</h3>
            <p className="text-sm text-gray-400">주요 일정에 따른 전략적 포지션 조정을 제안합니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Real-time Sync</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {sortedEvents.map((event, idx) => (
          <div
            key={event.id}
            className={cn(
              "relative overflow-hidden bg-[#151619] border rounded-2xl p-5 transition-all group",
              event.impact === 'HIGH' ? "border-red-500/30 hover:border-red-500/50" : 
              event.impact === 'MEDIUM' ? "border-orange-500/30 hover:border-orange-500/50" : 
              "border-white/10 hover:border-white/20"
            )}
          >
            {/* Impact Glow */}
            {event.impact === 'HIGH' && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-[40px] -mr-16 -mt-16" />
            )}

            <div className="flex flex-col md:flex-row md:items-start gap-6 relative z-10">
              {/* D-Day Badge */}
              <div className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-black/40 border border-white/5 shrink-0">
                <span className={cn(
                  "text-2xl font-black",
                  event.dDay <= 3 ? "text-red-500" : "text-orange-500"
                )}>
                  D-{event.dDay}
                </span>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                  {event.date.split('-').slice(1).join('/')}
                </span>
              </div>

              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-3">
                  <h4 className="text-lg font-bold text-white group-hover:text-orange-400 transition-colors">
                    {event.title}
                  </h4>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-widest",
                    event.type === 'MACRO' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                    event.type === 'EARNINGS' ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                    "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  )}>
                    {event.type}
                  </span>
                  {event.impact === 'HIGH' && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                      <AlertTriangle className="w-3 h-3" />
                      HIGH IMPACT
                    </span>
                  )}
                </div>

                <p className="text-sm text-gray-400 leading-relaxed">
                  {event.description}
                </p>

                {/* Strategy Adjustment Box */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 flex items-start gap-3">
                  <div className="mt-1">
                    <Target className="w-4 h-4 text-orange-500" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">전략 자동 조정 제안</div>
                    <p className="text-sm font-medium text-gray-200">
                      {event.strategyAdjustment}
                    </p>
                    {event.probability && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="text-[10px] text-gray-500">발생 확률:</div>
                        <div className="flex-1 h-1 bg-white/5 rounded-full max-w-[100px] overflow-hidden">
                          <div 
                            className="h-full bg-orange-500" 
                            style={{ width: `${event.probability}%` }} 
                          />
                        </div>
                        <div className="text-[10px] font-bold text-orange-400">{event.probability}%</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <button className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500 hover:text-white">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Strategy Summary Card */}
      <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/20 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4">
          <ShieldAlert className="w-12 h-12 text-blue-500/20" />
        </div>
        <div className="relative z-10">
          <h4 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            통합 리스크 관리 브리핑
          </h4>
          <p className="text-sm text-gray-300 leading-relaxed max-w-2xl">
            향후 2주간 예정된 주요 이벤트들은 시장의 변동성을 확대시킬 가능성이 높습니다. 
            특히 <span className="text-red-400 font-bold">FOMC 금리 결정</span> 전후로 VKOSPI의 급등이 예상되므로, 
            보수적인 포지션 유지와 현금 비중 확보를 권고합니다.
          </p>
        </div>
      </div>
    </div>
  );
};
