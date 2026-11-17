import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUS_SCALE, VISIBLE_PER_LINE, PALETTE, VECTOR, directionAngle, type Bus, type BusColor, type GameState, type Person } from './game';
import { Traffic, createDepotLayout, DOCK_X, BAY_WIDTH, BAY_LENGTH, YARD_TOP, arrivalRoute, departureRoutes, yardPosition, type DepotLayout, type Point } from './traffic';
const v = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z);
const PERSON_SCALE = 1.75;
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string) {
  if (!materialCache.has(color)) materialCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: .57, metalness: .015 }));
  return materialCache.get(color)!;
}
const geometryCache = new Map<string, THREE.BufferGeometry>();
function rounded(w: number, h: number, d: number, r = .08) {
  const key = [w, h, d, r].join(',');
  if (!geometryCache.has(key)) geometryCache.set(key, new RoundedBoxGeometry(w, h, d, 2, r));
  return geometryCache.get(key)!;
}
function box(parent: THREE.Object3D, w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, radius = .06) {
  const mesh = new THREE.Mesh(rounded(w, h, d, Math.min(radius, w / 2, h / 2, d / 2)), material(color));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
function mergeStaticMeshes(parent: THREE.Object3D) {
  parent.updateMatrixWorld(true);
  const inverse = parent.matrixWorld.clone().invert();
  const buckets = new Map<THREE.MeshStandardMaterial, THREE.Mesh[]>();
  parent.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
      const meshes = buckets.get(object.material) ?? [];
      meshes.push(object); buckets.set(object.material, meshes);
    }
  });
  for (const [mat, meshes] of buckets) {
    const geometries = meshes.map(mesh => {
      let geo = mesh.geometry.clone();
      if (geo.index) { const unindexed = geo.toNonIndexed(); geo.dispose(); geo = unindexed; }
      return geo.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    });
    const geometry = mergeGeometries(geometries);
    for (const geo of geometries) geo.dispose();
    if (!geometry) throw new Error('Could not merge depot geometry');
    geometry.userData.owned = true;
    const merged = new THREE.Mesh(geometry, mat);
    merged.castShadow = true; merged.receiveShadow = true;
    for (const mesh of meshes) mesh.removeFromParent();
    parent.add(merged);
  }
}
function releaseBus(group: THREE.Group) {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry.userData.owned || object.material instanceof THREE.MeshBasicMaterial) object.geometry.dispose();
    if (object.material instanceof THREE.MeshBasicMaterial) {
      object.material.map?.dispose(); object.material.dispose();
    }
  });
}

