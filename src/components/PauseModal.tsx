import React from 'react';
import { Play, RotateCcw, Home, Volume2, VolumeX, Snowflake } from 'lucide-react';
import type { GameMetrics } from '../game/types.ts';

interface PauseModalProps {
  metrics: GameMetrics;
  isMuted: boolean;
  onResume: () => void;
  onRestart: () => void;
  onTitle: () => void;
  onToggleMute: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  metrics,
  isMuted,
  onResume,
  onRestart,
  onTitle,
  onToggleMute,
}) => {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/75 select-none"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl text-slate-100 flex flex-col space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Snowflake className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold tracking-tight text-white">Shift Paused</h2>
          </div>
          <button
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Cleanliness</span>
            <span className="text-2xl font-black text-sky-400 tabular-nums">{metrics.cleanPercent}%</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Snow Cleared</span>
            <span className="text-2xl font-black text-slate-100 tabular-nums">{metrics.snowClearedSqM} <span className="text-xs font-normal text-slate-400">m²</span></span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Peak Combo</span>
            <span className="text-2xl font-black text-amber-400 tabular-nums">x{metrics.maxCombo.toFixed(1)}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Shift Time</span>
            <span className="text-2xl font-black text-emerald-400 tabular-nums">{formatTime(metrics.shiftDurationSec)}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col space-y-2.5 pt-2">
          <button
            onClick={onResume}
            className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Resume Plowing [Esc]</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onRestart}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Snow</span>
            </button>

            <button
              onClick={onTitle}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Title Screen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
