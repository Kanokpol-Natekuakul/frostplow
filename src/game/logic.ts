/**
 * FrostPlow: Pure gameplay logic and rules
 */
import type { UpgradesState, VehicleStats, UpgradeTier, WeatherType, WeatherConfig } from './types.ts';

export const MAX_UPGRADE_LEVEL = 5;
export const COMBO_MAX_TIMER = 2.5; // seconds to keep combo alive
export const MAX_COMBO_MULTIPLIER = 5.0;
export const AUTO_FINISH_RATIO = 0.98; // salt truck melts the last specks, nobody hunts single pixels
export const STORM_CALMS_AT = 90; // percent clean at which a blizzard eases to flurries

/** Visits every pixel whose centre lies inside the disc (clamped to the map). */
export function forEachInDisc(size: number, cx: number, cy: number, r: number, visit: (i: number) => void): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) visit(y * size + x);
    }
  }
}

/**
 * Clears a disc on the snow ledger (1 = road pixel still under snow, 0 = clear or off-road).
 * Calls `paint` for every pixel inside the disc and returns how many road pixels were newly cleared,
 * so driving over cleared road or open meadow earns nothing.
 */
export function clearSnowDisc(
  snow: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  r: number,
  paint?: (i: number) => void
): number {
  let cleared = 0;
  forEachInDisc(size, cx, cy, r, (i) => {
    if (snow[i]) {
      snow[i] = 0;
      cleared++;
    }
    paint?.(i);
  });
  return cleared;
}

export interface SaveData {
  coins: number;
  upgrades: UpgradesState;
  village: number; // index of the village being played
  best: (number | null)[]; // best clear time per village, seconds
}

export function newSave(): SaveData {
  return {
    coins: 20, // starting cozy pocket money
    upgrades: { bladeWidth: 1, enginePower: 1, saltSpreader: 0, snowBlower: 0 },
    village: 0,
    best: [],
  };
}

/** Reads a localStorage save; anything missing, corrupt or out of range falls back to a fresh value. */
export function parseSave(raw: string | null, villageCount: number): SaveData {
  const save = newSave();
  let data: Partial<SaveData>;
  try {
    data = JSON.parse(raw ?? 'null') ?? {};
  } catch {
    return save;
  }
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;

  save.coins = num(data.coins, 0, 1e9, save.coins);
  save.village = num(data.village, 0, villageCount - 1, 0);
  const up = (data.upgrades ?? {}) as Partial<UpgradesState>;
  save.upgrades = {
    bladeWidth: num(up.bladeWidth, 1, MAX_UPGRADE_LEVEL, 1),
    enginePower: num(up.enginePower, 1, MAX_UPGRADE_LEVEL, 1),
    saltSpreader: num(up.saltSpreader, 0, 4, 0),
    snowBlower: num(up.snowBlower, 0, 4, 0),
  };
  save.best = Array.isArray(data.best)
    ? data.best.slice(0, villageCount).map((t) => (typeof t === 'number' && t > 0 ? t : null))
    : [];
  return save;
}

/**
 * Calculates current vehicle mechanical stats based on purchased upgrades
 */
export function calculateVehicleStats(upgrades: UpgradesState): VehicleStats {
  const bladeLvl = Math.max(1, Math.min(MAX_UPGRADE_LEVEL, upgrades.bladeWidth));
  const engineLvl = Math.max(1, Math.min(MAX_UPGRADE_LEVEL, upgrades.enginePower));
  const blowerLvl = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, upgrades.snowBlower));
  const saltLvl = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, upgrades.saltSpreader));

  // Base plow width 2.4m, expands up to 4.4m
  const plowWidth = 2.0 + bladeLvl * 0.5;

  // Speed: base 10 m/s up to 18 m/s
  const maxSpeed = 8.5 + engineLvl * 2.0;
  const accel = 12.0 + engineLvl * 3.0;
  const turnSpeed = 2.2 + engineLvl * 0.25;

  // Salt spreader radius
  const saltRadius = saltLvl > 0 ? 1.0 + saltLvl * 0.8 : 0;

  // Blower
  const hasBlower = blowerLvl > 0;
  const blowerCooldown = Math.max(2.0, 7.0 - blowerLvl * 1.0);

  return {
    maxSpeed,
    accel,
    turnSpeed,
    plowWidth,
    plowPower: 1.0 + bladeLvl * 0.25,
    saltRadius,
    hasBlower,
    blowerCooldown,
  };
}