function labelTexture(text: string, color = '#60786b', bg?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128); }
  ctx.fillStyle = color; ctx.font = '700 58px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function groundLabel(parent: THREE.Object3D, text: string, x: number, z: number, width: number, color?: string) {
  const texture = labelTexture(text, color);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .13, z); parent.add(mesh);
  return mesh;
}
function rail(parent: THREE.Object3D, points: THREE.Vector3[], color = '#fbf9ef', thickness = .045) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, thickness, 6, false), material(color));
  mesh.castShadow = true; parent.add(mesh);
}
function createBus(bus: Bus) {
  const group = new THREE.Group();
  const color = PALETTE[bus.color], length = bus.length - .18;
  box(group, .79, .5, length, bus.color === 'yellow' ? '#f4c207' : color.hex, 0, .43, 0, .13);
  box(group, .73, .13, length - .08, bus.color === 'yellow' ? '#efc41a' : color.light, 0, .735, 0, .065);
  box(group, .63, .27, .025, '#284e5b', 0, .54, -length / 2 - .004, .035);
  box(group, .62, .2, .025, '#284e5b', 0, .54, length / 2 + .004, .025);
  box(group, .62, .065, .04, '#f7f3df', 0, .26, -length / 2, .02);
  for (const x of [-.25, .25]) box(group, .14, .075, .03, '#fff6cb', x, .36, -length / 2 - .02, .025);
  for (const x of [-.26, .26]) box(group, .1, .07, .03, '#e9544f', x, .32, length / 2 + .02, .02);
  const windowCount = bus.length >= 2.8 ? 5 : bus.length >= 1.8 ? 3 : 2;
  for (let i = 0; i < windowCount; i++) {
    const z = -length / 2 + .35 + i * (length - .7) / (windowCount - 1);
    for (const x of [-.398, .398]) {
      box(group, .025, .245, .255, '#315967', x, .55, z, .035);
      box(group, .027, .022, .21, '#81aeb6', x, .61, z, .005);
    }
  }
  const wheelGeometry = new THREE.CylinderGeometry(.145, .145, .09, 12);
  wheelGeometry.rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(.073, .073, .098, 10);
  hubGeometry.rotateZ(Math.PI / 2);
  for (const x of [-.4, .4]) for (const z of [-length / 2 + .32, length / 2 - .32]) {
    const wheel = new THREE.Mesh(wheelGeometry, material('#294a48'));
    wheel.position.set(x, .2, z); group.add(wheel);
    const hub = new THREE.Mesh(hubGeometry, material('#bed0c8'));
    hub.position.copy(wheel.position); group.add(hub);
  }
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-.065, -.3); arrowShape.lineTo(.065, -.3);
  arrowShape.lineTo(.065, .08); arrowShape.lineTo(.2, .08);
  arrowShape.lineTo(0, .34); arrowShape.lineTo(-.2, .08);
  arrowShape.lineTo(-.065, .08); arrowShape.closePath();
  // Direction must remain legible even on the shaded side of a golden roof.
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({ color: '#fffdf2', toneMapped: false }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, .808, -.1); group.add(arrow);
  if (bus.length < 2) arrow.scale.setScalar(.8);
  if (bus.color === 'yellow' || bus.color === 'pink') {
    const outline = new THREE.Mesh(arrow.geometry.clone(),
      new THREE.MeshBasicMaterial({ color: '#634608', toneMapped: false }));
    outline.rotation.copy(arrow.rotation); outline.position.copy(arrow.position); outline.position.y -= .002;
    outline.scale.copy(arrow.scale).multiplyScalar(1.2); group.add(outline);
  }
  // Shape marks provide a second cue alongside bus color.
  groundLabel(group, color.symbol, 0, length / 2 - .32, bus.length < 2 ? .25 : .32, '#fffdf2').position.y = .81;
  mergeStaticMeshes(group);
  group.scale.setScalar(BUS_SCALE);
  group.traverse(child => { child.userData.busId = bus.id; });
  group.userData.length = length * BUS_SCALE;
  return group;
}
const personGeometry = mergeGeometries([
  new THREE.SphereGeometry(.105, 10, 8).translate(0, .43, 0),
  new THREE.CapsuleGeometry(.079, .12, 3, 8).translate(0, .245, 0),
  new THREE.CapsuleGeometry(.033, .105, 2, 6).translate(-.05, .095, 0),
  new THREE.CapsuleGeometry(.033, .105, 2, 6).translate(.05, .095, 0),
  new THREE.CapsuleGeometry(.03, .12, 2, 6).rotateZ(.2).translate(-.105, .24, 0),
  new THREE.CapsuleGeometry(.03, .12, 2, 6).rotateZ(-.2).translate(.105, .24, 0),
])!;
type BusVisual = { group: THREE.Group; halo: THREE.Mesh; tag: HTMLDivElement };
type PersonVisual = { mesh: THREE.Object3D; color: BusColor; target: THREE.Vector3; boarding: boolean; phase: number };
type Motion = { elapsed: number; duration: number; update: (t: number) => void; done?: () => void };
type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; max: number };
export class DepotScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
  world = new THREE.Group();
  buses = new Map<string, BusVisual>();
  people = new Map<number, PersonVisual>();
  peopleInstances = new Map<BusColor, THREE.InstancedMesh>();
  layout: DepotLayout;
  traffic: Traffic;
  trips = new Map<string, { group: THREE.Group; end: Point; done: () => void }>();
  bumping = new Set<string>();
  motions: Motion[] = [];
  particles: Particle[] = [];
  mount: HTMLElement;
  overlays: HTMLDivElement;
  state: GameState;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  hovered: string | null = null;
  hinted: string | null = null;
  hintUntil = 0;
  elapsed = 0;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  onSelect: (id: string) => void;
  onHover?: (bus: Bus | null) => void;
  resizeObserver: ResizeObserver;
  disposed = false;
  constructor(mount: HTMLElement, state: GameState, onSelect: (id: string) => void) {
    this.mount = mount; this.state = state; this.onSelect = onSelect;
    this.layout = createDepotLayout(state.yard); this.traffic = new Traffic(this.layout);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = .95;
    this.renderer.setClearColor('#eaf2eb', 0);
    this.renderer.domElement.setAttribute('aria-label', '3D bus depot. Select a bus to drive it in the direction of its arrow. Keyboard controls are available below the board.');
    this.renderer.domElement.setAttribute('role', 'img');
    mount.appendChild(this.renderer.domElement);
    this.overlays = document.createElement('div'); this.overlays.className = 'scene-overlays';
    this.overlays.setAttribute('aria-hidden', 'true'); mount.appendChild(this.overlays);
    this.scene.add(this.world);
    this.camera.position.set(0, 30, this.layout.CAMERA_TARGET_Z + 24.2); this.camera.lookAt(0, 0, this.layout.CAMERA_TARGET_Z);
    this.scene.add(new THREE.HemisphereLight('#fff9e8', '#9cbdb0', 1.6));
    const sun = new THREE.DirectionalLight('#fff8e6', 2);
    sun.position.set(-8, 18, 9); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 19, bottom: -19, near: .5, far: 70 });
    sun.shadow.normalBias = .025; sun.shadow.bias = -.0001;
    this.scene.add(sun);
    for (const color of Object.keys(PALETTE) as BusColor[]) {
      const people = new THREE.InstancedMesh(personGeometry, material(PALETTE[color].hex), 512);
      people.count = 0; people.castShadow = true; people.frustumCulled = false;
      people.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.peopleInstances.set(color, people); this.scene.add(people);
    }
    this.buildEnvironment(); mergeStaticMeshes(this.world); this.reset(state);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mount); this.resize();
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      mount.dispatchEvent(new CustomEvent('graphicslost', { bubbles: true }));
    });
  }
  buildEnvironment() {
    const world = this.world;
    const worldDepth = this.layout.WORLD_SOUTH_Z - this.layout.WORLD_NORTH_Z;
    box(world, this.layout.ROAD_WIDTH + .6, .38, worldDepth, '#d9e8d9', 0, -.28, this.layout.WORLD_CENTER_Z, .6);
    box(world, this.layout.ROAD_WIDTH + .2, .1, worldDepth - .5, '#e4ecdf', 0, -.07, this.layout.WORLD_CENTER_Z, .55);
    box(world, this.layout.ROAD_WIDTH, .08, this.layout.ROAD_SOUTH_Z - this.layout.ROAD_NORTH_Z, '#aabbb7', 0, -.005, (this.layout.ROAD_NORTH_Z + this.layout.ROAD_SOUTH_Z) / 2, .6);
    box(world, this.state.yard.width + .25, .09, this.state.yard.height + .25, '#cbd7cd', 0, .025, YARD_TOP + this.state.yard.height / 2, .36);
    for (const x of [-this.layout.ROAD_X, this.layout.ROAD_X]) for (let z = this.layout.ROAD_TOP + .55; z < this.layout.ROAD_BOTTOM; z += 1.1)
      box(world, .045, .012, .43, '#f6f5e5', x, .05, z, .012);
    for (let x = -this.layout.ROAD_X + .55; x < this.layout.ROAD_X; x += 1.1) {
      box(world, .43, .012, .045, '#f6f5e5', x, .05, this.layout.ROAD_BOTTOM, .012);
      box(world, .43, .012, .045, '#f6f5e5', x, .05, this.layout.ROAD_TOP, .012);
    }
    box(world, this.layout.ROAD_WIDTH, .08, BAY_LENGTH + .1, '#d1dcd1', 0, .015, this.layout.DOCK_Z, .22);
    DOCK_X.forEach((x, i) => {
      box(world, BAY_WIDTH, .035, BAY_LENGTH, '#f4f4df', x, .07, this.layout.DOCK_Z, .16);
      box(world, BAY_WIDTH - .08, .04, BAY_LENGTH - .1, '#bed0c0', x, .075, this.layout.DOCK_Z, .14);
      box(world, BAY_WIDTH - .16, .045, BAY_LENGTH - .2, '#d7e3d3', x, .08, this.layout.DOCK_Z, .12);
      groundLabel(world, String(i + 1).padStart(2, '0'), x, this.layout.DOCK_Z + .7, .45, '#6e9078');
      box(world, .055, .8, .055, '#74948b', x + .72, .4, this.layout.DOCK_Z - .75, .015);
      box(world, .34, .3, .07, '#426e5b', x + .72, .84, this.layout.DOCK_Z - .75, .045);
      box(world, .2, .09, .075, '#fff8df', x + .72, .86, this.layout.DOCK_Z - .75, .018);
    });
    const plaza = new THREE.Group(); plaza.position.z = this.layout.PLAZA_FRONT_Z; world.add(plaza);
    box(plaza, Math.min(this.layout.ROAD_WIDTH, 14.4), .11, 4.3, '#f3edda', 0, .015, -2.15, .45);
    box(plaza, 4.9, .014, 1.25, '#e8e1c9', 0, .085, -.95, .3);
    for (const side of [-1, 1]) {
      rail(plaza, [v(side * 6.25, -3.9, .25), v(side * 6.15, -2.4, .25), v(side * 5.7, -1.65, .25), v(side * 3.5, -1.1, .25)]);
      rail(plaza, [v(side * 3.25, -3.9, .25), v(side * 3.25, -2.4, .25), v(side * 3.3, -1.75, .25)]);
      for (const x of [side * 6.2, side * 3.25]) for (const z of [-3.7, -2.8])
        box(plaza, .055, .23, .055, '#b1bdaa', x, .14, z, .015);
    }
    rail(plaza, [v(-2.4, -1.5, .23), v(-2.5, -.6, .23), v(-2.1, -.2, .23), v(2.2, -.2, .23)]);
    rail(plaza, [v(2.4, -1.5, .23), v(2.5, -.6, .23), v(2.2, -.2, .23)]);
    for (const x of [-5.5, 5.5]) {
      box(world, 1.6, .025, 2.3, '#d9e8d9', x, .07, this.layout.DOCK_Z, .25);
      for (const offset of [-.55, .55]) this.planter(x, this.layout.DOCK_Z + offset);
    }
    for (const x of [-6.55, 6.55]) this.lamp(x, this.layout.DOCK_Z);
    for (const x of [-1.1, 1.1]) box(plaza, .07, 1.35, .07, '#87a28d', x, .7, -3.7, .02);
    box(plaza, 2.85, .13, .85, '#82a797', 0, 1.44, -3.7, .15);
    box(plaza, 1.9, .07, .36, '#b59879', 0, .41, -3.6, .04);
  }
  planter(x: number, z: number) {
    box(this.world, .65, .25, .9, '#becbb4', x, .11, z, .16);
    box(this.world, .54, .22, .78, '#92b47c', x, .3, z, .16);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.35, 1), material('#9fbd83'));
    leaf.scale.set(.8, 1.15, 1.3); leaf.position.set(x, .54, z); leaf.castShadow = true; this.world.add(leaf);
    for (let i = 0; i < 3; i++) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(.055, 7, 5), material(i % 2 ? '#f8cf80' : '#f0a49a'));
      flower.position.set(x + (i - 1) * .13, .72, z + (i - 1) * .2); this.world.add(flower);
    }
  }
  lamp(x: number, z: number) {
    box(this.world, .2, .08, .2, '#8da69a', x, .08, z);
    box(this.world, .06, 1.55, .06, '#89a397', x, .8, z, .02);
    box(this.world, .5, .055, .08, '#89a397', x + .22, 1.58, z, .025);
    box(this.world, .25, .08, .2, '#fff5ce', x + .39, 1.55, z, .025);
  }
  reset(state: GameState) {
    const changed = state.yard.width !== this.layout.yard.width || state.yard.height !== this.layout.yard.height;
    if (changed) {
      releaseBus(this.world); this.world.clear();
      this.layout = createDepotLayout(state.yard); this.traffic = new Traffic(this.layout);
    }
    this.state = state; this.motions = []; this.hinted = null; this.hovered = null;
    if (changed) { this.buildEnvironment(); mergeStaticMeshes(this.world); }
    this.traffic.clear(); this.trips.clear(); this.bumping.clear();
    for (const visual of this.buses.values()) {
      this.scene.remove(visual.group, visual.halo); releaseBus(visual.group); (visual.halo.material as THREE.Material).dispose(); visual.tag.remove();
    }
    for (const p of this.people.values()) this.scene.remove(p.mesh);
    for (const p of this.particles) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.particles = []; this.people.clear(); this.buses.clear();
    for (const bus of state.buses) {
      const group = createBus(bus);
      if (bus.status === 'yard') {
        const p = yardPosition(bus, this.layout); group.position.copy(v(p.x, p.z, .08));
        group.rotation.y = directionAngle(bus.direction);
      } else {
        group.position.copy(v(DOCK_X[bus.dock ?? 0], this.layout.DOCK_Z, .08));
      }
      group.visible = bus.status !== 'gone';
      this.scene.add(group);
      const halo = new THREE.Mesh(rounded(.96, .035, bus.length + .03, .12),
        new THREE.MeshBasicMaterial({ color: '#fff9c7', transparent: true, opacity: .85 }));
      halo.position.copy(group.position); halo.position.y = .1; halo.rotation.y = group.rotation.y;
      halo.scale.set(BUS_SCALE, 1, BUS_SCALE);
      halo.visible = false; this.scene.add(halo);
      const tag = document.createElement('div'); tag.className = 'bus-tag'; tag.hidden = true;
      this.overlays.appendChild(tag);
      this.buses.set(bus.id, { group, halo, tag });
    }
    this.syncPeople(true);
    this.resize();
  }
  resize() {
    const width = this.mount.clientWidth, height = this.mount.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.camera.position.set(0, 30, this.layout.CAMERA_TARGET_Z + 24.2);
    this.camera.lookAt(0, 0, this.layout.CAMERA_TARGET_Z);
    this.camera.updateMatrixWorld();
    // Fit the full plaza and road in both orientations without stretching the scene.
    const halfWidth = Math.max(6.9, this.layout.ROAD_X + .65);
    const corners = [-halfWidth, halfWidth].flatMap(x => [this.layout.WORLD_NORTH_Z, this.layout.WORLD_SOUTH_Z].map(z => v(x, z, .5).applyMatrix4(this.camera.matrixWorldInverse)));
    const viewW = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
    const viewH = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
    // Reserve only the small overlay controls; use the remaining screen.
    const usableHeight = Math.max(height * .65, height - 128);
    const usableWidth = Math.max(width * .8, width - 16);
    const halfH = Math.max((viewH / 2 + .2) * height / usableHeight, (viewW / 2 + .15) * width / usableWidth / aspect);
    this.camera.left = -halfH * aspect; this.camera.right = halfH * aspect;
    this.camera.top = halfH; this.camera.bottom = -halfH; this.camera.updateProjectionMatrix();
  }
  hit(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const groups = [...this.buses.entries()].filter(([id]) => this.state.buses.find(b => b.id === id)?.status === 'yard').map(([, visual]) => visual.group);
    return this.raycaster.intersectObjects(groups, true)[0]?.object.userData.busId as string | undefined;
  }
  pointerMove = (event: PointerEvent) => {
    this.hovered = this.hit(event) ?? null;
    this.renderer.domElement.style.cursor = this.hovered ? 'pointer' : 'default';
    this.onHover?.(this.state.buses.find(b => b.id === this.hovered) ?? null);
  };
  pointerLeave = () => { this.hovered = null; this.onHover?.(null); };
  pointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const id = this.hit(event);
    if (id) this.onSelect(id);
  };
  hint(id: string) { this.hinted = id; this.hintUntil = this.elapsed + 5; }
  animate(duration: number, update: Motion['update'], done?: () => void) {
    this.motions.push({ elapsed: 0, duration: this.reduced ? Math.min(duration, .22) : duration, update, done });
  }
  follow(bus: Bus, points: Point[], done: () => void, reverseFirst = false) {
    this.trips.set(bus.id, { group: this.buses.get(bus.id)!.group, end: points.at(-1)!, done });
    this.traffic.start(bus.id, bus.length, points, reverseFirst);
  }
  planArrival(bus: Bus, stops: number[]) {
    return this.traffic.planArrival(bus, stops);
  }
  drive(bus: Bus, done: () => void, points = arrivalRoute(bus, this.layout)) {
    const visual = this.buses.get(bus.id)!;
    const end = v(DOCK_X[bus.dock!], this.layout.DOCK_Z, .08);
    this.follow(bus, points, () => {
      visual.group.position.copy(end); visual.group.rotation.y = 0; done();
    });
  }
  bump(bus: Bus, distance: number, done: () => void) {
    this.bumping.add(bus.id);
    const group = this.buses.get(bus.id)!.group;
    const start = group.position.clone();
    const vector = VECTOR[bus.direction];
    // Include the physical gap between meshes, while stopping short of the blocker.
    const travel = Math.max(0, distance - .025);
    let sparked = false;
    this.animate(.52 + travel * .09, t => {
      const impactT = .43;
      let move: number;
      if (t < impactT) move = ease(t / impactT) * travel;
      else {
        if (!sparked) {
          const front = start.clone().add(v(vector.x * (travel + (bus.length - .18) * BUS_SCALE / 2), vector.y * (travel + (bus.length - .18) * BUS_SCALE / 2), .55));
          this.burst(front, '#f6c55c', 9); sparked = true;
        }
        move = (1 - ease((t - impactT) / (1 - impactT))) * travel;
      }
      group.position.copy(start).add(v(vector.x * move, vector.y * move));
      const wobble = this.reduced ? 0 : Math.sin(t * 38) * .04 * Math.sin(t * Math.PI);
      group.rotation.z = wobble;
    }, () => {
      group.position.copy(start); group.rotation.z = 0; this.bumping.delete(bus.id); done();
    });
  }
  departure(bus: Bus, done: () => void) {
    const group = this.buses.get(bus.id)!.group;
    const start = group.position.clone();
    // Reverse gently out of the bay, turn onto the road, then head off the map.
    this.burst(start.clone().add(v(0, .6, .2)), '#d7ead8', 7);
    const points = departureRoutes(bus, this.layout).map(points => ({ points, arrival: this.traffic.estimate(bus.id, bus.length, points, true) }))
      .sort((a, b) => a.arrival - b.arrival)[0].points;
    this.follow(bus, points, () => { group.visible = false; done(); }, true);
  }
  queuePosition(index: number) {
    const row = Math.floor(index / 8), column = index % 8;
    return v((row % 2 === 0 ? 3.5 - column : column - 3.5) * .5, this.layout.PLAZA_FRONT_Z - .55 - row * .34, .12);
  }
  linePosition(lane: number, index: number) {
    const col = index % 6, row = Math.floor(index / 6), side = lane === 0 ? -1 : 1;
    const bend = Math.pow(Math.max(0, 1 - row / 5), 2) * .2;
    return v(side * (4.8 - bend) + (col - 2.5) * .4, this.layout.PLAZA_FRONT_Z - 2 - row * .34, .12);
  }
  syncPeople(initial = false) {
    const visible = new Set<number>();
    const add = (person: Person, target: THREE.Vector3) => {
      visible.add(person.id);
      let visual = this.people.get(person.id);
      if (!visual) {
        const mesh = new THREE.Object3D(); mesh.scale.setScalar(PERSON_SCALE);
        mesh.position.copy(initial ? target : this.linePosition(person.lane, VISIBLE_PER_LINE));
        visual = { mesh, color: person.color, target, boarding: false, phase: person.id * .83 }; this.people.set(person.id, visual);
      }
      if (!visual.boarding) visual.target.copy(target);
    };
    this.state.queue.forEach((person, i) => add(person, this.queuePosition(i)));
    this.state.lines.forEach((line, lane) => line.slice(0, VISIBLE_PER_LINE).forEach((person, i) => add(person, this.linePosition(lane, i))));
    for (const [id, visual] of this.people) if (!visible.has(id) && !visual.boarding) {
      this.scene.remove(visual.mesh); this.people.delete(id);
    }
    this.mount.dataset.people = String(this.people.size);
  }
  board(person: Person, bus: Bus, order = 0) {
    const visual = this.people.get(person.id);
    if (!visual) return;
    visual.boarding = true;
    const start = visual.mesh.position.clone();
    const end = v(DOCK_X[bus.dock!] + .45 * BUS_SCALE, this.layout.DOCK_Z - .6 * BUS_SCALE, .12);
    const via = v(end.x, this.layout.PLAZA_FRONT_Z - .25, .12), delay = order % 12 * .025, duration = .7 + delay;
    this.animate(duration, progress => {
      const t = Math.max(0, (progress * duration - delay) / .7);
      if (t < .55) visual.mesh.position.lerpVectors(start, via, ease(t / .55));
      else visual.mesh.position.lerpVectors(via, end, ease((t - .55) / .45));
      visual.mesh.position.y += Math.sin(t * Math.PI * 6) * .025;
      visual.mesh.scale.setScalar(PERSON_SCALE * (t > .83 ? Math.max(.03, (1 - t) / .17) : 1));
    }, () => { this.scene.remove(visual.mesh); this.people.delete(person.id); });
  }
  burst(position: THREE.Vector3, color: string, count: number) {
    if (this.reduced) return;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.075, .075, .075), material(color));
      mesh.position.copy(position); this.scene.add(mesh);
      const life = .45 + Math.random() * .35;
      this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - .5) * 3, 1.2 + Math.random() * 2, (Math.random() - .5) * 3), life, max: life });
    }
  }
  celebrate() {
    for (const color of Object.values(PALETTE)) this.burst(v((Math.random() - .5) * 7, 1, 3), color.hex, 25);
  }
  project(position: THREE.Vector3) {
    const p = position.clone().project(this.camera);
    return { x: (p.x + 1) * this.mount.clientWidth / 2, y: (-p.y + 1) * this.mount.clientHeight / 2 };
  }
  busScreenPosition(id: string) {
    const bus = this.buses.get(id);
    if (!bus) return null;
    return this.project(bus.group.position.clone().add(new THREE.Vector3(0, .84 * BUS_SCALE, 0)));
  }
  update(dt: number) {
    this.elapsed += dt;
    const finished = this.traffic.update(dt, this.reduced);
    for (const route of this.traffic.routes.values()) {
      const group = this.trips.get(route.id)!.group;
      group.position.set(route.position.x, .08, route.position.z);
      const angle = Math.atan2(Math.sin(route.heading - group.rotation.y), Math.cos(route.heading - group.rotation.y));
      group.rotation.y += angle * (1 - Math.exp(-dt * 18));
    }
    for (const id of finished) {
      const trip = this.trips.get(id)!; this.trips.delete(id);
      trip.group.position.set(trip.end.x, .08, trip.end.z); trip.done();
    }
    this.mount.dataset.traffic = String(this.traffic.routes.size);
    const running = [...this.motions];
    for (const motion of running) {
      motion.elapsed += dt;
      const t = Math.min(1, motion.elapsed / motion.duration);
      motion.update(t);
      if (t >= 1) {
        const index = this.motions.indexOf(motion); if (index >= 0) this.motions.splice(index, 1);
        motion.done?.();
      }
    }
    for (const visual of this.people.values()) {
      if (visual.boarding) continue;
      const moving = visual.mesh.position.distanceTo(visual.target) > .025;
      visual.mesh.position.lerp(visual.target, 1 - Math.exp(-dt * 9));
      visual.mesh.position.y = visual.target.y + (moving && !this.reduced ? Math.abs(Math.sin(this.elapsed * 17 + visual.phase)) * .045 : 0);
      visual.mesh.rotation.z = moving && !this.reduced ? Math.sin(this.elapsed * 17 + visual.phase) * .06 : 0;
    }
    const counts = new Map<BusColor, number>();
    for (const visual of this.people.values()) {
      const index = counts.get(visual.color) ?? 0;
      visual.mesh.updateMatrix();
      this.peopleInstances.get(visual.color)!.setMatrixAt(index, visual.mesh.matrix);
      counts.set(visual.color, index + 1);
    }
    for (const [color, people] of this.peopleInstances) {
      people.count = counts.get(color) ?? 0; people.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); this.particles.splice(i, 1); continue; }
      p.velocity.y -= dt * 4;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 4; p.mesh.rotation.z += dt * 5;
      p.mesh.scale.setScalar(p.life / p.max);
    }
    for (const bus of this.state.buses) {
      const visual = this.buses.get(bus.id)!;
      const highlighted = bus.status === 'yard' && (bus.id === this.hovered || (bus.id === this.hinted && this.elapsed < this.hintUntil));
      visual.halo.visible = highlighted;
      if (highlighted) {
        visual.halo.position.copy(visual.group.position); visual.halo.position.y = .095;
        const scale = this.reduced ? 1 : 1 + Math.sin(this.elapsed * 5) * .025;
        visual.halo.scale.set(scale * BUS_SCALE, 1, scale * BUS_SCALE);
      }
      const show = bus.status === 'docked' || bus.status === 'leaving';
      visual.tag.hidden = !show;
      if (show) {
        const screen = this.project(visual.group.position.clone().add(new THREE.Vector3(0, 1.28 * BUS_SCALE, 0)));
        visual.tag.style.transform = 'translate(' + screen.x + 'px,' + screen.y + 'px) translate(-50%, -50%)';
        visual.tag.style.setProperty('--bus-color', PALETTE[bus.color].hex);
        visual.tag.textContent = (bus.status === 'leaving' ? '✓ ' : '') + bus.filled + '/' + bus.capacity;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
