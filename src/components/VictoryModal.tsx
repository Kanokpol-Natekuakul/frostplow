import React from 'react';
import { Award, RotateCcw, Home, Sparkles, Snowflake } from 'lucide-react';
import type { GameMetrics } from '../game/types.ts';

interface VictoryModalProps {
  metrics: GameMetrics;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  metrics,
  onPlayAgain,
  onTitle,
}) => {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/80 select-none"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="w-full max-w-md p-6 rounded-3xl bg-slate-900 border border-amber-500/50 shadow-[0_0_50px_rgba(245,158,11,0.2)] text-slate-100 flex flex-col items-center text-center space-y-5">
        {/* Star Icon Badge */}
        <div className="w-16 h-16 rounded-3xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
          <Award className="w-8 h-8" />
        </div>

        {/* Title & Celebration */}
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" />
            Alpine Village Hero
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-2xl md:text-3xl font-black text-white">Village Roads Cleared!</h2>
          <p className="text-slate-300 text-xs md:text-sm max-w-xs mx-auto leading-relaxed">
            The villagers can now travel safely to the bakery, town square, and ski lifts. Outstanding work!
          </p>
        </div>

        {/* Stat Badges */}
        <div className="grid grid-cols-2 gap-2.5 w-full">
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Cleared</span>
            <span className="text-xl font-bold text-sky-400 tabular-nums">{metrics.snowClearedSqM} m²</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Peak Combo</span>
            <span className="text-xl font-bold text-amber-400 tabular-nums">x{metrics.maxCombo.toFixed(1)}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Coins Earned</span>
            <span className="text-xl font-bold text-amber-300 tabular-nums">🪙 {metrics.coins}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Completion Time</span>
            <span className="text-xl font-bold text-emerald-400 tabular-nums">{formatTime(metrics.shiftDurationSec)}</span>
          </div>
        </div>

        {/* Action CTAs */}
        <div className="w-full space-y-2 pt-2">
          <button
            data-start="true"
            onClick={onPlayAgain}
            className="w-full py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <Snowflake className="w-4 h-4" />
            <span>Start Fresh Winter Shift</span>
          </button>

          <button
            onClick={onTitle}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Return to Title Screen</span>
          </button>
        </div>
      </div>
    </div>
  );
};
