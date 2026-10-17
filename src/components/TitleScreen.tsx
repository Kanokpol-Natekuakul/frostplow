import React, { useEffect } from 'react';
import { Volume2, VolumeX, Sparkles, Snowflake } from 'lucide-react';
import { soundEngine } from '../game/audio.ts';

interface TitleScreenProps {
  onStart: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  villageLabel: string;
  bestTime: number | null;
  onResetProgress: () => void;
}

const formatTime = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

export const TitleScreen: React.FC<TitleScreenProps> = ({
  onStart,
  isMuted,
  onToggleMute,
  villageLabel,
  bestTime,
  onResetProgress,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStart]);

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col justify-between p-6 md:p-12 [@media(max-height:640px)]:p-3 pointer-events-none select-none"
      style={{ background: 'radial-gradient(circle at center, transparent 35%, rgba(15, 23, 42, 0.45) 100%)' }}
    >
      {/* Top Header / Audio Toggle */}
      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-700/60 text-slate-200 text-xs font-medium tracking-wide">
          <Snowflake className="w-3.5 h-3.5 text-sky-400 animate-spin" style={{ animationDuration: '8s' }} />
          <span>ALPINESNOW SIMULATION · V1.0</span>
        </div>

        <div className="flex items-center gap-3">
        <button
          onClick={onResetProgress}
          className="pointer-events-auto text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2 cursor-pointer"
        >
          Reset progress
        </button>
        <button
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute Sound' : 'Mute Sound'}
          className="pointer-events-auto flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer shadow-lg active:scale-95"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          <span>{isMuted ? 'Sound Muted' : 'Synth Audio ON'}</span>
        </button>
        </div>
      </div>

      {/* Hero Title Lockup & Start CTA */}
      <div className="pointer-events-auto touch-pan-y flex flex-col items-center text-center max-w-xl max-h-[calc(100dvh-5rem)] overflow-y-auto mx-auto my-auto p-6 md:p-8 [@media(max-height:640px)]:p-4 rounded-3xl bg-slate-950/80 border border-slate-800/80 shadow-2xl space-y-6 [@media(max-height:640px)]:space-y-3">
        {/* Custom Bespoke Winter SVG Crest */}
        <div className="relative [@media(max-height:640px)]:hidden">
          <svg
            className="w-20 h-20 md:w-24 md:h-24 text-sky-400 drop-shadow-[0_10px_20px_rgba(56,189,248,0.25)] mx-auto"
            viewBox="0 0 100 100"
            fill="none"
          >
            {/* Hexagonal Frost Shield */}
            <polygon
              points="50,6 88,28 88,72 50,94 12,72 12,28"
              fill="rgba(15, 23, 42, 0.85)"
              stroke="#38bdf8"
              strokeWidth="2.5"
            />
            {/* Snowplow blade silhouette in gold/orange */}
            <path
              d="M26,62 Q50,70 74,62 L78,54 Q50,60 22,54 Z"
              fill="#f59e0b"
              stroke="#fbbf24"
              strokeWidth="1.5"
            />
            {/* Mountain peaks with snow */}
            <polygon points="50,22 66,48 34,48" fill="#e2e8f0" />
            <polygon points="50,22 56,32 44,32" fill="#38bdf8" />
            <polygon points="35,32 48,50 22,50" fill="#94a3b8" />
            <polygon points="65,32 78,50 52,50" fill="#94a3b8" />
            {/* Snow Crystals */}
            <circle cx="50" cy="74" r="2.5" fill="#ffffff" />
            <circle cx="38" cy="40" r="1.5" fill="#bae6fd" />
            <circle cx="62" cy="40" r="1.5" fill="#bae6fd" />
          </svg>
        </div>

        {/* Title Typography */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-1.5 text-xs md:text-sm font-semibold tracking-widest text-sky-300 uppercase">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Cozy Winter Plowing
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white drop-shadow-md">
            FROST<span className="text-amber-400">PLOW</span>
          </h1>
          <p className="text-slate-300 text-xs md:text-sm max-w-md mx-auto leading-relaxed [@media(max-height:460px)]:hidden">
            Clear powdery alpine drifts, build plowing combos, upgrade your tractor, and unwind to ambient winter synths.
          </p>
        </div>

        {/* Where the shift continues */}
        <p className="text-sky-200 text-xs md:text-sm font-semibold tracking-wide">
          {villageLabel}
          {bestTime != null && <span className="text-slate-400 font-normal"> · best {formatTime(bestTime)}</span>}
        </p>

        {/* Primary Start CTA Button */}
        <div className="pt-1">
          <button
            data-start="true"
            onClick={onStart}
            className="pointer-events-auto px-8 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-base md:text-lg shadow-[0_12px_28px_rgba(245,158,11,0.4)] transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer flex items-center gap-3 mx-auto"
          >
            <span>Start Plowing</span>
            <span className="pointer-coarse:hidden px-2 py-0.5 rounded bg-amber-600/30 text-amber-950 font-mono text-xs border border-amber-600/40">
              Enter
            </span>
          </button>
        </div>
      </div>

      {/* Flat Control Hints Bar */}
      <div className="pointer-coarse:hidden w-full text-center pb-2">
        <p className="text-slate-300 text-xs md:text-sm font-medium tracking-wide drop-shadow">
          <span className="text-slate-100 font-semibold">WASD / Arrows</span> Move ·{' '}
          <span className="text-slate-100 font-semibold">Shift / X</span> Drift ·{' '}
          <span className="text-slate-100 font-semibold">Space</span> Snow Cannon ·{' '}
          <span className="text-slate-100 font-semibold">C</span> Camera ·{' '}
          <span className="text-slate-100 font-semibold">Esc / P</span> Pause
        </p>
      </div>
    </div>
  );
};
