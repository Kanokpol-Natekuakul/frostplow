import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVehicleStats,
  getUpgradeInfo,
  updateCombo,
  calculateSnowPlowGain,
  calculateCleanliness,
  clearSnowDisc,
  getWeatherPreset,
  newSave,
  parseSave,
} from './logic.ts';
import { layoutProps } from './villages.ts';

test('calculateVehicleStats returns correct initial and upgraded values', () => {
  const baseStats = calculateVehicleStats({
    bladeWidth: 1,
    enginePower: 1,
    snowBlower: 0,
    saltSpreader: 0,
  });

  assert.equal(baseStats.plowWidth, 2.5);
  assert.equal(baseStats.maxSpeed, 10.5);
  assert.equal(baseStats.hasBlower, false);
  assert.equal(baseStats.saltRadius, 0);

  const upgradedStats = calculateVehicleStats({
    bladeWidth: 4,
    enginePower: 3,
    snowBlower: 2,
    saltSpreader: 2,
  });

  assert.equal(upgradedStats.plowWidth, 4.0);
  assert.equal(upgradedStats.maxSpeed, 14.5);
  assert.equal(upgradedStats.hasBlower, true);
  assert.ok(upgradedStats.saltRadius > 2.0);
});

test('getUpgradeInfo computes progressive costs and stat labels', () => {
  const bladeTier1 = getUpgradeInfo('bladeWidth', 1);
  assert.equal(bladeTier1.level, 1);
  assert.equal(bladeTier1.cost, 40);

  const bladeTier5 = getUpgradeInfo('bladeWidth', 5);
  assert.equal(bladeTier5.cost, 0); // Maxed
  assert.ok(bladeTier5.statValue.includes('MAX'));

  const blowerLocked = getUpgradeInfo('snowBlower', 0);
  assert.equal(blowerLocked.statValue, 'Locked');
  assert.equal(blowerLocked.cost, 100);
});

test('updateCombo steps up with plowing and decays with inactivity', () => {
  // 2% of the village in one streak crosses the first 1.5x tier
  const initial = updateCombo(1.0, 0, 2, 0.016);
  assert.equal(initial.combo, 1.5);
  assert.equal(initial.steppedUp, true);
  assert.ok(initial.timer > 2.0);

  // Inactivity decay
  const decayed = updateCombo(2.5, 0.1, 0, 0.2);
  assert.equal(decayed.combo, 1.0);
  assert.equal(decayed.timer, 0);
  assert.equal(decayed.broke, true);
});

test('calculateSnowPlowGain factors in multiplier', () => {
  const gain1 = calculateSnowPlowGain(10, 1.0);
  assert.equal(gain1.scoreGain, 100);

  const gain2 = calculateSnowPlowGain(10, 3.0);
  assert.equal(gain2.scoreGain, 300);
  assert.ok(gain2.coinsGain >= gain1.coinsGain);

  const zeroGain = calculateSnowPlowGain(0, 5.0);
  assert.equal(zeroGain.scoreGain, 0);
  assert.equal(zeroGain.coinsGain, 0);

  // Tiny per-frame amounts still pay (rounding them away made income depend on FPS)
  assert.ok(calculateSnowPlowGain(0.01, 1.0).coinsGain > 0);
});

test('clearSnowDisc pays only for road snow that is still there', () => {
  const size = 32;
  const snow = new Uint8Array(size * size);
  snow.fill(1, 16 * size, 17 * size); // one road row at y = 16

  assert.equal(clearSnowDisc(snow, size, 10, 16.5, 3), 6);
  assert.equal(clearSnowDisc(snow, size, 10, 16.5, 3), 0); // same spot again: nothing left
  assert.equal(clearSnowDisc(snow, size, 10, 5, 3), 0); // meadow: no road snow
  assert.equal(clearSnowDisc(snow, size, -50, -50, 3), 0); // off the map
});

test('calculateCleanliness scales cleanly to 100%', () => {
  assert.equal(calculateCleanliness(0, 1000), 0);
  assert.equal(calculateCleanliness(500, 1000), 50);
  assert.equal(calculateCleanliness(999, 1000), 99); // never shows 100% before it is
  assert.equal(calculateCleanliness(1000, 1000), 100);
  assert.equal(calculateCleanliness(1200, 1000), 100);
});

test('parseSave survives missing, corrupt and out-of-range saves', () => {
  assert.deepEqual(parseSave(null, 3), newSave());
  assert.deepEqual(parseSave('{not json', 3), newSave());

  const s = parseSave(
    JSON.stringify({ coins: 512.7, village: 99, upgrades: { bladeWidth: 9, snowBlower: -2 }, best: [61.5, 'x', -3] }),
    3
  );
  assert.equal(s.coins, 512);
  assert.equal(s.village, 2); // clamped to the last village
  assert.equal(s.upgrades.bladeWidth, 5);
  assert.equal(s.upgrades.snowBlower, 0);
  assert.equal(s.upgrades.enginePower, 1); // missing -> default
  assert.deepEqual(s.best, [61.5, null, null]);
});

test('layoutProps keeps every prop off the road and is stable per seed', () => {
  const size = 512; // the game's snow-map resolution
  const worldSize = 90;
  const m = worldSize / size;
  const road = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(x - 256) < 24 || Math.abs(y - 256) < 24) road[y * size + x] = 1; // a crossroads
    }
  }
  const roadXZ: [number, number][] = [];
  road.forEach((v, i) => v && roadXZ.push([((i % size) + 0.5) * m - 45, (Math.floor(i / size) + 0.5) * m - 45]));
  const gap = (p: { x: number; z: number }) => Math.min(...roadXZ.map(([x, z]) => Math.hypot(x - p.x, z - p.z)));

  const layout = layoutProps(road, size, worldSize, 7);
  assert.ok(layout.chalets.length > 0 && layout.trees.length > 0 && layout.lamps.length > 0);
  // chamfer distance overestimates Euclid by up to ~8%
  layout.chalets.forEach((c) => assert.ok(gap(c) >= 4.8 * 0.9, `chalet ${gap(c).toFixed(2)}m from road`));
  layout.trees.forEach((t) => assert.ok(gap(t) >= 3 * 0.9, `tree ${gap(t).toFixed(2)}m from road`));
  layout.lamps.forEach((l) => assert.ok(gap(l) >= 1.2 * 0.9, `lamp ${gap(l).toFixed(2)}m from road`));
  assert.deepEqual(layoutProps(road, size, worldSize, 7), layout);
});

test('getWeatherPreset returns valid presets', () => {
  const flurries = getWeatherPreset('flurries');
  assert.equal(flurries.type, 'flurries');
  assert.ok(flurries.snowParticleCount > 1000);

  const blizzard = getWeatherPreset('blizzard');
  assert.equal(blizzard.type, 'blizzard');
  assert.ok(blizzard.windSpeed > flurries.windSpeed);
  assert.ok(blizzard.visibility > flurries.visibility);
});
