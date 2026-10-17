/**
 * FrostPlow: 3D Isometric World, Procedural Assets, Weather & Simulation
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { WeatherConfig, VehicleStats, GameMetrics } from './types.ts';
import { soundEngine } from './audio.ts';
import { layoutProps, roadDistance, type RoadStroke, type VillageDef } from './villages.ts';
import {
  AUTO_FINISH_RATIO,
  forEachInDisc,
  WEATHER_PRESETS,
  calculateCleanliness,
  calculateSnowPlowGain,
  clearSnowDisc,
  updateCombo,
} from './logic.ts';

export interface DriveInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  stickX?: number; // touch joystick, screen space -1..1 (y down)
  stickY?: number;
}

export interface WorldCallbacks {
  onMetricsUpdate: (metrics: Partial<GameMetrics>) => void;
  onComboStepped: (combo: number) => void;
}

export class SnowWorld {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animId: number = 0;
  private lastTime: number = 0;

  // Camera settings
  private cameraMode: 'isometric' | 'close' | 'top' = 'isometric';
  private cameraTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private cameraOffset: THREE.Vector3 = new THREE.Vector3(26, 28, 26);
  private isTitleTour: boolean = true;
  private tourAngle: number = 0;

  // Vehicle
  public vehicleGroup!: THREE.Group;
  private bladeMesh!: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private beaconLight!: THREE.PointLight;
  private beaconMesh!: THREE.Mesh;
  private headlightLeft!: THREE.SpotLight;
  private headlightRight!: THREE.SpotLight;
  private contactShadow!: THREE.Mesh;

  // Vehicle Physics state
  public vehiclePos: THREE.Vector3 = new THREE.Vector3(0, 0.4, 0);
  public vehicleHeading: number = 0; // radians
  public vehicleSpeed: number = 0; // m/s
  public vehicleSteer: number = 0;
  private stats: VehicleStats;

  // Weather & Snow particles
  private weather: WeatherConfig;
  private snowParticles!: THREE.Points;
  private snowPositions!: Float32Array;
  private snowVelocities!: Float32Array;
  private snowCount = Math.max(...Object.values(WEATHER_PRESETS).map((w) => w.snowParticleCount)); // pool for the heaviest weather

  // Snow Spray / Blower Particle Pool
  private sprayParticles!: THREE.InstancedMesh;
  private sprayCount = 180;
  private sprayData: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; scale: number }[] = [];
  private sprayDummy = new THREE.Object3D();

  // Chimney Smoke Particles
  private smokeParticles: { pos: THREE.Vector3; basePos: THREE.Vector3; life: number; maxLife: number }[] = [];
  private smokeInstancedMesh!: THREE.InstancedMesh;
  private smokeDummy = new THREE.Object3D();

  // Snow Clearance Canvas & Texture
  private snowCanvas!: HTMLCanvasElement;
  private snowCtx!: CanvasRenderingContext2D;
  private snowTexture!: THREE.CanvasTexture;
  private groundPlane!: THREE.Mesh;
  private readonly WORLD_SIZE = 90; // meters
  private readonly CANVAS_RES = 512; // resolution of snow map
  private totalRoadPixels: number = 0;
  private clearedRoadPixels: number = 0;
  private roadMaskCanvas!: HTMLCanvasElement;
  private roadMaskCtx!: CanvasRenderingContext2D;
  private roadMask = new Uint8Array(this.CANVAS_RES * this.CANVAS_RES); // 1 = road pixel
  private snowLeft = new Uint8Array(this.CANVAS_RES * this.CANVAS_RES); // 1 = road pixel still under snow
  private snowImage!: ImageData; // CPU copy of snowCanvas, painted per pixel
  private freshPixels = 0; // road snow cleared since the last update (plow, salt, blower)
  private coinBank = 0; // fractional coins not yet paid out
  private plowingTimer = 0; // keeps crunch audio and spray steady across sub-pixel frames

  // Game Metrics
  private metrics: GameMetrics = {
    snowClearedSqM: 0,
    totalSnowSqM: 1,
    cleanPercent: 0,
    coins: 0,
    score: 0,
    comboMultiplier: 1.0,
    comboTimer: 0,
    maxCombo: 1.0,
    shiftDurationSec: 0,
    blowerCharge: 1.0,
  };
  private callbacks: WorldCallbacks;

  // Lights & Environment
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private lowQuality: boolean = false; // phones, headless and software GL: no shadows, no AA, capped pixel ratio

  // Village layout
  private propsGroup = new THREE.Group();
  private roadPixels = new Int32Array(0); // indices of every road pixel, for blizzard drift
  private roadDist: Float32Array = new Float32Array(0); // pixels from the nearest road, for the snowbank edge
  private spawn = { x: 0, z: 0, heading: 0 };
  private villagePay = 1; // coin multiplier of the current village
  private snowfallBank = 0; // road pixels owed to the blizzard
  private tmpDir = new THREE.Vector3();
  private readonly MAX_SMOKE = 48;

  constructor(
    container: HTMLElement,
    initialStats: VehicleStats,
    initialWeather: WeatherConfig,
    village: VillageDef,
    callbacks: WorldCallbacks
  ) {
    this.container = container;
    this.stats = initialStats;
    this.weather = initialWeather;
    this.callbacks = callbacks;

    this.lowQuality =
      navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches;

    // Three.js Scene Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.weather.skyColor);
    this.scene.fog = new THREE.FogExp2(this.weather.fogColor, this.weather.visibility);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.lowQuality,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    // Software GL (SwiftShader/llvmpipe) gets the low tier too: pick quality from the GPU, not the CPU
    const gl = this.renderer.getContext();
    const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (gpuInfo && /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)))) {
      this.lowQuality = true;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowQuality ? 1.5 : 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    if (!this.lowQuality) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    container.appendChild(this.renderer.domElement);

    // Camera
    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.5, 300);
    this.camera.position.set(30, 32, 30);
    this.camera.lookAt(0, 0, 0);

    // Room Environment for PBR metallic sheen
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      // Ignore if WebGL context limitations
    }

    // Build World Elements
    this.setupLighting();
    this.villagePay = village.pay;
    this.setupSnowDeformationGround(village);
    this.scene.add(this.propsGroup);
    this.buildVillageProps(village.seed);
    this.buildVehicle();
    this.vehiclePos.set(this.spawn.x, 0.4, this.spawn.z);
    this.vehicleHeading = this.spawn.heading;
    this.updateVehicleTransform();
    this.cameraTarget.copy(this.vehiclePos);
    this.setupSnowfall();
    this.setupSprayParticles();
    this.setupSmokeParticles();

    // Resize listener
    window.addEventListener('resize', this.onWindowResize);

    // Compile & Warm shaders
    this.renderer.compile(this.scene, this.camera);

    // Start Loop
    this.lastTime = performance.now();
    this.animate();
  }

  private setupLighting(): void {
    // Hemisphere ambient light (cool sky, warm ground bounce)
    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x826d58, 0.95);
    this.scene.add(this.hemiLight);

    // Directional Key Sun Light
    this.sunLight = new THREE.DirectionalLight(0xfffaed, this.weather.lightIntensity);
    this.sunLight.position.set(35, 50, 35);
    if (!this.lowQuality) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.width = 1024;
      this.sunLight.shadow.mapSize.height = 1024;
      this.sunLight.shadow.camera.near = 10;
      this.sunLight.shadow.camera.far = 130;
      const d = 48;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.bias = -0.0006;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunLight);
  }

  /**
   * Procedural Ground with real-time dynamic plowing snow canvas
   */
  private setupSnowDeformationGround(village: VillageDef): void {
    // Create Snow Canvas
    this.snowCanvas = document.createElement('canvas');
    this.snowCanvas.width = this.CANVAS_RES;
    this.snowCanvas.height = this.CANVAS_RES;
    this.snowCtx = this.snowCanvas.getContext('2d')!;

    // Create Road Mask Canvas
    this.roadMaskCanvas = document.createElement('canvas');
    this.roadMaskCanvas.width = this.CANVAS_RES;
    this.roadMaskCanvas.height = this.CANVAS_RES;
    this.roadMaskCtx = this.roadMaskCanvas.getContext('2d')!;

    // Draw Road Network on Road Mask
    this.drawRoadNetwork(this.roadMaskCtx, village.roads);

    // Fill Snow Canvas: Where roads are, draw fresh white fluffy snow!
    this.resetSnow();

    // CanvasTexture for ground
    this.snowTexture = new THREE.CanvasTexture(this.snowCanvas);
    this.snowTexture.colorSpace = THREE.SRGBColorSpace;
    this.snowTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.snowTexture.minFilter = THREE.LinearFilter;
    this.snowTexture.magFilter = THREE.LinearFilter;

    // Ground Plane Geometry
    const groundGeo = new THREE.PlaneGeometry(this.WORLD_SIZE, this.WORLD_SIZE, 64, 64);
    groundGeo.rotateX(-Math.PI / 2);

    const groundMat = new THREE.MeshStandardMaterial({
      map: this.snowTexture,
      roughness: 0.85,
      metalness: 0.05,
    });

    this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
    this.groundPlane.receiveShadow = !this.lowQuality;
    this.scene.add(this.groundPlane);

    // Perimeter Natural Mountain Berms & Snow Banks
    this.buildPerimeterHills();
  }

  private drawRoadNetwork(ctx: CanvasRenderingContext2D, roads: RoadStroke[]): void {
    const W = this.CANVAS_RES;

    // Background is non-road; roads are white strokes of SVG paths in a 0-100 map space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, W);
    ctx.setTransform(W / 100, 0, 0, W / 100, 0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const road of roads) {
      ctx.lineWidth = road.width;
      ctx.stroke(new Path2D(road.d));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Count road pixels for coverage metrics and keep the mask for the snow ledger
    const imgData = ctx.getImageData(0, 0, W, W);
    const roadIdx: number[] = [];
    for (let p = 0; p < this.roadMask.length; p++) {
      this.roadMask[p] = imgData.data[p * 4] > 100 ? 1 : 0;
      if (this.roadMask[p]) roadIdx.push(p);
    }
    this.roadPixels = Int32Array.from(roadIdx);
    this.roadDist = roadDistance(this.roadMask, W);
    this.totalRoadPixels = roadIdx.length;
    this.metrics.totalSnowSqM = Math.round(this.totalRoadPixels * (this.WORLD_SIZE / W) ** 2);

    // Spawn on the road pixel nearest the map centre, facing the longest stretch of road
    let best = roadIdx[0];
    let bestD = Infinity;
    for (const p of roadIdx) {
      const d = (p % W - W / 2) ** 2 + (Math.floor(p / W) - W / 2) ** 2;
      if (d < bestD) [best, bestD] = [p, d];
    }
    const sx = best % W;
    const sy = Math.floor(best / W);
    let heading = 0;
    let longest = -1;
    for (let k = 0; k < 16; k++) {
      const h = (k / 16) * Math.PI * 2;
      let run = 0;
      while (run < 80) {
        const x = Math.round(sx + Math.sin(h) * run);
        const y = Math.round(sy + Math.cos(h) * run);
        if (x < 0 || y < 0 || x >= W || y >= W || !this.roadMask[y * W + x]) break;
        run++;
      }
      if (run > longest) [heading, longest] = [h, run];
    }
    const m = this.WORLD_SIZE / W;
    this.spawn = { x: (sx + 0.5) * m - this.WORLD_SIZE / 2, z: (sy + 0.5) * m - this.WORLD_SIZE / 2, heading };
  }

  private resetSnow(): void {
    const W = this.CANVAS_RES;
    const H = this.CANVAS_RES;

    // Base ground: snowy alpine meadows with warm subtle stone/dirt
    this.snowCtx.fillStyle = '#eaf2fa';
    this.snowCtx.fillRect(0, 0, W, H);

    // Add subtle procedural noise/drifts to ground
    for (let i = 0; i < 4000; i++) {
      const rx = Math.random() * W;
      const ry = Math.random() * H;
      const r = Math.random() * 3 + 1;
      this.snowCtx.fillStyle = Math.random() > 0.5 ? '#fcfdff' : '#dbe8f5';
      this.snowCtx.beginPath();
      this.snowCtx.arc(rx, ry, r, 0, Math.PI * 2);
      this.snowCtx.fill();
    }

    // On top of roads: draw fresh deep powder snow (slightly elevated visual brightness)
    const snowData = this.snowCtx.getImageData(0, 0, W, H);
    for (let p = 0; p < this.roadMask.length; p++) {
      const d = this.roadDist[p];
      if (!this.roadMask[p] && d <= 5) {
        // Blue snowbank shadow along every road, so the layout reads before it is plowed
        const t = (d - 1) / 4;
        snowData.data[p * 4] = 178 + (snowData.data[p * 4] - 178) * t;
        snowData.data[p * 4 + 1] = 198 + (snowData.data[p * 4 + 1] - 198) * t;
        snowData.data[p * 4 + 2] = 222 + (snowData.data[p * 4 + 2] - 222) * t;
      }
      if (this.roadMask[p]) {
        snowData.data[p * 4] = 248;     // R
        snowData.data[p * 4 + 1] = 252; // G
        snowData.data[p * 4 + 2] = 255; // B
      }
    }
    this.snowCtx.putImageData(snowData, 0, 0);
    this.snowImage = snowData;
    this.snowLeft.set(this.roadMask);
    this.clearedRoadPixels = 0;
    this.freshPixels = 0;
    if (this.snowTexture) this.snowTexture.needsUpdate = true;
  }

  private buildPerimeterHills(): void {
    // Low-poly snowy mountain ridges bounding the perimeter so scene never looks floating
    const hillMat = new THREE.MeshStandardMaterial({
      color: 0xe6eff8,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });

    const half = this.WORLD_SIZE * 0.5;
    const hillGeo = new THREE.ConeGeometry(12, 10, 5);

    const hillPositions = [
      [-half - 2, 0, -20], [-half - 4, 0, 15], [half + 3, 0, -10], [half + 2, 0, 25],
      [-25, 0, -half - 3], [15, 0, -half - 5], [-10, 0, half + 3], [25, 0, half + 4],
      [-half, 0, -half], [half, 0, -half], [-half, 0, half], [half, 0, half],
    ];

    hillPositions.forEach(([x, , z]) => {
      const hill = new THREE.Mesh(hillGeo, hillMat);
      hill.position.set(x, 4.5, z);
      const s = 1.2 + Math.random() * 0.6;
      hill.scale.set(s, s * 0.9, s);
      hill.rotation.y = Math.random() * Math.PI;
      hill.receiveShadow = !this.lowQuality;
      this.scene.add(hill);
    });
  }

  /**
   * Procedural village props laid out from the road mask: chalets, pines, streetlamps and a snowman
   */
  private buildVillageProps(seed: number): void {
    this.clearProps();
    const layout = layoutProps(this.roadMask, this.CANVAS_RES, this.WORLD_SIZE, seed);

    // 1. Cozy Alpine Cottages, doors to the road
    layout.chalets.forEach(({ x, z, rot }) => {
      const chalet = this.createProceduralChalet();
      chalet.position.set(x, 0, z);
      chalet.rotation.y = rot;
      this.propsGroup.add(chalet);

      // The chimney sits at (1.2, 0.8) in the chalet's own x/z, so rotate that offset with the house
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const chimneyWorldPos = new THREE.Vector3(x + 1.2 * c + 0.8 * s, 5.2, z - 1.2 * s + 0.8 * c);
      for (let k = 0; k < 4; k++) {
        this.smokeParticles.push({
          pos: chimneyWorldPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, k * 0.4, (Math.random() - 0.5) * 0.2)),
          basePos: chimneyWorldPos.clone(),
          life: Math.random() * 2.0,
          maxLife: 2.5,
        });
      }
    });
    if (this.smokeInstancedMesh) this.smokeInstancedMesh.count = this.smokeParticles.length;

    // 2. Pine Trees with Snow Clumps
    const treeMatTrunk = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.85 });
    const treeMatFoliage = new THREE.MeshStandardMaterial({ color: 0x224933, roughness: 0.75, flatShading: true });
    const treeMatSnow = new THREE.MeshStandardMaterial({ color: 0xf5f9ff, roughness: 0.8, flatShading: true });
    layout.trees.forEach(({ x, z }) => {
      const tree = this.createProceduralPineTree(treeMatTrunk, treeMatFoliage, treeMatSnow);
      tree.position.set(x, 0, z);
      const sc = 0.8 + Math.random() * 0.4;
      tree.scale.set(sc, sc, sc);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.propsGroup.add(tree);
    });

    // 3. Vintage Iron Streetlamps with Warm Amber Point Lights
    layout.lamps.forEach(({ x, z }) => {
      const lamp = this.createProceduralStreetlamp();
      lamp.position.set(x, 0, z);
      this.propsGroup.add(lamp);
      const warmLight = new THREE.PointLight(0xffae42, 1.3, 11, 1.8);
      warmLight.position.set(x, 3.4, z);
      this.propsGroup.add(warmLight);
    });

    // 4. Village snowman
    const villageSnowman = this.createSnowman();
    villageSnowman.position.set(layout.snowman.x, 0, layout.snowman.z);
    villageSnowman.scale.set(1.4, 1.4, 1.4);
    this.propsGroup.add(villageSnowman);
  }

  private clearProps(): void {
    this.propsGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mat) => mat.dispose());
    });
    this.propsGroup.clear();
    this.smokeParticles.length = 0;
  }

  /** Swaps in another village: roads, props and a fresh run. */
  public loadVillage(village: VillageDef): void {
    this.villagePay = village.pay;
    this.drawRoadNetwork(this.roadMaskCtx, village.roads);
    this.buildVillageProps(village.seed);
    this.resetRun();
  }

  private createProceduralChalet(): THREE.Group {
    const group = new THREE.Group();

    // 1. Foundation Base (Stone)
    const baseGeo = new THREE.BoxGeometry(5.4, 0.7, 4.4);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x6e757d, roughness: 0.9 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.35;
    baseMesh.castShadow = !this.lowQuality;
    baseMesh.receiveShadow = !this.lowQuality;
    group.add(baseMesh);

    // 2. Timber Log Walls
    const wallGeo = new THREE.BoxGeometry(5.0, 2.8, 4.0);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a5229, roughness: 0.7 });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.y = 2.1;
    wallMesh.castShadow = !this.lowQuality;
    wallMesh.receiveShadow = !this.lowQuality;
    group.add(wallMesh);

    // 3. Steep Pitched Roof (Brown wood underside)
    const roofGeo = new THREE.ConeGeometry(3.8, 2.2, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x543219, roughness: 0.75 });
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.y = 4.4;
    roofMesh.scale.set(1.1, 1.0, 0.9);
    roofMesh.castShadow = !this.lowQuality;
    group.add(roofMesh);

    // 4. Thick Fluffy Snow Drift on Roof
    const snowCapGeo = new THREE.ConeGeometry(3.9, 2.1, 4);
    snowCapGeo.rotateY(Math.PI / 4);
    const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xfafcff, roughness: 0.85 });
    const snowCapMesh = new THREE.Mesh(snowCapGeo, snowCapMat);
    snowCapMesh.position.y = 4.55;
    snowCapMesh.scale.set(1.12, 1.0, 0.92);
    snowCapMesh.castShadow = !this.lowQuality;
    group.add(snowCapMesh);

    // 5. Chimney with Brick Texture
    const chimneyGeo = new THREE.BoxGeometry(0.7, 2.2, 0.7);
    const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x874335, roughness: 0.85 });
    const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
    chimney.position.set(1.2, 4.6, 0.8);
    chimney.castShadow = !this.lowQuality;
    group.add(chimney);

    // 6. Glowing Amber Windows
    const winGeo = new THREE.PlaneGeometry(0.9, 0.9);
    const winMat = new THREE.MeshStandardMaterial({
      color: 0xffdf78,
      emissive: 0xffaa22,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });

    // Front Window
    const win1 = new THREE.Mesh(winGeo, winMat);
    win1.position.set(1.2, 2.2, 2.02);
    group.add(win1);

    // Front Door
    const doorGeo = new THREE.PlaneGeometry(0.9, 1.6);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x482b17, roughness: 0.8 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(-1.0, 1.5, 2.02);
    group.add(door);

    return group;
  }

  private createProceduralPineTree(
    trunkMat: THREE.Material,
    foliageMat: THREE.Material,
    snowMat: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.0, 6);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.0;
    trunk.castShadow = !this.lowQuality;
    group.add(trunk);

    // 3 Tiered Cones for Foliage + Snow
    const tiers = [
      { y: 2.2, rad: 2.2, h: 2.0 },
      { y: 3.5, rad: 1.7, h: 1.8 },
      { y: 4.6, rad: 1.2, h: 1.5 },
    ];

    tiers.forEach((t) => {
      // Green Pine Cone
      const fGeo = new THREE.ConeGeometry(t.rad, t.h, 7);
      const fMesh = new THREE.Mesh(fGeo, foliageMat);
      fMesh.position.y = t.y;
      fMesh.castShadow = !this.lowQuality;
      group.add(fMesh);

      // Snow Cap on Tier
      const sGeo = new THREE.ConeGeometry(t.rad * 0.95, t.h * 0.6, 7);
      const sMesh = new THREE.Mesh(sGeo, snowMat);
      sMesh.position.y = t.y + 0.28;
      sMesh.castShadow = !this.lowQuality;
      group.add(sMesh);
    });

    return group;
  }

  private createProceduralStreetlamp(): THREE.Group {
    const group = new THREE.Group();

    const ironMat = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.4, metalness: 0.7 });
    const lanternGlass = new THREE.MeshStandardMaterial({
      color: 0xffea9f,
      emissive: 0xffb84d,
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });

    // Base & Post
    const postGeo = new THREE.CylinderGeometry(0.08, 0.14, 3.2, 8);
    const post = new THREE.Mesh(postGeo, ironMat);
    post.position.y = 1.6;
    post.castShadow = !this.lowQuality;
    group.add(post);

    // Lantern Head
    const headGeo = new THREE.CylinderGeometry(0.22, 0.15, 0.4, 6);
    const head = new THREE.Mesh(headGeo, lanternGlass);
    head.position.y = 3.35;
    group.add(head);

    // Lantern Roof with tiny snow cap
    const capGeo = new THREE.ConeGeometry(0.32, 0.25, 6);
    const cap = new THREE.Mesh(capGeo, ironMat);
    cap.position.y = 3.65;
    group.add(cap);

    return group;
  }

  private createSnowman(): THREE.Group {
    const group = new THREE.Group();
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf5f8fc, roughness: 0.85 });

    // 3 Snow spheres
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 10), snowMat);
    b1.position.y = 0.75;
    b1.castShadow = !this.lowQuality;
    group.add(b1);

    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), snowMat);
    b2.position.y = 1.7;
    b2.castShadow = !this.lowQuality;
    group.add(b2);

    const b3 = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), snowMat);
    b3.position.y = 2.4;
    b3.castShadow = !this.lowQuality;
    group.add(b3);

    // Carrot Nose
    const carrotGeo = new THREE.ConeGeometry(0.08, 0.35, 6);
    carrotGeo.rotateX(Math.PI / 2);
    const carrotMat = new THREE.MeshStandardMaterial({ color: 0xed6c18, roughness: 0.6 });
    const nose = new THREE.Mesh(carrotGeo, carrotMat);
    nose.position.set(0, 2.4, 0.45);
    group.add(nose);

    // Top Hat
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.6 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12), hatMat);
    brim.position.y = 2.75;
    group.add(brim);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.45, 12), hatMat);
    crown.position.y = 3.0;
    group.add(crown);

    return group;
  }

  /**
   * Hero Snow Plow Vehicle: 10-part procedural model
   */
  private buildVehicle(): void {
    this.vehicleGroup = new THREE.Group();

    // 1. Chassis / Lower frame
    const chassisGeo = new THREE.BoxGeometry(1.6, 0.45, 3.2);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x343a40,
      roughness: 0.5,
      metalness: 0.7,
    });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = 0.45;
    chassis.castShadow = !this.lowQuality;
    this.vehicleGroup.add(chassis);

    // 2. Main Cabin (Bright Safety Orange-Yellow)
    const cabinGeo = new THREE.BoxGeometry(1.4, 1.25, 1.8);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Amber-yellow safety plow paint
      roughness: 0.35,
      metalness: 0.25,
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.2, -0.2);
    cabin.castShadow = !this.lowQuality;
    this.vehicleGroup.add(cabin);

    // 3. Cabin Panoramic Glass (Dark glossy glass with cyan tint)
    const glassGeo = new THREE.BoxGeometry(1.42, 0.55, 1.2);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughness: 0.1,
      metalness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, 1.35, -0.15);
    this.vehicleGroup.add(glass);

    // 4. White Cabin Roof Cap
    const roofGeo = new THREE.BoxGeometry(1.46, 0.12, 1.85);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 1.88, -0.2);
    this.vehicleGroup.add(roof);

    // 5. Rotating Amber Hazard Beacon on Roof
    const beaconGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.2, 10);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xffa500,
      emissive: 0xff7700,
      emissiveIntensity: 1.5,
    });
    this.beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    this.beaconMesh.position.set(0, 2.02, -0.2);
    this.vehicleGroup.add(this.beaconMesh);

    this.beaconLight = new THREE.PointLight(0xff9900, 1.2, 6, 2);
    this.beaconLight.position.set(0, 2.1, -0.2);
    this.vehicleGroup.add(this.beaconLight);

    // 6. Curved Steel Snow Plow Blade (Front)
    this.updatePlowBladeGeometry();

    // 7. Heavy-Duty Snow Tread Wheels (4x)
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.3, metalness: 0.8 });

    const wheelOffsets = [
      { x: -0.9, y: 0.42, z: 1.0 }, // Front Left
      { x: 0.9, y: 0.42, z: 1.0 },  // Front Right
      { x: -0.9, y: 0.42, z: -1.0 }, // Rear Left
      { x: 0.9, y: 0.42, z: -1.0 },  // Rear Right
    ];

    this.wheels = [];
    wheelOffsets.forEach((off) => {
      const wheelHub = new THREE.Group();
      wheelHub.position.set(off.x, off.y, off.z);

      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.castShadow = !this.lowQuality;
      wheelHub.add(tire);

      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.38, 12).rotateZ(Math.PI / 2), rimMat);
      wheelHub.add(rim);

      this.vehicleGroup.add(wheelHub);
      this.wheels.push(tire);
    });

    // 8. Front Headlights with Spotlights
    const lensGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10).rotateX(Math.PI / 2);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfffedb,
      emissiveIntensity: 2.0,
    });

    const hlLeftMesh = new THREE.Mesh(lensGeo, lensMat);
    hlLeftMesh.position.set(-0.5, 0.85, 1.62);
    this.vehicleGroup.add(hlLeftMesh);

    const hlRightMesh = new THREE.Mesh(lensGeo, lensMat);
    hlRightMesh.position.set(0.5, 0.85, 1.62);
    this.vehicleGroup.add(hlRightMesh);

    // Warm Spotlights aimed ahead
    this.headlightLeft = new THREE.SpotLight(0xfff7d6, 2.5, 20, Math.PI * 0.22, 0.4);
    this.headlightLeft.position.set(-0.5, 0.85, 1.6);
    this.headlightLeft.target.position.set(-0.5, 0, 10);
    this.vehicleGroup.add(this.headlightLeft);
    this.vehicleGroup.add(this.headlightLeft.target);

    this.headlightRight = new THREE.SpotLight(0xfff7d6, 2.5, 20, Math.PI * 0.22, 0.4);
    this.headlightRight.position.set(0.5, 0.85, 1.6);
    this.headlightRight.target.position.set(0.5, 0, 10);
    this.vehicleGroup.add(this.headlightRight);
    this.vehicleGroup.add(this.headlightRight.target);

    // 9. Vertical Chrome Exhaust Stack
    const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.2, metalness: 0.9 });
    const exhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    exhaust.position.set(0.6, 1.7, -0.9);
    this.vehicleGroup.add(exhaust);

    // 10. Contact Shadow Disc beneath vehicle
    const shadowGeo = new THREE.CircleGeometry(1.6, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0a1017,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.position.y = 0.02;
    this.scene.add(this.contactShadow);

    // Add Vehicle to Scene
    this.scene.add(this.vehicleGroup);
    this.updateVehicleTransform();
  }

  private updatePlowBladeGeometry(): void {
    if (this.bladeMesh) {
      this.vehicleGroup.remove(this.bladeMesh);
      this.bladeMesh.geometry.dispose();
    }

    const width = this.stats.plowWidth;
    const bladeGeo = new THREE.BoxGeometry(width, 0.75, 0.28);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xcc3322, // High-vis red plow blade with steel trim
      roughness: 0.4,
      metalness: 0.5,
    });

    this.bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
    this.bladeMesh.position.set(0, 0.42, 1.85);
    this.bladeMesh.castShadow = !this.lowQuality;
    this.vehicleGroup.add(this.bladeMesh);
  }

  /**
   * Ambient Snowfall Particle System
   */
  private setupSnowfall(): void {
    this.snowPositions = new Float32Array(this.snowCount * 3);
    this.snowVelocities = new Float32Array(this.snowCount * 3);

    for (let i = 0; i < this.snowCount; i++) {
      this.snowPositions[i * 3] = (Math.random() - 0.5) * 80;
      this.snowPositions[i * 3 + 1] = Math.random() * 30;
      this.snowPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;

      this.snowVelocities[i * 3] = (Math.random() - 0.5) * 0.5;
      this.snowVelocities[i * 3 + 1] = -(1.5 + Math.random() * 2.0);
      this.snowVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPositions, 3));
    snowGeo.setDrawRange(0, this.weather.snowParticleCount);

    // Crisp soft circle snowflake texture
    const snowDotCanvas = document.createElement('canvas');
    snowDotCanvas.width = 16;
    snowDotCanvas.height = 16;
    const dotCtx = snowDotCanvas.getContext('2d')!;
    dotCtx.fillStyle = '#ffffff';
    dotCtx.beginPath();
    dotCtx.arc(8, 8, 7, 0, Math.PI * 2);
    dotCtx.fill();

    const snowTex = new THREE.CanvasTexture(snowDotCanvas);

    const snowMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.35,
      map: snowTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    this.snowParticles = new THREE.Points(snowGeo, snowMat);
    this.scene.add(this.snowParticles);
  }

  /**
   * Snow Spray Particle Pool (flung from plow blade edges)
   */
  private setupSprayParticles(): void {
    const sprayGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const sprayMat = new THREE.MeshStandardMaterial({
      color: 0xfcfdff,
      roughness: 0.6,
      metalness: 0.1,
    });

    this.sprayParticles = new THREE.InstancedMesh(sprayGeo, sprayMat, this.sprayCount);
    this.sprayParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sprayParticles.frustumCulled = false;

    for (let i = 0; i < this.sprayCount; i++) {
      this.sprayData.push({
        pos: new THREE.Vector3(0, -99, 0),
        vel: new THREE.Vector3(0, 0, 0),
        life: 0,
        maxLife: 1.0,
        scale: 0.1,
      });
      this.sprayDummy.position.set(0, -99, 0);
      this.sprayDummy.scale.set(0, 0, 0);
      this.sprayDummy.updateMatrix();
      this.sprayParticles.setMatrixAt(i, this.sprayDummy.matrix);
    }

    this.sprayParticles.instanceMatrix.needsUpdate = true;
    this.scene.add(this.sprayParticles);
  }

  /**
   * Chimney smoke puff particles
   */
  private setupSmokeParticles(): void {
    const smokeGeo = new THREE.SphereGeometry(0.3, 6, 6);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xd8e3ee,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    this.smokeInstancedMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, this.MAX_SMOKE); // room for any village
    this.smokeInstancedMesh.count = this.smokeParticles.length;
    this.smokeInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeInstancedMesh.frustumCulled = false;
    this.scene.add(this.smokeInstancedMesh);
  }

  /**
   * Emit snow spray chunks from plow blade
   */
  private emitSnowSpray(count: number, isBlowerJet: boolean = false): void {
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicleHeading);
    const left = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicleHeading);

    let emitted = 0;
    for (let i = 0; i < this.sprayCount && emitted < count; i++) {
      const p = this.sprayData[i];
      if (p.life <= 0) {
        emitted++;
        p.maxLife = 0.4 + Math.random() * 0.35;
        p.life = p.maxLife;

        const halfW = this.stats.plowWidth * 0.45;
        const side = Math.random() > 0.5 ? 1 : -1;
        const spawnX = side * (halfW * 0.8 + Math.random() * halfW * 0.3);

        p.pos.copy(this.vehiclePos)
          .addScaledVector(forward, 1.8)
          .addScaledVector(left, spawnX);
        p.pos.y = 0.3 + Math.random() * 0.2;

        if (isBlowerJet) {
          // Forward snow cannon jet
          p.vel.copy(forward).multiplyScalar(14 + Math.random() * 8)
            .addScaledVector(left, (Math.random() - 0.5) * 5);
          p.vel.y = 4.0 + Math.random() * 3.0;
          p.scale = 0.3 + Math.random() * 0.35;
        } else {
          // Standard plow side spray
          p.vel.copy(left).multiplyScalar(side * (3.5 + Math.random() * 4.0))
            .addScaledVector(forward, Math.max(2.0, this.vehicleSpeed * 0.7));
          p.vel.y = 1.8 + Math.random() * 2.2;
          p.scale = 0.15 + Math.random() * 0.2;
        }
      }
    }
  }

  /**
   * Trigger Turbo Snow Cannon
   */
  public triggerSnowCannon(): boolean {
    if (!this.stats.hasBlower || this.metrics.blowerCharge < 1.0) return false;

    this.metrics.blowerCharge = 0.0;
    soundEngine.playBlowerBlast();

    // Clear large cone of snow ahead of plow
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicleHeading);
    for (let d = 2; d <= 10; d += 2) {
      const blastPos = this.vehiclePos.clone().addScaledVector(forward, d);
      this.clearSnowAtWorldPos(blastPos.x, blastPos.z, 3.5, false);
    }

    // Heavy spray particle blast
    this.emitSnowSpray(60, true);
    return true;
  }

  /**
   * Clears snow on the procedural canvas at world (x, z) coordinate
   */
  private clearSnowAtWorldPos(worldX: number, worldZ: number, radiusM: number, isPlowAction: boolean): number {
    const W = this.CANVAS_RES;

    // Convert world [-WORLD_SIZE/2, WORLD_SIZE/2] to canvas [0, CANVAS_RES]
    const u = (worldX / this.WORLD_SIZE + 0.5);
    const v = (worldZ / this.WORLD_SIZE + 0.5);

    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

    const cx = u * W;
    const cy = v * W;
    const r = Math.max(3, (radiusM / this.WORLD_SIZE) * W);

    // Road -> wet dark asphalt; meadow -> packed-snow tyre track (plow only)
    const cleared = clearSnowDisc(this.snowLeft, W, cx, cy, r, (i) => this.paintCleared(i, isPlowAction));
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const span = Math.ceil(2 * r) + 2;
    this.snowCtx.putImageData(this.snowImage, 0, 0, x0, y0, span, span);
    this.snowTexture.needsUpdate = true;

    this.freshPixels += cleared;
    this.clearedRoadPixels += cleared;
    if (this.clearedRoadPixels < this.totalRoadPixels && this.clearedRoadPixels >= this.totalRoadPixels * AUTO_FINISH_RATIO) {
      this.meltRemainingSnow();
    }
    this.syncCleanMetrics();

    return cleared;
  }

  private syncCleanMetrics(): void {
    this.metrics.cleanPercent = calculateCleanliness(this.clearedRoadPixels, this.totalRoadPixels);
    this.metrics.snowClearedSqM = Math.round(this.clearedRoadPixels * (this.WORLD_SIZE / this.CANVAS_RES) ** 2);
  }

  /** Blizzard: snow drifts back over cleared road in small patches, which pay again when re-plowed. */
  private driftSnowBack(dt: number): void {
    const W = this.CANVAS_RES;
    const PATCH = 20; // ~pixels in a radius-2.6 patch
    this.snowfallBank = Math.min(this.snowfallBank + this.weather.snowfallRate * this.totalRoadPixels * dt, 10 * PATCH);
    const px = this.snowImage.data;
    for (let tries = 0; this.snowfallBank >= PATCH && tries < 10; tries++) {
      const seed = this.roadPixels[Math.floor(Math.random() * this.roadPixels.length)];
      if (this.snowLeft[seed]) continue; // landed on snow that was never plowed
      this.snowfallBank -= PATCH;
      const cx = (seed % W) + 0.5;
      const cy = Math.floor(seed / W) + 0.5;
      forEachInDisc(W, cx, cy, 2.6, (i) => {
        if (!this.roadMask[i] || this.snowLeft[i]) return;
        this.snowLeft[i] = 1;
        this.clearedRoadPixels--;
        px[i * 4] = 248;
        px[i * 4 + 1] = 252;
        px[i * 4 + 2] = 255;
      });
      this.snowCtx.putImageData(this.snowImage, 0, 0, Math.floor(cx) - 3, Math.floor(cy) - 3, 7, 7);
      this.snowTexture.needsUpdate = true;
    }
    this.syncCleanMetrics();
  }

  /** Paints one snow-map pixel as cleared. Grain is a hash of the pixel, so repainting never flickers. */
  private paintCleared(i: number, isPlowAction: boolean): void {
    const px = this.snowImage.data;
    const x = i % this.CANVAS_RES;
    const y = (i - x) / this.CANVAS_RES;
    const grain = ((x * 73856093) ^ (y * 19349663)) & 15;
    if (this.roadMask[i]) {
      px[i * 4] = 28 + grain;
      px[i * 4 + 1] = 33 + grain;
      px[i * 4 + 2] = 42 + grain;
    } else if (isPlowAction) {
      px[i * 4] = 208 + grain;
      px[i * 4 + 1] = 221 + grain;
      px[i * 4 + 2] = 236 + grain;
    }
  }

  /** Last specks of the village melt on their own once the plow has done the real work. */
  private meltRemainingSnow(): void {
    for (let i = 0; i < this.snowLeft.length; i++) {
      if (!this.snowLeft[i]) continue;
      this.snowLeft[i] = 0;
      this.paintCleared(i, false);
    }
    this.snowCtx.putImageData(this.snowImage, 0, 0);
    this.snowTexture.needsUpdate = true;
    this.clearedRoadPixels = this.totalRoadPixels;
  }

  /**
   * Update Physics & Simulation Frame
   */
  public update(dt: number, input: DriveInput): void {
    // Touch joystick: drive towards the dragged screen direction, relative to the camera
    const sx = input.stickX ?? 0;
    const sy = input.stickY ?? 0;
    if (sx || sy) {
      const cam = this.camera.getWorldDirection(this.tmpDir);
      const len = Math.hypot(cam.x, cam.z) || 1;
      const fx = cam.x / len; // screen-up on the ground
      const fz = cam.z / len;
      const wx = -fz * sx - fx * sy;
      const wz = fx * sx - fz * sy;
      let diff = Math.atan2(wx, wz) - this.vehicleHeading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      input = { ...input, forward: Math.hypot(sx, sy) > 0.3, left: diff > 0.12, right: diff < -0.12 };
    }

    // 1. Vehicle Movement & Steering
    const maxSpd = this.stats.maxSpeed;
    const accel = this.stats.accel;
    const turnSpd = this.stats.turnSpeed;

    // Acceleration & Braking
    if (input.forward) {
      this.vehicleSpeed = Math.min(maxSpd, this.vehicleSpeed + accel * dt);
    } else if (input.backward) {
      this.vehicleSpeed = Math.max(-maxSpd * 0.45, this.vehicleSpeed - accel * 1.3 * dt);
    } else {
      // Natural rolling friction on snow
      this.vehicleSpeed *= Math.max(0, 1 - 2.8 * dt);
    }

    // Steering & Drifting
    const speedFactor = Math.min(1.0, Math.abs(this.vehicleSpeed) / 4.0);
    const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.vehicleSteer = THREE.MathUtils.damp(this.vehicleSteer, steerTarget, 10, dt);

    const driftMul = input.drift ? 1.45 : 1.0;
    if (Math.abs(this.vehicleSpeed) > 0.1) {
      const dir = this.vehicleSpeed >= 0 ? 1 : -1;
      this.vehicleHeading += this.vehicleSteer * turnSpd * speedFactor * dir * driftMul * dt;
    }

    // Position integration
    const forwardX = Math.sin(this.vehicleHeading);
    const forwardZ = Math.cos(this.vehicleHeading);

    this.vehiclePos.x += forwardX * this.vehicleSpeed * dt;
    this.vehiclePos.z += forwardZ * this.vehicleSpeed * dt;

    // Clamp inside world bounds
    const maxBound = this.WORLD_SIZE * 0.45;
    this.vehiclePos.x = Math.max(-maxBound, Math.min(maxBound, this.vehiclePos.x));
    this.vehiclePos.z = Math.max(-maxBound, Math.min(maxBound, this.vehiclePos.z));

    this.updateVehicleTransform();

    // 2. Snow Plowing Action
    let plowedThisFrame = 0;
    const isMovingForward = this.vehicleSpeed > 0.5;

    if (isMovingForward) {
      // Clear swath ahead of plow blade
      const plowAheadX = this.vehiclePos.x + forwardX * 1.8;
      const plowAheadZ = this.vehiclePos.z + forwardZ * 1.8;
      plowedThisFrame = this.clearSnowAtWorldPos(plowAheadX, plowAheadZ, this.stats.plowWidth * 0.55, true);

      // Salt Spreader behind vehicle if unlocked
      if (this.stats.saltRadius > 0 && Math.random() < 0.3) {
        const saltX = this.vehiclePos.x - forwardX * 1.6;
        const saltZ = this.vehiclePos.z - forwardZ * 1.6;
        this.clearSnowAtWorldPos(saltX, saltZ, this.stats.saltRadius, false);
      }
    }

    // Only real snow crunches and sprays; the short hold bridges frames that move less than a pixel
    this.plowingTimer = plowedThisFrame > 0 ? 0.15 : Math.max(0, this.plowingTimer - dt);
    const isPlowingSnow = isMovingForward && this.plowingTimer > 0;
    if (isPlowingSnow && Math.random() < 0.65) {
      this.emitSnowSpray(input.drift ? 6 : 3, false);
    }

    // 3. Update Audio Synthesizer
    const speedRatio = Math.abs(this.vehicleSpeed) / maxSpd;
    soundEngine.updateFrame(speedRatio, isPlowingSnow, this.weather.windAudioVolume);

    // 4. Combo & payout from road snow actually cleared since last frame (plow, salt, blower)
    const clearedPercent = (this.freshPixels / this.totalRoadPixels) * 100;
    this.freshPixels = 0;
    const combo = updateCombo(this.metrics.comboMultiplier, this.metrics.comboTimer, clearedPercent, dt);
    if (combo.steppedUp) {
      soundEngine.playComboChime(combo.combo);
      this.callbacks.onComboStepped(combo.combo);
    }
    this.metrics.comboMultiplier = combo.combo;
    this.metrics.comboTimer = combo.timer;
    this.metrics.maxCombo = Math.max(this.metrics.maxCombo, combo.combo);

    const gain = calculateSnowPlowGain(clearedPercent * this.villagePay, combo.combo);
    this.metrics.score += gain.scoreGain;
    this.coinBank += gain.coinsGain;
    const wholeCoins = Math.floor(this.coinBank);
    this.metrics.coins += wholeCoins;
    this.coinBank -= wholeCoins;

    if (this.weather.snowfallRate > 0) this.driftSnowBack(dt);

    // 5. Snow Blower Recharge
    if (this.stats.hasBlower && this.metrics.blowerCharge < 1.0) {
      this.metrics.blowerCharge = Math.min(1.0, this.metrics.blowerCharge + dt / this.stats.blowerCooldown);
    }

    this.metrics.shiftDurationSec += dt;
    this.callbacks.onMetricsUpdate(this.metrics);

    // 6. Update Snow Particles
    this.updateSnowParticles(dt);
    this.updateSprayParticles(dt);
    this.updateSmokeParticles(dt);

    // 7. Beacon Light Spin
    if (this.beaconLight && this.beaconMesh) {
      const beaconAngle = performance.now() * 0.008;
      this.beaconMesh.rotation.y = beaconAngle;
      this.beaconLight.intensity = 1.0 + Math.sin(beaconAngle * 2) * 0.5;
    }
  }

  private updateVehicleTransform(): void {
    if (!this.vehicleGroup) return;
    this.vehicleGroup.position.copy(this.vehiclePos);
    this.vehicleGroup.rotation.y = this.vehicleHeading;

    // Contact shadow follows vehicle position exactly
    if (this.contactShadow) {
      this.contactShadow.position.x = this.vehiclePos.x;
      this.contactShadow.position.z = this.vehiclePos.z;
    }

    // Wheel rotation according to speed
    this.wheels.forEach((wheel) => {
      wheel.rotation.x += this.vehicleSpeed * 0.05;
    });
  }

  private updateSnowParticles(dt: number): void {
    if (!this.snowParticles) return;
    const pos = this.snowPositions;
    const vel = this.snowVelocities;
    const windSpeed = this.weather.windSpeed;
    const windDir = this.weather.windDirection;
    const windX = Math.cos(windDir) * windSpeed;
    const windZ = Math.sin(windDir) * windSpeed;

    for (let i = 0; i < this.weather.snowParticleCount; i++) {
      const idx = i * 3;
      pos[idx] += (vel[idx] + windX) * dt;
      pos[idx + 1] += vel[idx + 1] * dt;
      pos[idx + 2] += (vel[idx + 2] + windZ) * dt;

      // Wrap around world boundary
      if (pos[idx + 1] < 0) {
        pos[idx + 1] = 25 + Math.random() * 5;
        pos[idx] = this.vehiclePos.x + (Math.random() - 0.5) * 70;
        pos[idx + 2] = this.vehiclePos.z + (Math.random() - 0.5) * 70;
      }
    }

    this.snowParticles.geometry.attributes.position.needsUpdate = true;
  }

  private updateSprayParticles(dt: number): void {
    for (let i = 0; i < this.sprayCount; i++) {
      const p = this.sprayData[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vel.y -= 9.8 * dt; // gravity
        p.pos.addScaledVector(p.vel, dt);

        if (p.pos.y < 0.05) {
          p.pos.y = 0.05;
          p.vel.set(0, 0, 0);
        }

        const scale = p.scale * (p.life / p.maxLife);
        this.sprayDummy.position.copy(p.pos);
        this.sprayDummy.scale.set(scale, scale, scale);
        this.sprayDummy.updateMatrix();
        this.sprayParticles.setMatrixAt(i, this.sprayDummy.matrix);
      } else {
        this.sprayDummy.position.set(0, -99, 0);
        this.sprayDummy.scale.set(0, 0, 0);
        this.sprayDummy.updateMatrix();
        this.sprayParticles.setMatrixAt(i, this.sprayDummy.matrix);
      }
    }
    this.sprayParticles.instanceMatrix.needsUpdate = true;
  }

  private updateSmokeParticles(dt: number): void {
    if (!this.smokeInstancedMesh) return;
    this.smokeParticles.forEach((smoke, idx) => {
      smoke.life += dt;
      if (smoke.life >= smoke.maxLife) {
        smoke.life = 0;
        smoke.pos.copy(smoke.basePos);
      } else {
        smoke.pos.y += 0.9 * dt;
        smoke.pos.x += Math.sin(smoke.life * 3) * 0.15 * dt;
      }

      const progress = smoke.life / smoke.maxLife;
      const s = 0.3 + progress * 0.8;
      this.smokeDummy.position.copy(smoke.pos);
      this.smokeDummy.scale.set(s, s, s);
      this.smokeDummy.updateMatrix();
      this.smokeInstancedMesh.setMatrixAt(idx, this.smokeDummy.matrix);
    });
    this.smokeInstancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Title Screen Camera Pan & Smooth Camera Tracking
   */
  public updateCamera(dt: number, state: 'title' | 'playing' | 'paused' | 'gameover'): void {
    if (state === 'title') {
      // Atmospheric 3D panorama tour of the snowy village
      this.tourAngle += 0.22 * dt;
      const tourRadius = 42;
      const camX = Math.cos(this.tourAngle) * tourRadius;
      const camZ = Math.sin(this.tourAngle) * tourRadius;
      const targetPos = new THREE.Vector3(camX, 22, camZ);
      this.camera.position.lerp(targetPos, 0.05);
      this.camera.lookAt(0, 2.5, 0);
      return;
    }

    // In-game camera tracking
    let desiredOffset: THREE.Vector3;
    switch (this.cameraMode) {
      case 'close':
        desiredOffset = new THREE.Vector3(14, 15, 14);
        break;
      case 'top':
        desiredOffset = new THREE.Vector3(0.1, 40, 1);
        break;
      case 'isometric':
      default:
        desiredOffset = new THREE.Vector3(24, 26, 24);
        break;
    }

    // Smooth exponential damping follow
    this.cameraTarget.lerp(this.vehiclePos, 1 - Math.exp(-6 * dt));
    const targetCamPos = this.cameraTarget.clone().add(desiredOffset);
    this.camera.position.lerp(targetCamPos, 1 - Math.exp(-6 * dt));
    this.camera.lookAt(this.cameraTarget.x, 1.2, this.cameraTarget.z);
  }

  public setCameraMode(mode: 'isometric' | 'close' | 'top'): void {
    this.cameraMode = mode;
  }

  public getCameraMode(): 'isometric' | 'close' | 'top' {
    return this.cameraMode;
  }

  public toggleCameraMode(): 'isometric' | 'close' | 'top' {
    const modes: ('isometric' | 'close' | 'top')[] = ['isometric', 'close', 'top'];
    const nextIdx = (modes.indexOf(this.cameraMode) + 1) % modes.length;
    this.cameraMode = modes[nextIdx];
    return this.cameraMode;
  }

  public setWeather(newWeather: WeatherConfig): void {
    this.weather = newWeather;
    this.snowParticles.geometry.setDrawRange(0, newWeather.snowParticleCount);
    this.scene.background = new THREE.Color(newWeather.skyColor);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(newWeather.fogColor);
      this.scene.fog.density = newWeather.visibility;
    }
    if (this.sunLight) {
      this.sunLight.intensity = newWeather.lightIntensity;
    }
  }

  public updateStats(newStats: VehicleStats): void {
    this.stats = newStats;
    this.updatePlowBladeGeometry();
  }

  public addCoins(amount: number): void {
    this.metrics.coins += amount;
  }

  public spendCoins(amount: number): boolean {
    if (this.metrics.coins >= amount) {
      this.metrics.coins -= amount;
      return true;
    }
    return false;
  }

  public resetRun(): void {
    this.vehiclePos.set(this.spawn.x, 0.4, this.spawn.z);
    this.vehicleHeading = this.spawn.heading;
    this.vehicleSpeed = 0;
    this.vehicleSteer = 0;
    this.cameraTarget.copy(this.vehiclePos);
    this.snowfallBank = 0;
    // Coins carry over; everything about the run starts fresh (a stale 100% re-triggered victory instantly)
    Object.assign(this.metrics, {
      snowClearedSqM: 0,
      cleanPercent: 0,
      score: 0,
      comboMultiplier: 1.0,
      comboTimer: 0,
      maxCombo: 1.0,
      shiftDurationSec: 0,
      blowerCharge: 1.0,
    });
    this.resetSnow();
    this.updateVehicleTransform();
  }

  private onWindowResize = (): void => {
    if (!this.container) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const rawDt = (now - this.lastTime) / 1000;
    const dt = Math.min(rawDt, 0.05); // clamped dt per game craft instructions
    this.lastTime = now;

    this.renderer.render(this.scene, this.camera);
  };

  public renderDirect(dt: number, state: 'title' | 'playing' | 'paused' | 'gameover', input: DriveInput): void {
    if (state === 'playing') {
      this.update(dt, input);
    }
    this.updateCamera(dt, state);
  }

  public dispose(): void {
    cancelAnimationFrame(this.animId);
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