/**
 * Upgrade tier metadata and cost curve
 */
export function getUpgradeInfo(type: keyof UpgradesState, currentLevel: number): UpgradeTier {
  switch (type) {
    case 'bladeWidth': {
      const nextLvl = currentLevel + 1;
      const cost = Math.round(40 * Math.pow(1.9, currentLevel - 1));
      const widthVal = (2.0 + (currentLevel + 1) * 0.5).toFixed(1);
      return {
        level: currentLevel,
        maxLevel: MAX_UPGRADE_LEVEL,
        cost: currentLevel >= MAX_UPGRADE_LEVEL ? 0 : cost,
        name: 'Curved Steel Blade',
        description: 'Widens plow clearing span to push wider swathes of snow.',
        statLabel: 'Blade Span',
        statValue: currentLevel >= MAX_UPGRADE_LEVEL ? '4.5m (MAX)' : `${widthVal}m`,
      };
    }
    case 'enginePower': {
      const cost = Math.round(50 * Math.pow(2.0, currentLevel - 1));
      const speedVal = (8.5 + (currentLevel + 1) * 2.0).toFixed(0);
      return {
        level: currentLevel,
        maxLevel: MAX_UPGRADE_LEVEL,
        cost: currentLevel >= MAX_UPGRADE_LEVEL ? 0 : cost,
        name: 'Twin-Turbo Diesel',
        description: 'Increases plow speed, torque against heavy drifts, and drift steering.',
        statLabel: 'Top Speed',
        statValue: currentLevel >= MAX_UPGRADE_LEVEL ? '18.5 m/s (MAX)' : `${speedVal} m/s`,
      };
    }
    case 'saltSpreader': {
      const cost = currentLevel === 0 ? 80 : Math.round(90 * Math.pow(2.1, currentLevel));
      const rad = (1.0 + (currentLevel + 1) * 0.8).toFixed(1);
      return {
        level: currentLevel,
        maxLevel: 4,
        cost: currentLevel >= 4 ? 0 : cost,
        name: 'Heated Salt Spreader',
        description: 'Distributes eco-friendly brine salt to melt residual patches behind the plow.',
        statLabel: 'Salt Radius',
        statValue: currentLevel === 0 ? 'Locked' : currentLevel >= 4 ? '4.2m (MAX)' : `${rad}m`,
      };
    }
    case 'snowBlower': {
      const cost = currentLevel === 0 ? 100 : Math.round(120 * Math.pow(2.2, currentLevel));
      return {
        level: currentLevel,
        maxLevel: 4,
        cost: currentLevel >= 4 ? 0 : cost,
        name: 'Hydro-Jet Snow Cannon',
        description: 'Press [Space] to blast away forward snowdrifts in a jet of powdery spray.',
        statLabel: 'Blast Recharge',
        statValue: currentLevel === 0 ? 'Locked' : `${(7.0 - currentLevel * 1.0).toFixed(1)}s`,
      };
    }
  }
}

/**
 * Combo state machine
 * As long as player clears snow continuously, combo counter steps up:
 * 1.0x -> 1.5x -> 2.0x -> 2.5x -> 3.0x -> 4.0x -> 5.0x
 * `clearedSnowAmount` is the percent of the village's road snow cleared this frame.
 */
