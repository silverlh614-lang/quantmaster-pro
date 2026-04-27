// @responsibility portfolio 영역 PortfolioManager 컴포넌트
import React, { useState } from 'react';
import { PortfolioPieChart } from './PortfolioPieChart';
import { PortfolioComparison } from './PortfolioComparison';
import {
  Plus,
  Trash2,
  Save,
  Folder,
  BarChart3,
  Clock,
  Edit2,
  X,
  Check,
  ArrowRightLeft,
  Layers,
  PieChart as PieChartIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Portfolio } from '../../services/stockService';
import { cn } from '../../ui/cn';

interface PortfolioManagerProps {
  portfolios: Portfolio[];
  currentPortfolioId: string | null;
  onSelect: (id: string) => void;
  onSave: (name: string, description?: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, name: string, description?: string) => void;
}

export const PortfolioManager: React.FC<PortfolioManagerProps> = ({
  portfolios,
  currentPortfolioId,
  onSelect,
  onSave,
  onDelete,
  onUpdate,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showCompareMode, setShowCompareMode] = useState(false);
  const [comparingPortfolioIds, setComparingPortfolioIds] = useState<string[] | null>(null);

  const handleSave = () => {
    if (!newName.trim()) return;
    onSave(newName, newDesc);
    setNewName('');
    setNewDesc('');
    setIsSaving(false);
  };

  const handleUpdate = (id: string) => {
    if (!editName.trim()) return;
    onUpdate(id, editName, editDesc);
    setEditingId(null);
  };

  const toggleCompare = (id: string) => {
    setSelectedForCompare(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-2 h-8 bg-indigo-500 rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
          <h3 className="text-2xl font-black text-theme-text tracking-tight uppercase">Portfolio Vault</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCompareMode(!showCompareMode)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all border",
              showCompareMode 
                ? "bg-indigo-500 border-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]" 
                : "bg-white/5 border-white/10 text-white/40 hover:text-white hover:bg-white/10"
            )}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>{showCompareMode ? 'Exit Compare' : 'Compare Mode'}</span>
          </button>
          <button
            onClick={() => setIsSaving(true)}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-black transition-all border border-white/10"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Portfolio</span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isSaving && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-3d rounded-[2rem] p-8 border border-white/10 space-y-6 bg-indigo-500/5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-1">Portfolio Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Growth Tech 2026"
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-3 text-sm font-bold text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest ml-1">Description (Optional)</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Strategy notes..."
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-3 text-sm font-bold text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setIsSaving(false)}
                  className="px-6 py-2.5 rounded-xl text-xs font-black text-white/40 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!newName.trim()}
                  className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white px-8 py-2.5 rounded-xl text-xs font-black transition-all shadow-lg"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Current Portfolio</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {!portfolios || portfolios.length === 0 ? (
          <div className="col-span-full py-20 text-center glass-3d rounded-[3rem] border border-white/5 border-dashed">
            <Folder className="w-12 h-12 text-white/5 mx-auto mb-4" />
            <p className="text-white/20 font-black text-sm">No saved portfolios yet.</p>
          </div>
        ) : (
          portfolios.map((portfolio) => (
            <motion.div
              key={portfolio.id}
              layout
              className={cn(
                "group relative glass-3d rounded-[2.5rem] p-8 border transition-all cursor-pointer",
                currentPortfolioId === portfolio.id 
                  ? "border-indigo-500/50 bg-indigo-500/5 ring-1 ring-indigo-500/20" 
                  : "border-white/5 hover:border-white/20 bg-white/5"
              )}
              onClick={() => !showCompareMode && onSelect(portfolio.id)}
            >
              {showCompareMode && (
                <div 
                  className="absolute top-6 right-6 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCompare(portfolio.id);
                  }}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                    selectedForCompare.includes(portfolio.id)
                      ? "bg-indigo-500 border-indigo-400"
                      : "border-white/20 bg-black/20"
                  )}>
                    {selectedForCompare.includes(portfolio.id) && <Check className="w-4 h-4 text-white" />}
                  </div>
                </div>
              )}

              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between mb-6">
                  <div className="p-3 rounded-2xl bg-white/5 group-hover:bg-indigo-500/20 transition-colors">
                    <Layers className={cn(
                      "w-6 h-6 transition-colors",
                      currentPortfolioId === portfolio.id ? "text-indigo-400" : "text-white/20"
                    )} />
                  </div>
                  {!showCompareMode && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(portfolio.id);
                          setEditName(portfolio.name);
                          setEditDesc(portfolio.description || '');
                        }}
                        className="p-2 text-white/20 hover:text-white transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(portfolio.id);
                        }}
                        className="p-2 text-white/20 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {editingId === portfolio.id ? (
                  <div className="space-y-4 mb-4" onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm font-bold text-white focus:outline-none focus:border-indigo-500/50"
                    />
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs font-medium text-white/60 focus:outline-none focus:border-indigo-500/50 h-20 resize-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="p-2 text-white/20"><X className="w-4 h-4" /></button>
                      <button onClick={() => handleUpdate(portfolio.id)} className="p-2 text-indigo-400"><Check className="w-4 h-4" /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h4 className="text-xl font-black text-white mb-2 line-clamp-1">{portfolio.name}</h4>
                    <p className="text-xs font-medium text-white/40 mb-6 line-clamp-2 h-8">
                      {portfolio.description || 'No description provided.'}
                    </p>
                  </>
                )}

                <div className="mt-auto pt-6 border-t border-white/5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Assets</span>
                        <span className="text-xs font-black text-white">{portfolio.items.length}</span>
                      </div>
                      {portfolio.lastBacktestResult && (
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Return</span>
                          <span className={cn(
                            "text-xs font-black",
                            portfolio.lastBacktestResult.cumulativeReturn >= 0 ? "text-green-400" : "text-red-400"
                          )}>
                            {portfolio.lastBacktestResult.cumulativeReturn}%
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-black text-white/20 uppercase tracking-widest">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(portfolio.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="pt-4">
                    <PortfolioPieChart items={portfolio.items} />
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {showCompareMode && selectedForCompare.length >= 2 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50"
        >
          <button
            onClick={() => setComparingPortfolioIds(selectedForCompare)}
            className="flex items-center gap-4 bg-indigo-500 hover:bg-indigo-600 text-white px-12 py-5 rounded-[2.5rem] font-black text-lg transition-all shadow-[0_20px_50px_rgba(99,102,241,0.4)] active:scale-95"
          >
            <BarChart3 className="w-6 h-6" />
            <span>Compare {selectedForCompare.length} Portfolios</span>
          </button>
        </motion.div>
      )}

      <AnimatePresence>
        {comparingPortfolioIds && (
          <PortfolioComparison
            portfolios={(portfolios || []).filter(p => comparingPortfolioIds.includes(p.id))}
            onClose={() => setComparingPortfolioIds(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
