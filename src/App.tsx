/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { GameState, UpgradesState, VehicleStats, WeatherType, GameMetrics } from './game/types.ts';
import { calculateVehicleStats, getWeatherPreset, getUpgradeInfo } from './game/logic.ts';
import { SnowWorld } from './game/world.ts';
import { createInputHub, InputHub } from './game/input.ts';
import { soundEngine } from './game/audio.ts';
import { TitleScreen } from './components/TitleScreen.tsx';
import { GameHUD } from './components/GameHUD.tsx';
import { PauseModal } from './components/PauseModal.tsx';
import { VictoryModal } from './components/VictoryModal.tsx';

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SnowWorld | null>(null);
  const inputRef = useRef<InputHub | null>(null);

  // Game State Machine
  const [gameState, setGameState] = useState<GameState>('title');
  const gameStateRef = useRef<GameState>('title');
  gameStateRef.current = gameState;

  // Upgrades State
  const [upgrades, setUpgrades] = useState<UpgradesState>({
    bladeWidth: 1,
    enginePower: 1,
    saltSpreader: 0,
    snowBlower: 0,
  });

  // Weather State
  const [weatherType, setWeatherType] = useState<WeatherType>('flurries');

  // Camera Mode State
  const [cameraMode, setCameraMode] = useState<'isometric' | 'close' | 'top'>('isometric');

  // Audio Mute State
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Throttled HUD metrics
  const [hudMetrics, setHudMetrics] = useState<GameMetrics>({
    snowClearedSqM: 0,
    totalSnowSqM: 100,
    cleanPercent: 0,
    coins: 20, // Starting cozy pocket money
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
      {
        onMetricsUpdate: (newMetrics) => {
          const now = performance.now();
          // Throttle React state updates to ~10Hz to preserve 60FPS simulation
          if (now - lastMetricsPush > 90) {
            lastMetricsPush = now;
            setHudMetrics((prev) => ({ ...prev, ...newMetrics }));
          }

          // Trigger victory if roads hit 100%
          if (newMetrics.cleanPercent && newMetrics.cleanPercent >= 100 && gameStateRef.current === 'playing') {
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
    world.addCoins(20); // Grant starter coins

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

  // Weather Change Handler
  const handleSetWeather = (type: WeatherType) => {
    setWeatherType(type);
    const preset = getWeatherPreset(type);
    worldRef.current?.setWeather(preset);
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

  // Restart Run
  const handleRestart = () => {
    worldRef.current?.resetRun();
    setGameState('playing');
  };

  // Return to Title
  const handleTitle = () => {
    setGameState('title');
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
        />
      )}

      {/* Screen 2: Active Playing HUD */}
      {(gameState === 'playing' || gameState === 'paused') && (
        <GameHUD
          metrics={hudMetrics}
          upgrades={upgrades}
          weatherType={weatherType}
          cameraMode={cameraMode}
          isMuted={isMuted}
          onUpgrade={handleUpgrade}
          onSetWeather={handleSetWeather}
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
          onRestart={handleRestart}
          onTitle={handleTitle}
          onToggleMute={handleToggleMute}
        />
      )}

      {/* Modal: Victory / Village Cleared State */}
      {gameState === 'gameover' && (
        <VictoryModal
          metrics={hudMetrics}
          onPlayAgain={handleRestart}
          onTitle={handleTitle}
        />
      )}
    </div>
  );
}