export function updateCombo(
  currentCombo: number,
  comboTimer: number,
  clearedSnowAmount: number,
  dt: number
): { combo: number; timer: number; steppedUp: boolean; broke: boolean } {
  let combo = currentCombo;
  let timer = comboTimer;
  let steppedUp = false;
  let broke = false;

  if (clearedSnowAmount > 0) {
    // Refresh timer
    timer = COMBO_MAX_TIMER;
    // +1.0x per 4% of the village cleared in one unbroken streak
    const nextCombo = Math.min(
      MAX_COMBO_MULTIPLIER,
      combo + clearedSnowAmount * 0.25
    );
    // Check if integer or half-step threshold reached
    if (Math.floor(nextCombo * 2) > Math.floor(combo * 2)) {
      steppedUp = true;
    }
    combo = nextCombo;
  } else {
    // Count down timer
    timer -= dt;
    if (timer <= 0) {
      if (combo > 1.0) {
        broke = true;
      }
      combo = 1.0;
      timer = 0;
    }
  }

  return { combo, timer, steppedUp, broke };
}

/**
 * Score and coin gains for `clearedAmount` percent of the village's road snow.
 * Fractional on purpose: per-frame amounts are tiny, so rounding here would make income depend on FPS.
 * The caller accumulates and pays out whole coins.
 */
export function calculateSnowPlowGain(
  clearedAmount: number,
  multiplier: number
): { scoreGain: number; coinsGain: number } {
  if (clearedAmount <= 0) return { scoreGain: 0, coinsGain: 0 };
  const effectiveMul = Math.max(1.0, multiplier);
  const scoreGain = clearedAmount * 10 * effectiveMul;
  // A whole village pays 400 coins at 1x (~1000 with a typical combo)
  const coinsGain = clearedAmount * 4 * effectiveMul;
  return { scoreGain, coinsGain };
}

/**
 * Percentage of village road cleared (0% to 100%), floored so the HUD never shows 100% early
 */
export function calculateCleanliness(clearedUnits: number, totalSnowUnits: number): number {
  if (totalSnowUnits <= 0) return 100;
  const ratio = clearedUnits / totalSnowUnits;
  return Math.min(100, Math.floor(ratio * 100));
}

/**
 * Weather presets configuration
 */
export const WEATHER_PRESETS: Record<WeatherType, WeatherConfig> = {
  flurries: {
    type: 'flurries',
    label: 'Gentle Flurries',
    description: 'Crisp winter morning with light, dancing snowflakes and pleasant visibility.',
    snowParticleCount: 1600,
    windSpeed: 2.5,
    windDirection: Math.PI * 0.2,
    temperatureC: -3,
    visibility: 0.007,
    skyColor: 0xd9e8f5,
    fogColor: 0xd2e1ee,
    lightIntensity: 1.4,
    windAudioVolume: 0.15,
    snowfallRate: 0,
  },
  sunny: {
    type: 'sunny',
    label: 'Alpine Sunlight',
    description: 'Golden winter sunshine reflecting off freshly groomed roads and chalet eaves.',
    snowParticleCount: 600,
    windSpeed: 1.0,
    windDirection: Math.PI * 0.1,
    temperatureC: 1,
    visibility: 0.004,
    skyColor: 0xbeddf7,
    fogColor: 0xd6eaff,
    lightIntensity: 1.9,
    windAudioVolume: 0.05,
    snowfallRate: 0,
  },
  blizzard: {
    type: 'blizzard',
    label: 'Mountain Blizzard',
    description: 'Swirling gale-force gusts, heavy snowdrifts, and howling winter winds!',
    snowParticleCount: 3800,
    windSpeed: 14.0,
    windDirection: Math.PI * 0.35,
    temperatureC: -12,
    visibility: 0.022,
    skyColor: 0x90a8bd,
    fogColor: 0x9bb0c4,
    lightIntensity: 0.9,
    windAudioVolume: 0.75,
    snowfallRate: 0.0008, // ~0.08% of the road per second drifts back over
  },
};

export function getWeatherPreset(type: WeatherType): WeatherConfig {
  return WEATHER_PRESETS[type] || WEATHER_PRESETS.flurries;
}
