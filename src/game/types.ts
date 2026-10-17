/**
 * FrostPlow: Cozy Snow Drifting - Type Definitions
 */

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type WeatherType = 'flurries' | 'sunny' | 'blizzard';

export interface WeatherConfig {
  type: WeatherType;
  label: string;
  description: string;
  snowParticleCount: number;
  windSpeed: number; // m/s
  windDirection: number; // angle in radians
  temperatureC: number;
  visibility: number; // fog density factor
  skyColor: number;
  fogColor: number;
  lightIntensity: number;
  windAudioVolume: number;
  snowfallRate: number; // fraction of the road re-covered per second (0 = snow stays cleared)
}

export interface UpgradeTier {
  level: number;
  maxLevel: number;
  cost: number;
  name: string;
  description: string;
  statLabel: string;
  statValue: string;
}

export interface UpgradesState {
  bladeWidth: number; // Levels 1-5 (plow clearing width)
  enginePower: number; // Levels 1-5 (top speed & acceleration)
  snowBlower: number; // Levels 0-4 (turbo snow ejection boost)
  saltSpreader: number; // Levels 0-4 (auto-clears snow trail behind)
}

export interface VehicleStats {
  maxSpeed: number;
  accel: number;
  turnSpeed: number;
  plowWidth: number; // in world units
  plowPower: number; // push capacity
  saltRadius: number; // 0 if locked
  hasBlower: boolean;
  blowerCooldown: number;
}

export interface GameMetrics {
  snowClearedSqM: number;
  totalSnowSqM: number;
  cleanPercent: number;
  coins: number;
  score: number;
  comboMultiplier: number;
  comboTimer: number; // seconds remaining
  maxCombo: number;
  shiftDurationSec: number;
  blowerCharge: number; // 0 to 1
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  boost: boolean;
  drift: boolean;
  action: boolean; // blower
}
