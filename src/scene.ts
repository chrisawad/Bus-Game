import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, VECTOR, bounds, type Bus, type GameState, type Person } from './game';

const DOCK_X = [-4.4, -2.2, 0, 2.2, 4.4];
const DOCK_Z = -4.25;
const ANGLE = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };
const v = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z);
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string) {
  if (!materialCache.has(color)) materialCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: .66 }));
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
  box(group, .79, .5, length, color.hex, 0, .43, 0, .13);
  box(group, .73, .13, length - .08, color.light, 0, .735, 0, .065);
  box(group, .63, .27, .025, '#284e5b', 0, .54, -length / 2 - .004, .035);
  box(group, .62, .2, .025, '#284e5b', 0, .54, length / 2 + .004, .025);
  box(group, .62, .065, .04, '#f7f3df', 0, .26, -length / 2, .02);
  for (const x of [-.25, .25]) box(group, .14, .075, .03, '#fff6cb', x, .36, -length / 2 - .02, .025);
  for (const x of [-.26, .26]) box(group, .1, .07, .03, '#e9544f', x, .32, length / 2 + .02, .02);
  const windowCount = bus.length === 3 ? 5 : 3;
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
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), material('#fffdf2'));
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, .808, -.1); group.add(arrow);
  // Shape marks provide a second cue alongside bus color.
  groundLabel(group, color.symbol, 0, length / 2 - .32, .32, '#fffdf2').position.y = .81;
  mergeStaticMeshes(group);
  group.traverse(child => { child.userData.busId = bus.id; });
  group.userData.length = length;
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
type PersonVisual = { mesh: THREE.Mesh; target: THREE.Vector3; boarding: boolean; phase: number };
type Motion = { elapsed: number; duration: number; update: (t: number) => void; done?: () => void };
type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; max: number };
export class DepotScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
  world = new THREE.Group();
  buses = new Map<string, BusVisual>();
  people = new Map<number, PersonVisual>();
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor('#eaf2eb', 0);
    this.renderer.domElement.setAttribute('aria-label', '3D bus depot. Select a bus to drive it in the direction of its arrow. Keyboard controls are available below the board.');
    this.renderer.domElement.setAttribute('role', 'img');
    mount.appendChild(this.renderer.domElement);
    this.overlays = document.createElement('div'); this.overlays.className = 'scene-overlays';
    this.overlays.setAttribute('aria-hidden', 'true'); mount.appendChild(this.overlays);
    this.scene.add(this.world);
    this.camera.position.set(9, 25, 28); this.camera.lookAt(0, 0, -.65);
    this.scene.add(new THREE.HemisphereLight('#fff9e8', '#9cbdb0', 1.6));
    const sun = new THREE.DirectionalLight('#fff8e6', 2.0);
    sun.position.set(-8, 18, 9); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 16, bottom: -16, near: .5, far: 60 });
    sun.shadow.normalBias = .025; sun.shadow.bias = -.0001;
    this.scene.add(sun);
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
    box(world, 14.25, .38, 20.2, '#d9e8d9', 0, -.28, -.75, .6);
    box(world, 13.5, .1, 19.4, '#e4ecdf', 0, -.07, -.75, .55);
    // A continuous perimeter road surrounds the central parking puzzle.
    box(world, 12.5, .08, 11.7, '#aabbb7', 0, -.005, 2.75, .6);
    box(world, 8.5, .09, 8.5, '#c3cfc7', 0, .025, 2.8, .17);
    for (let i = 0; i <= 8; i++) {
      box(world, .018, .006, 8.1, '#b5c5ba', -4 + i, .076, 2.8, .002);
      box(world, 8.1, .006, .018, '#b5c5ba', 0, .076, -1.2 + i, .002);
    }
    for (const x of [-5.25, 5.25]) for (let z = -1.9; z < 8.2; z += 1.15)
      box(world, .045, .012, .47, '#edf1d8', x, .05, z, .012);
    for (let x = -4.6; x < 5.2; x += 1.15)
      box(world, .47, .012, .045, '#edf1d8', x, .05, 7.85, .012);
    groundLabel(world, 'KEEP IT FLOWING  →', 0, 8, 3.5, '#f8f9eb');
    // Five fully open, numbered stops.
    box(world, 12.5, .08, 3.2, '#d1dcd1', 0, .015, DOCK_Z, .22);
    DOCK_X.forEach((x, i) => {
      box(world, 1.62, .035, 2.92, '#f1f3df', x, .07, DOCK_Z, .2);
      box(world, 1.52, .04, 2.82, '#bed0c0', x, .075, DOCK_Z, .17);
      box(world, 1.42, .045, 2.72, '#d7e3d3', x, .08, DOCK_Z, .16);
      groundLabel(world, String(i + 1).padStart(2, '0'), x, DOCK_Z + .74, .6, '#6e9078');
      // Small bus-stop poles, with a painted sign.
      box(world, .055, .8, .055, '#74948b', x + .85, .4, DOCK_Z - .8, .015);
      box(world, .34, .3, .07, '#426e5b', x + .85, .84, DOCK_Z - .8, .045);
      box(world, .2, .09, .075, '#fff8df', x + .85, .86, DOCK_Z - .8, .018);
    });
    // The passenger plaza: two feeder lines and a single shared queue.
    box(world, 12.5, .11, 4.5, '#f3edda', 0, .015, -8, .45);
    box(world, 7.9, .014, 1.25, '#e8e1c9', 0, .085, -6.75, .3);
    groundLabel(world, 'LINE A', -4.35, -9.7, 1.4, '#889772');
    groundLabel(world, 'LINE B', 4.35, -9.7, 1.4, '#889772');
    groundLabel(world, 'BOARDING →', .2, -5.9, 1.8, '#91a17f');
    for (const side of [-1, 1]) {
      rail(world, [v(side * 5.7, -9.45, .24), v(side * 5.65, -7.8, .24), v(side * 4.65, -7.15, .24), v(side * 3.45, -7.1, .24)]);
      rail(world, [v(side * 3.05, -9.45, .24), v(side * 3.05, -8, .24), v(side * 2.55, -7.2, .24)]);
      for (const x of [side * 5.65, side * 3.05]) for (const z of [-9.4, -8.3, -7.5])
        box(world, .055, .23, .055, '#b1bdaa', x, .14, z, .015);
    }
    rail(world, [v(-3.55, -6.95, .23), v(-3.65, -6.4, .23), v(-2.9, -6.15, .23), v(2.45, -6.15, .23)]);
    // Pocket gardens and a little shelter make the depot feel like a place.
    for (const x of [-6.35, 6.35]) for (const z of [-5.4, -.9, 3.3, 7.5]) this.planter(x, z);
    for (const x of [-6.05, 6.05]) this.lamp(x, -2.7);
    for (const x of [-1.1, 1.1]) {
      box(world, .07, 1.4, .07, '#87a28d', x, .7, -9.65, .02);
      box(world, 2.8, .13, .85, '#82a797', 0, 1.44, -9.65, .15);
      box(world, 1.9, .07, .36, '#b59879', 0, .41, -9.55, .04);
    }
    groundLabel(world, 'BUS BLOOM', 0, -9.1, 2, '#7b987f');
  }
  planter(x: number, z: number) {
    box(this.world, .72, .27, 1.1, '#becbb4', x, .11, z, .16);
    box(this.world, .6, .22, .95, '#92b47c', x, .3, z, .16);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.36, 1), material('#9fbd83'));
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
    this.state = state; this.motions = []; this.hinted = null; this.hovered = null;
    for (const visual of this.buses.values()) {
      this.scene.remove(visual.group, visual.halo); releaseBus(visual.group); (visual.halo.material as THREE.Material).dispose(); visual.tag.remove();
    }
    for (const p of this.people.values()) this.scene.remove(p.mesh);
    for (const p of this.particles) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.particles = []; this.people.clear(); this.buses.clear();
    for (const bus of state.buses) {
      const group = createBus(bus);
      if (bus.status === 'yard') {
        const b = bounds(bus); group.position.copy(v(b.x + b.w / 2 - 4, b.y + b.h / 2 - 1.2, .08));
        group.rotation.y = ANGLE[bus.direction];
      } else {
        group.position.copy(v(DOCK_X[bus.dock ?? 0], DOCK_Z, .08));
      }
      group.visible = bus.status !== 'gone';
      this.scene.add(group);
      const halo = new THREE.Mesh(rounded(.96, .035, bus.length + .03, .12),
        new THREE.MeshBasicMaterial({ color: '#fff9c7', transparent: true, opacity: .85 }));
      halo.position.copy(group.position); halo.position.y = .1; halo.rotation.y = group.rotation.y;
      halo.visible = false; this.scene.add(halo);
      const tag = document.createElement('div'); tag.className = 'bus-tag'; tag.hidden = true;
      this.overlays.appendChild(tag);
      this.buses.set(bus.id, { group, halo, tag });
    }
    this.syncPeople(true);
  }
  resize() {
    const width = this.mount.clientWidth, height = this.mount.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const portrait = width < 600;
    this.camera.position.set(portrait ? 0 : 9, portrait ? 30 : 25, portrait ? 20 : 28);
    this.camera.lookAt(0, 0, -.65);
    this.camera.updateMatrixWorld();
    // Fit the full plaza and road in both orientations without stretching the scene.
    const corners = [-7.15, 7.15].flatMap(x => [-10.3, 9].map(z => v(x, z, .5).applyMatrix4(this.camera.matrixWorldInverse)));
    const viewW = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
    const viewH = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
    const halfH = portrait ? 6.5 / aspect : Math.max(viewH / 2 + .65, (viewW / 2 + .45) / aspect);
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
  follow(group: THREE.Group, points: THREE.Vector3[], done: () => void, initialDelay = 0) {
    const unique = points.filter((point, i) => i === 0 || point.distanceTo(points[i - 1]) > .01);
    const lengths = unique.slice(1).map((point, i) => point.distanceTo(unique[i]));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    this.animate(total / 10 + .3 + initialDelay, t => {
      const adjusted = Math.max(0, (t * (total / 10 + .3 + initialDelay) - initialDelay) / (total / 10 + .3));
      if (!adjusted) return;
      const distance = ease(Math.min(1, adjusted)) * total;
      let travelled = 0;
      for (let i = 0; i < lengths.length; i++) {
        if (distance <= travelled + lengths[i] || i === lengths.length - 1) {
          const factor = Math.min(1, (distance - travelled) / lengths[i]);
          group.position.lerpVectors(unique[i], unique[i + 1], factor);
          const delta = unique[i + 1].clone().sub(unique[i]);
          const angle = Math.atan2(-delta.x, -delta.z);
          const diff = Math.atan2(Math.sin(angle - group.rotation.y), Math.cos(angle - group.rotation.y));
          group.rotation.y += diff * .24;
          break;
        }
        travelled += lengths[i];
      }
    }, done);
  }
  drive(bus: Bus, done: () => void) {
    const visual = this.buses.get(bus.id)!; const start = visual.group.position.clone();
    const end = v(DOCK_X[bus.dock!], DOCK_Z, .08);
    const points = [start];
    // All travel follows the border; no route cuts through the parked buses.
    if (bus.direction === 'N') points.push(v(start.x, -2.65, .08));
    if (bus.direction === 'E') points.push(v(5.35, start.z, .08), v(5.35, -2.65, .08));
    if (bus.direction === 'W') points.push(v(-5.35, start.z, .08), v(-5.35, -2.65, .08));
    if (bus.direction === 'S') points.push(v(start.x, 7.9, .08), v(-5.35, 7.9, .08), v(-5.35, -2.65, .08));
    points.push(v(end.x, -2.65, .08), end);
    this.follow(visual.group, points, () => {
      visual.group.position.copy(end); visual.group.rotation.y = 0; done();
    });
  }
  bump(bus: Bus, distance: number, blocker: Bus, done: () => void) {
    const group = this.buses.get(bus.id)!.group, other = this.buses.get(blocker.id)!.group;
    const start = group.position.clone(); const otherStart = other.position.clone();
    const vector = VECTOR[bus.direction];
    // Include the physical gap between meshes, while stopping short of the blocker.
    const travel = distance + .12;
    let sparked = false;
    this.animate(.52 + travel * .09, t => {
      const impactT = .43;
      let move: number;
      if (t < impactT) move = ease(t / impactT) * travel;
      else {
        if (!sparked) {
          const front = start.clone().add(v(vector.x * (travel + bus.length / 2 - .1), vector.y * (travel + bus.length / 2 - .1), .55));
          this.burst(front, '#f6c55c', 9); sparked = true;
        }
        move = (1 - ease((t - impactT) / (1 - impactT))) * travel;
      }
      group.position.copy(start).add(v(vector.x * move, vector.y * move));
      const wobble = this.reduced ? 0 : Math.sin(t * 38) * .04 * Math.sin(t * Math.PI);
      group.rotation.z = wobble;
      other.position.copy(otherStart).add(v(vector.x * wobble, vector.y * wobble));
    }, () => {
      group.position.copy(start); group.rotation.z = 0; other.position.copy(otherStart); done();
    });
  }
  departure(bus: Bus, done: () => void) {
    const group = this.buses.get(bus.id)!.group;
    const start = group.position.clone();
    // Reverse gently out of the bay, turn onto the road, then head off the map.
    const points = [start, v(start.x, -2.65, .08), v(6.1, -2.65, .08), v(9.5, -2.65, .08)];
    this.burst(start.clone().add(v(0, .6, .2)), '#d7ead8', 7);
    this.follow(group, points, () => { group.visible = false; done(); }, .3);
  }
  queuePosition(index: number) {
    const row = Math.floor(index / 7), column = index % 7;
    return v((row === 0 ? 3 - column : -3 + column) * .55, -6.5 - row * .48, .12);
  }
  linePosition(lane: number, index: number) {
    const col = index % 4, row = Math.floor(index / 4);
    return v((lane === 0 ? -4.35 : 4.35) + (col - 1.5) * .37, -7.65 - row * .39, .12);
  }
  syncPeople(initial = false) {
    const visible = new Set<number>();
    const add = (person: Person, target: THREE.Vector3) => {
      visible.add(person.id);
      let visual = this.people.get(person.id);
      if (!visual) {
        const mesh = new THREE.Mesh(personGeometry, material(PALETTE[person.color].hex));
        mesh.castShadow = true;
        mesh.position.copy(initial ? target : this.linePosition(person.lane, 24));
        this.scene.add(mesh);
        visual = { mesh, target, boarding: false, phase: person.id * .83 }; this.people.set(person.id, visual);
      }
      if (!visual.boarding) visual.target.copy(target);
    };
    this.state.queue.forEach((person, i) => add(person, this.queuePosition(i)));
    this.state.lines.forEach((line, lane) => line.slice(0, 24).forEach((person, i) => add(person, this.linePosition(lane, i))));
    for (const [id, visual] of this.people) if (!visible.has(id) && !visual.boarding) {
      this.scene.remove(visual.mesh); this.people.delete(id);
    }
  }
  board(person: Person, bus: Bus) {
    const visual = this.people.get(person.id);
    if (!visual) return;
    visual.boarding = true;
    const start = visual.mesh.position.clone();
    const end = v(DOCK_X[bus.dock!] + .45, DOCK_Z - .6, .12);
    const via = v(end.x, -5.85, .12);
    this.animate(.43, t => {
      if (t < .55) visual.mesh.position.lerpVectors(start, via, ease(t / .55));
      else visual.mesh.position.lerpVectors(via, end, ease((t - .55) / .45));
      visual.mesh.position.y += Math.sin(t * Math.PI * 6) * .025;
      visual.mesh.scale.setScalar(t > .83 ? Math.max(.03, (1 - t) / .17) : 1);
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
    return this.project(bus.group.position.clone().add(new THREE.Vector3(0, .65, 0)));
  }
  update(dt: number) {
    this.elapsed += dt;
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
        visual.halo.scale.set(scale, 1, scale);
      }
      const show = bus.status === 'docked' || bus.status === 'leaving';
      visual.tag.hidden = !show;
      if (show) {
        const screen = this.project(visual.group.position.clone().add(new THREE.Vector3(0, 1.28, 0)));
        visual.tag.style.transform = 'translate(' + screen.x + 'px,' + screen.y + 'px) translate(-50%, -50%)';
        visual.tag.style.setProperty('--bus-color', PALETTE[bus.color].hex);
        visual.tag.textContent = (bus.status === 'leaving' ? '✓ ' : '') + bus.filled + '/' + bus.capacity;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
