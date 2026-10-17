/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { GameState, UpgradesState, WeatherType, GameMetrics } from './game/types.ts';
import { calculateVehicleStats, getWeatherPreset, getUpgradeInfo, parseSave, STORM_CALMS_AT } from './game/logic.ts';
import { VILLAGES } from './game/villages.ts';
import { SnowWorld } from './game/world.ts';
import { createInputHub, InputHub } from './game/input.ts';
import { soundEngine } from './game/audio.ts';
import { TitleScreen } from './components/TitleScreen.tsx';
import { GameHUD } from './components/GameHUD.tsx';
import { PauseModal } from './components/PauseModal.tsx';
import { VictoryModal } from './components/VictoryModal.tsx';

const SAVE_KEY = 'frostplow:save';

/** localStorage throws when storage is disabled (private modes, some in-app browsers): then we just don't save. */
function loadSave() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    // no storage
  }
  return parseSave(raw, VILLAGES.length);
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SnowWorld | null>(null);
  const inputRef = useRef<InputHub | null>(null);
  const [save] = useState(loadSave);

  // Game State Machine
  const [gameState, setGameState] = useState<GameState>('title');
  const gameStateRef = useRef<GameState>('title');
  gameStateRef.current = gameState;

  // Progress (persisted)
  const [upgrades, setUpgrades] = useState<UpgradesState>(save.upgrades);
  const [villageIndex, setVillageIndex] = useState(save.village);
  const villageRef = useRef(villageIndex);
  villageRef.current = villageIndex;
  const [best, setBest] = useState(save.best);
  const village = VILLAGES[villageIndex];
  const isLastVillage = villageIndex === VILLAGES.length - 1;
  const nextVillageIndex = isLastVillage ? 0 : villageIndex + 1;

  // Weather belongs to the village; a blizzard eases to flurries once the roads are mostly clear
  const [weatherType, setWeatherType] = useState<WeatherType>(village.weather);
  const weatherRef = useRef(weatherType);
  weatherRef.current = weatherType;

  // Camera Mode State
  const [cameraMode, setCameraMode] = useState<'isometric' | 'close' | 'top'>('isometric');

  // Audio Mute State
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Throttled HUD metrics
  const [hudMetrics, setHudMetrics] = useState<GameMetrics>({
    snowClearedSqM: 0,
    totalSnowSqM: 100,
    cleanPercent: 0,
    coins: save.coins,
    score: 0,
    comboMultiplier: 1.0,
    comboTimer: 0,
    maxCombo: 1.0,
    shiftDurationSec: 0,
    blowerCharge: 1.0,
  });

  // Keep body dataset state in sync
  useEffect(() => {
    document.body.dataset.state = gameState;
  }, [gameState]);

  // Persist progress: a tiny JSON, and coins change at most ~10x/s.
  // On the victory screen the save already points at the next village, so closing the tab there moves you on.
  const savedVillage = gameState === 'gameover' ? nextVillageIndex : villageIndex;
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ coins: hudMetrics.coins, upgrades, village: savedVillage, best }));
    } catch {
      // storage full or disabled: progress just isn't kept
    }
  }, [hudMetrics.coins, upgrades, savedVillage, best]);

  const applyWeather = (type: WeatherType) => {
    weatherRef.current = type;
    setWeatherType(type);
    worldRef.current?.setWeather(getWeatherPreset(type));
  };

  // Handle Autostart URL parameter
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        startGame();
      }
    }
  }, []);

  // Initialize Three.js SnowWorld and Input Hub
  useEffect(() => {
    if (!mountRef.current) return;

    const initialStats = calculateVehicleStats(upgrades);
    const initialWeather = getWeatherPreset(weatherType);

    const inputHub = createInputHub();
    inputRef.current = inputHub;

    let lastMetricsPush = 0;

    const world = new SnowWorld(
      mountRef.current,
      initialStats,
      initialWeather,
      VILLAGES[villageRef.current],
      {
        onMetricsUpdate: (newMetrics) => {
          const now = performance.now();
          // Throttle React state updates to ~10Hz to preserve 60FPS simulation
          if (now - lastMetricsPush > 90) {
            lastMetricsPush = now;
            setHudMetrics((prev) => ({ ...prev, ...newMetrics }));
          }

          const clean = newMetrics.cleanPercent ?? 0;
          if (weatherRef.current === 'blizzard' && clean >= STORM_CALMS_AT) {
            applyWeather('flurries');
          }

          // Village cleared: record the time and celebrate with final numbers, not a throttled snapshot
          if (clean >= 100 && gameStateRef.current === 'playing') {
            gameStateRef.current = 'gameover';
            const time = newMetrics.shiftDurationSec ?? 0;
            const v = villageRef.current;
            setBest((prev) => {
              const next = [...prev];
              const old = next[v];
              if (old == null || time < old) next[v] = time;
              return next;
            });
            setHudMetrics((prev) => ({ ...prev, ...newMetrics }));
            setGameState('gameover');
          }
        },
        onComboStepped: (combo) => {
          setHudMetrics((prev) => ({
            ...prev,
            comboMultiplier: combo,
            maxCombo: Math.max(prev.maxCombo, combo),
          }));
        },
      }
    );
    worldRef.current = world;
    if (import.meta.env.DEV) (window as any).__frost = world; // live checks from the browser console
    world.addCoins(save.coins);

    // Unified Game Simulation Loop
    let animId: number;
    let prevTime = performance.now();

    const loop = () => {
      animId = requestAnimationFrame(loop);
      const now = performance.now();
      const rawDt = (now - prevTime) / 1000;
      const dt = Math.min(rawDt, 0.05); // clamped dt
      prevTime = now;

      const currentInput = inputRef.current;
      const activeState = gameStateRef.current;

      if (currentInput) {
        // Handle Action Triggers (always consumed, so a press while paused doesn't fire on resume)
        if (currentInput.consumeAction() && activeState === 'playing') {
          world.triggerSnowCannon();
        }

        if (currentInput.consumePause()) {
          if (activeState === 'playing') {
            setGameState('paused');
          } else if (activeState === 'paused') {
            setGameState('playing');
          }
        }

        if (currentInput.consumeMute()) {
          const muted = soundEngine.toggleMute();
          setIsMuted(muted);
        }

        if (currentInput.consumeCameraToggle()) {
          const mode = world.toggleCameraMode();
          setCameraMode(mode);
        }

        // Direct Simulation Tick
        world.renderDirect(dt, activeState, {
          forward: currentInput.forward,
          backward: currentInput.backward,
          left: currentInput.left,
          right: currentInput.right,
          drift: currentInput.drift,
          stickX: currentInput.stickX,
          stickY: currentInput.stickY,
        });
      }
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      world.dispose();
      inputHub.dispose();
    };
  }, []); // Run once on mount

  // Start Game Handshake
  const startGame = useCallback(() => {
    soundEngine.init();
    setGameState('playing');
    document.body.dataset.state = 'playing';
  }, []);

  // Upgrades Purchase Handler
  const handleUpgrade = (type: keyof UpgradesState) => {
    const currentLevel = upgrades[type];
    const info = getUpgradeInfo(type, currentLevel);
    if (info.cost <= 0) return;

    if (worldRef.current && worldRef.current.spendCoins(info.cost)) {
      const nextUpgrades = { ...upgrades, [type]: currentLevel + 1 };
      setUpgrades(nextUpgrades);

      const nextStats = calculateVehicleStats(nextUpgrades);
      worldRef.current.updateStats(nextStats);

      soundEngine.playUpgradeDing();

      setHudMetrics((prev) => ({
        ...prev,
        coins: prev.coins - info.cost,
      }));
    }
  };

  // Load a village (fresh snow, its own weather) and continue in the given state
  const goToVillage = (i: number, state: GameState = 'playing') => {
    setVillageIndex(i);
    villageRef.current = i;
    applyWeather(VILLAGES[i].weather);
    worldRef.current?.loadVillage(VILLAGES[i]);
    setGameState(state);
  };

  // Camera Mode Toggle
  const handleToggleCamera = () => {
    if (worldRef.current) {
      const nextMode = worldRef.current.toggleCameraMode();
      setCameraMode(nextMode);
    }
  };

  // Sound Mute Toggle
  const handleToggleMute = () => {
    const nextMuted = soundEngine.toggleMute();
    setIsMuted(nextMuted);
  };

  const handleResetProgress = () => {
    if (!window.confirm('Reset all progress? Coins, upgrades and cleared villages will be lost.')) return;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // no storage
    }
    window.location.reload();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Screen 1: Title Screen */}
      {gameState === 'title' && (
        <TitleScreen
          onStart={startGame}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          villageLabel={`Village ${villageIndex + 1} of ${VILLAGES.length} · ${village.name}`}
          bestTime={best[villageIndex] ?? null}
          onResetProgress={handleResetProgress}
        />
      )}

      {/* Screen 2: Active Playing HUD */}
      {(gameState === 'playing' || gameState === 'paused') && (
        <GameHUD
          metrics={hudMetrics}
          upgrades={upgrades}
          villageName={village.name}
          weatherType={weatherType}
          cameraMode={cameraMode}
          isMuted={isMuted}
          onUpgrade={handleUpgrade}
          onToggleCamera={handleToggleCamera}
          onToggleMute={handleToggleMute}
          onPause={() => setGameState('paused')}
          onVirtualInput={(input) => inputRef.current?.setVirtualInput(input)}
        />
      )}

      {/* Modal: Pause State */}
      {gameState === 'paused' && (
        <PauseModal
          metrics={hudMetrics}
          isMuted={isMuted}
          onResume={() => setGameState('playing')}
          onRestart={() => goToVillage(villageIndex)}
          onTitle={() => setGameState('title')}
          onToggleMute={handleToggleMute}
        />
      )}

      {/* Modal: Victory / Village Cleared State */}
      {gameState === 'gameover' && (
        <VictoryModal
          metrics={hudMetrics}
          villageName={village.name}
          nextVillageName={VILLAGES[nextVillageIndex].name}
          isLastVillage={isLastVillage}
          bestTime={best[villageIndex] ?? null}
          onNext={() => goToVillage(nextVillageIndex)}
          onReplay={() => goToVillage(villageIndex)}
          onTitle={() => goToVillage(nextVillageIndex, 'title')}
        />
      )}
    </div>
  );
}
