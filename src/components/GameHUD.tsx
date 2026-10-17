import React, { useState } from 'react';
import {
  Volume2,
  VolumeX,
  Camera,
  Pause,
  Snowflake,
  Sun,
  Wind,
  Wrench,
  CloudSnow,
  ChevronDown,
  ChevronUp,
  Zap,
  Flame,
  Award,
} from 'lucide-react';
import type { GameMetrics, UpgradesState, WeatherType } from '../game/types.ts';
import { getUpgradeInfo } from '../game/logic.ts';
import { soundEngine } from '../game/audio.ts';

interface GameHUDProps {
  metrics: GameMetrics;
  upgrades: UpgradesState;
  weatherType: WeatherType;
  cameraMode: 'isometric' | 'close' | 'top';
  isMuted: boolean;
  onUpgrade: (type: keyof UpgradesState) => void;
  onSetWeather: (type: WeatherType) => void;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onVirtualInput: (input: Partial<{ forward: boolean; backward: boolean; left: boolean; right: boolean; action: boolean }>) => void;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  metrics,
  upgrades,
  weatherType,
  cameraMode,
  isMuted,
  onUpgrade,
  onSetWeather,
  onToggleCamera,
  onToggleMute,
  onPause,
  onVirtualInput,
}) => {
  const [isDockOpen, setIsDockOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'upgrades' | 'weather' | 'objectives'>('upgrades');

  // Keyboard shortcut listener for Workshop (U) and Blizzard (B)
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyU') {
        setIsDockOpen((prev) => !prev);
      }
      if (e.code === 'KeyB') {
        onSetWeather(weatherType === 'blizzard' ? 'flurries' : 'blizzard');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [weatherType, onSetWeather]);

  const bladeInfo = getUpgradeInfo('bladeWidth', upgrades.bladeWidth);
  const engineInfo = getUpgradeInfo('enginePower', upgrades.enginePower);
  const saltInfo = getUpgradeInfo('saltSpreader', upgrades.saltSpreader);
  const blowerInfo = getUpgradeInfo('snowBlower', upgrades.snowBlower);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="absolute inset-0 z-10 pointer-events-none select-none flex flex-col justify-between p-3 md:p-6 overflow-hidden">
      {/* Top Perimeter Status Cluster */}
      <div className="flex justify-between items-start w-full">
        {/* Top-Left: Village Cleanliness & Score */}
        <div className="pointer-events-auto flex items-center gap-3 p-3 rounded-2xl bg-slate-950/85 border border-slate-800 shadow-xl text-white">
          {/* Circular Cleanliness Ring */}
          <div className="relative w-12 h-12 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-800"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-sky-400 transition-all duration-300"
                strokeDasharray={`${metrics.cleanPercent}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="absolute text-xs font-bold tabular-nums text-sky-200">
              {metrics.cleanPercent}%
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              VILLAGE CLEANLINESS
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tabular-nums text-slate-200">
                {metrics.snowClearedSqM} <span className="text-xs text-slate-400 font-normal">m²</span>
              </span>
              <span className="text-xs font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-800/50 tabular-nums">
                🪙 {metrics.coins}
              </span>
            </div>
          </div>
        </div>

        {/* Top-Center: Weather Indicator Pill */}
        <div className="pointer-events-auto hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 border border-slate-800 shadow-lg text-slate-200 text-xs">
          {weatherType === 'blizzard' ? (
            <Wind className="w-4 h-4 text-sky-400 animate-pulse" />
          ) : weatherType === 'sunny' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <CloudSnow className="w-4 h-4 text-sky-300" />
          )}
          <span className="font-medium">
            {weatherType === 'blizzard'
              ? 'Mountain Blizzard · -12°C'
              : weatherType === 'sunny'
              ? 'Alpine Sunlight · +1°C'
              : 'Gentle Flurries · -3°C'}
          </span>
        </div>

        {/* Top-Right: Action & Utility Buttons */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Snow Cannon Charge (if unlocked) */}
          {upgrades.snowBlower > 0 && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold shadow-lg transition ${
                metrics.blowerCharge >= 1.0
                  ? 'bg-sky-600 border-sky-400 text-white'
                  : 'bg-slate-950/85 border-slate-800 text-slate-400'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{metrics.blowerCharge >= 1.0 ? 'CANNON [Space]' : `${Math.round(metrics.blowerCharge * 100)}%`}</span>
            </div>
          )}

          <button
            onClick={onToggleCamera}
            aria-label="Toggle Camera View"
            title="Switch Camera View [C]"
            className="p-2.5 rounded-xl bg-slate-950/85 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs transition cursor-pointer shadow-lg active:scale-95"
          >
            <Camera className="w-4 h-4 text-sky-400" />
          </button>

          <button
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            title="Toggle Audio [M]"
            className="p-2.5 rounded-xl bg-slate-950/85 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs transition cursor-pointer shadow-lg active:scale-95"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          <button
            onClick={onPause}
            aria-label="Pause Game"
            title="Pause [Esc / P]"
            className="p-2.5 rounded-xl bg-slate-950/85 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs transition cursor-pointer shadow-lg active:scale-95"
          >
            <Pause className="w-4 h-4 text-amber-400" />
          </button>
        </div>
      </div>

      {/* Dynamic Center: Combo Multiplier Banner */}
      {metrics.comboMultiplier > 1.05 && (
        <div className="self-center mt-2 flex flex-col items-center pointer-events-none transition-all duration-200">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-2xl bg-slate-950/90 border border-amber-500/60 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
            <Flame className="w-4 h-4 text-amber-400 animate-bounce" />
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">COMBO DRIFT</span>
            <span className="text-xl font-black text-amber-400 tabular-nums">
              x{metrics.comboMultiplier.toFixed(1)}
            </span>
          </div>
          {/* Combo Decay Timer Bar */}
          <div className="w-32 h-1.5 bg-slate-800/80 rounded-full mt-1 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-sky-400 transition-all duration-75"
              style={{ width: `${(metrics.comboTimer / 2.5) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Mobile On-Screen Virtual Controls */}
      <div className="pointer-events-none flex sm:hidden justify-between items-end w-full px-2 mb-2">
        {/* D-Pad Buttons */}
        <div className="pointer-events-auto grid grid-cols-3 gap-1.5 p-2 rounded-2xl bg-slate-950/80 border border-slate-800">
          <div />
          <button
            onTouchStart={() => onVirtualInput({ forward: true })}
            onTouchEnd={() => onVirtualInput({ forward: false })}
            className="w-11 h-11 rounded-lg bg-slate-800 active:bg-amber-600 text-white font-bold flex items-center justify-center text-sm"
          >
            ▲
          </button>
          <div />
          <button
            onTouchStart={() => onVirtualInput({ left: true })}
            onTouchEnd={() => onVirtualInput({ left: false })}
            className="w-11 h-11 rounded-lg bg-slate-800 active:bg-amber-600 text-white font-bold flex items-center justify-center text-sm"
          >
            ◀
          </button>
          <button
            onTouchStart={() => onVirtualInput({ backward: true })}
            onTouchEnd={() => onVirtualInput({ backward: false })}
            className="w-11 h-11 rounded-lg bg-slate-800 active:bg-amber-600 text-white font-bold flex items-center justify-center text-sm"
          >
            ▼
          </button>
          <button
            onTouchStart={() => onVirtualInput({ right: true })}
            onTouchEnd={() => onVirtualInput({ right: false })}
            className="w-11 h-11 rounded-lg bg-slate-800 active:bg-amber-600 text-white font-bold flex items-center justify-center text-sm"
          >
            ▶
          </button>
        </div>

        {/* Action Button for Blower / Drift */}
        <button
          onTouchStart={() => onVirtualInput({ action: true })}
          className="pointer-events-auto w-14 h-14 rounded-2xl bg-amber-500 active:bg-amber-600 text-slate-950 font-black shadow-lg flex items-center justify-center text-xs uppercase"
        >
          Blast
        </button>
      </div>

      {/* Bottom Center Collapsible Cozy Dock */}
      <div className="pointer-events-auto self-center w-full max-w-xl flex flex-col items-center">
        {/* Collapse / Expand Toggle Button */}
        <button
          onClick={() => setIsDockOpen(!isDockOpen)}
          aria-label={isDockOpen ? 'Hide Workshop Dock' : 'Open Workshop Dock'}
          className="flex items-center gap-2 px-4 py-1.5 rounded-t-xl bg-slate-950/90 hover:bg-slate-900 border-t border-x border-slate-800 text-slate-300 text-xs font-semibold transition cursor-pointer shadow-lg active:scale-95"
        >
          <Wrench className="w-3.5 h-3.5 text-amber-400" />
          <span>{isDockOpen ? 'Hide Workshop [U]' : 'Plow Workshop & Weather [U]'}</span>
          {isDockOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-400" />}
          <span className="text-[10px] text-amber-400 font-mono bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-900/40">
            🪙 {metrics.coins}
          </span>
        </button>

        {/* Dock Drawer Body */}
        {isDockOpen && (
          <div className="w-full p-4 rounded-b-2xl rounded-tl-2xl bg-slate-950/95 border border-slate-800 shadow-2xl text-slate-200">
            {/* Dock Tabs */}
            <div className="flex border-b border-slate-800 pb-2 mb-3 gap-2">
              <button
                onClick={() => setActiveTab('upgrades')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'upgrades'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                Plow Upgrades
              </button>

              <button
                onClick={() => setActiveTab('weather')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'weather'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <CloudSnow className="w-3.5 h-3.5" />
                Weather Chamber
              </button>

              <button
                onClick={() => setActiveTab('objectives')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'objectives'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                Shift Stats
              </button>
            </div>

            {/* Tab 1: Upgrades Workshop */}
            {activeTab === 'upgrades' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                {/* 1. Plow Blade Span */}
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-white">{bladeInfo.name}</span>
                      <span className="text-[11px] font-mono text-amber-400">{bladeInfo.statValue}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{bladeInfo.description}</p>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">Lvl {bladeInfo.level}/5</span>
                    {bladeInfo.cost > 0 ? (
                      <button
                        onClick={() => onUpgrade('bladeWidth')}
                        disabled={metrics.coins < bladeInfo.cost}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          metrics.coins >= bladeInfo.cost
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer shadow'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        🪙 {bladeInfo.cost}
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-400">MAX</span>
                    )}
                  </div>
                </div>

                {/* 2. Engine Power */}
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-white">{engineInfo.name}</span>
                      <span className="text-[11px] font-mono text-amber-400">{engineInfo.statValue}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{engineInfo.description}</p>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">Lvl {engineInfo.level}/5</span>
                    {engineInfo.cost > 0 ? (
                      <button
                        onClick={() => onUpgrade('enginePower')}
                        disabled={metrics.coins < engineInfo.cost}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          metrics.coins >= engineInfo.cost
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer shadow'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        🪙 {engineInfo.cost}
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-400">MAX</span>
                    )}
                  </div>
                </div>

                {/* 3. Heated Salt Spreader */}
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-white">{saltInfo.name}</span>
                      <span className="text-[11px] font-mono text-sky-400">{saltInfo.statValue}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{saltInfo.description}</p>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">Lvl {saltInfo.level}/4</span>
                    {saltInfo.cost > 0 ? (
                      <button
                        onClick={() => onUpgrade('saltSpreader')}
                        disabled={metrics.coins < saltInfo.cost}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          metrics.coins >= saltInfo.cost
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer shadow'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        🪙 {saltInfo.cost}
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-400">MAX</span>
                    )}
                  </div>
                </div>

                {/* 4. Snow Cannon / Blower */}
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-white">{blowerInfo.name}</span>
                      <span className="text-[11px] font-mono text-sky-400">{blowerInfo.statValue}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{blowerInfo.description}</p>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400">Lvl {blowerInfo.level}/4</span>
                    {blowerInfo.cost > 0 ? (
                      <button
                        onClick={() => onUpgrade('snowBlower')}
                        disabled={metrics.coins < blowerInfo.cost}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          metrics.coins >= blowerInfo.cost
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer shadow'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        🪙 {blowerInfo.cost}
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-400">MAX</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Weather Chamber */}
            {activeTab === 'weather' && (
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => onSetWeather('flurries')}
                  className={`p-3 rounded-xl border flex flex-col items-center text-center cursor-pointer transition ${
                    weatherType === 'flurries'
                      ? 'bg-sky-950/60 border-sky-400 text-white'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <CloudSnow className="w-5 h-5 text-sky-300 mb-1" />
                  <span className="text-xs font-bold">Gentle Flurries</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">-3°C · Light Breeze</span>
                </button>

                <button
                  onClick={() => onSetWeather('sunny')}
                  className={`p-3 rounded-xl border flex flex-col items-center text-center cursor-pointer transition ${
                    weatherType === 'sunny'
                      ? 'bg-amber-950/60 border-amber-400 text-white'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Sun className="w-5 h-5 text-amber-400 mb-1" />
                  <span className="text-xs font-bold">Alpine Sun</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">+1°C · Golden Glow</span>
                </button>

                <button
                  onClick={() => onSetWeather('blizzard')}
                  className={`p-3 rounded-xl border flex flex-col items-center text-center cursor-pointer transition ${
                    weatherType === 'blizzard'
                      ? 'bg-sky-900/70 border-sky-400 text-white'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Wind className="w-5 h-5 text-sky-400 mb-1 animate-pulse" />
                  <span className="text-xs font-bold">Heavy Blizzard</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">-12°C · Howling Wind</span>
                </button>
              </div>
            )}

            {/* Tab 3: Objectives & Metrics */}
            {activeTab === 'objectives' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block uppercase">Shift Time</span>
                  <span className="text-base font-bold text-white tabular-nums">{formatTime(metrics.shiftDurationSec)}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block uppercase">Max Combo</span>
                  <span className="text-base font-bold text-amber-400 tabular-nums">x{metrics.maxCombo.toFixed(1)}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block uppercase">Cleaned Area</span>
                  <span className="text-base font-bold text-sky-400 tabular-nums">{metrics.snowClearedSqM} m²</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block uppercase">Plow Rating</span>
                  <span className="text-xs font-bold text-emerald-400 mt-1 block">
                    {metrics.cleanPercent >= 90 ? 'Alpine Hero ⭐' : metrics.cleanPercent >= 50 ? 'Master Sweeper' : 'Village Shifter'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
