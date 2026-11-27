'use strict';
/* GULLWING RIDGE — Kestrel 07. A complete low-poly flight sortie:
   take off from the island runway, thread six glowing bay gates in order,
   then land back on the same runway and get graded on the touchdown.
   Plain Three.js, no network, keyboard + mouse. */

const KT = 1.94384;              // m/s -> knots
const FT = 3.28084;              // m -> feet
const WORLD = 2600;              // sea plane half-extent (m)
const RWY = { x: 0, zTop: -420, zBot: 260, w: 46, h: 14 }; // runway strip, runs north-south

/* ---------- deterministic island height field ---------- */
function gauss(x, z, cx, cz, r, h) {
  const dx = (x - cx) / r, dz = (z - cz) / r;
  const d2 = dx * dx + dz * dz;
  return d2 > 9 ? 0 : h * Math.exp(-d2 * 1.6);
}
function rawHeight(x, z) {
  let h = -26;                                       // seabed
  h += gauss(x, z, 0, -60, 760, 150);                // main island mass
  h += gauss(x, z, -140, -420, 300, 150);            // northern peak
  h += gauss(x, z, 330, 260, 260, 66);               // eastern knoll
  h += gauss(x, z, -430, 330, 230, 52);              // western knoll
  h += gauss(x, z, -980, -880, 330, 118);            // NW island
  h += gauss(x, z, 1020, -1080, 260, 84);            // NE island
  h += gauss(x, z, 900, 780, 210, 58);               // SE islet
  h += gauss(x, z, -1080, 900, 180, 44);             // SW islet
  h += Math.sin(x * 0.004 + z * 0.003) * 3.2 * Math.max(0, Math.min(1, (h + 10) / 40));
  return h;
}
function heightAt(x, z) {
  // carve a north-south approach valley along the runway axis: terrain may not
  // rise faster than a 5% glide slope away from either threshold
  let raw = rawHeight(x, z);
  const dzc = z < RWY.zTop ? RWY.zTop - z : (z > RWY.zBot ? z - RWY.zBot : 0);
  const glide = RWY.h + dzc * 0.05;
  const cx = Math.abs(x - RWY.x);
  if (cx < 170 && raw > glide) {
    const t = cx < 60 ? 0 : (cx - 60) / 110;
    raw = glide + (raw - glide) * t * t;
  }
  // flatten a pad for the runway and its apron
  const dx = Math.abs(x - RWY.x), dz = dzc;
  const d = Math.max(dx - RWY.w * 0.5, dz, 0);
  if (d <= 0) return RWY.h;
  if (d < 90) { const tt = d / 90; return RWY.h + (raw - RWY.h) * tt * tt; }
  return raw;
}
function onRunway(x, z) {
  return Math.abs(x - RWY.x) <= RWY.w * 0.5 && z >= RWY.zTop && z <= RWY.zBot;
}

/* ---------- renderer / scene ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeac49a);
scene.fog = new THREE.Fog(0xe3c298, 1500, 6600);
/* gradient sky dome with a warm glow around the sun's side of the sky */
function buildSky() {
  const geo = new THREE.SphereGeometry(9000, 24, 14);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x466e7d), mid = new THREE.Color(0xb3beb2);
  const low = new THREE.Color(0xf6bf78), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 9000;
    if (y > 0.12) tmp.copy(mid).lerp(top, Math.min(1, (y - 0.12) / 0.7));
    else tmp.copy(low).lerp(mid, Math.max(0, (y + 0.08) / 0.2));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  return sky;
}
scene.add(buildSky());
/* image-based light: a painted equirect sky (gradient + sun blob + sea band)
   run through PMREM so standard materials pick up real sky reflections */
function buildEnvironment() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#3d6474'); grad.addColorStop(0.42, '#b3beb2');
  grad.addColorStop(0.52, '#f6bf78'); grad.addColorStop(0.58, '#7d94a0');
  grad.addColorStop(1, '#274b5c');
  x.fillStyle = grad; x.fillRect(0, 0, 1024, 512);
  const sunG = x.createRadialGradient(300, 250, 6, 300, 250, 190);
  sunG.addColorStop(0, 'rgba(255,230,180,0.95)');
  sunG.addColorStop(0.25, 'rgba(255,190,110,0.55)');
  sunG.addColorStop(1, 'rgba(255,170,90,0)');
  x.fillStyle = sunG; x.fillRect(0, 0, 1024, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
}
buildEnvironment();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 12000);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
scene.add(new THREE.HemisphereLight(0xffdfb0, 0x4a6741, 0.85));
const sun = new THREE.DirectionalLight(0xffc98a, 1.3);
sun.position.set(-900, 1400, -600);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
sun.shadow.camera.near = 100; sun.shadow.camera.far = 3200;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

/* ---------- terrain mesh, coloured by height ---------- */
/* shared painted grain: one noise canvas textures terrain, sea and runway */
function makeNoiseTexture(size, base, spread, blotch) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')'; x.fillRect(0, 0, size, size);
  let seed = 424243;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < blotch; i++) {
    const v = base + Math.round((rnd() - 0.5) * spread);
    x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.16)';
    x.beginPath(); x.arc(rnd() * size, rnd() * size, 8 + rnd() * 42, 0, Math.PI * 2); x.fill();
  }
  const img = x.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * spread * 0.9;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const grainTex = makeNoiseTexture(512, 205, 70, 260);
function buildTerrain() {
  const size = WORLD * 2, seg = 200;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xe8d193), cGrass = new THREE.Color(0x69a854);
  const cForest = new THREE.Color(0x3e7d44), cRock = new THREE.Color(0x8a7f74);
  const cPeak = new THREE.Color(0xd9d9d2), cSea = new THREE.Color(0x2f7ea6);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    if (h < 1.5) tmp.copy(cSea).lerp(new THREE.Color(0x49a3bd), Math.max(0, (h + 26) / 27));
    else if (h < 6) tmp.copy(cSand);
    else if (h < 48) tmp.copy(cGrass).lerp(cForest, (h - 6) / 42);
    else if (h < 105) tmp.copy(cForest).lerp(cRock, (h - 48) / 57);
    else tmp.copy(cRock).lerp(cPeak, Math.min(1, (h - 105) / 60));
    // steep faces read as bare rock whatever their height, like the reference crags
    const slope = Math.abs(heightAt(x + 16, z) - h) + Math.abs(heightAt(x, z + 16) - h);
    if (h > 6 && slope > 9) tmp.lerp(cRock, Math.min(0.75, (slope - 9) / 14));
    const jitter = ((i * 7919) % 13) / 13 * 0.05 - 0.025;
    colors[i * 3] = tmp.r + jitter; colors[i * 3 + 1] = tmp.g + jitter; colors[i * 3 + 2] = tmp.b + jitter;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const tex = grainTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(30, 30);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
scene.add(buildTerrain());

/* sea surface (translucent, animated in the loop) */
const seaBump = grainTex.clone();
seaBump.needsUpdate = true;
seaBump.repeat.set(90, 90);
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD * 2.4, WORLD * 2.4),
  new THREE.MeshPhongMaterial({ color: 0x2e86ab, specular: 0x5f8a90, shininess: 190, transparent: true, opacity: 0.9, bumpMap: seaBump, bumpScale: 0.7 })
);
sea.rotation.x = -Math.PI / 2; sea.position.y = 0.4;
scene.add(sea);

/* ---------- runway, apron buildings, tower ---------- */
function box(w, h, d, color, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, flatShading: true }));
  m.position.set(x, y, z); if (ry) m.rotation.y = ry;
  scene.add(m); return m;
}
function runwayTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#33373c'; x.fillRect(0, 0, 256, 1024);
  let seed = 777001;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 9000; i++) {
    const v = 42 + Math.round(rnd() * 26);
    x.fillStyle = 'rgb(' + v + ',' + (v + 3) + ',' + (v + 7) + ')';
    x.fillRect(rnd() * 256, rnd() * 1024, 2, 2);
  }
  // rubber streaks in both touchdown zones
  for (const zy of [150, 874]) {
    for (let i = 0; i < 260; i++) {
      x.fillStyle = 'rgba(12,12,14,' + (0.05 + rnd() * 0.13) + ')';
      x.fillRect(96 + rnd() * 64, zy + (rnd() - 0.5) * 130, 3 + rnd() * 5, 8 + rnd() * 22);
    }
  }
  x.fillStyle = '#e8ecec';
  x.fillRect(10, 0, 5, 1024); x.fillRect(241, 0, 5, 1024);      // edge lines
  for (let z = 70; z < 980; z += 62) x.fillRect(124, z, 8, 34); // centreline dashes
  for (const zy of [18, 988]) for (let b = 0; b < 6; b++) x.fillRect(28 + b * 36, zy, 20, 12); // threshold bars
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
function buildAirfield() {
  const rw = new THREE.Mesh(new THREE.BoxGeometry(RWY.w, 1.2, RWY.zBot - RWY.zTop),
    new THREE.MeshLambertMaterial({ map: runwayTexture() }));
  rw.position.set(RWY.x, RWY.h + 0.4, (RWY.zTop + RWY.zBot) / 2);
  rw.receiveShadow = true;
  scene.add(rw);
  for (const sx of [-1, 1]) for (let z = RWY.zTop + 8; z < RWY.zBot; z += 34) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff6c9 }));
    lamp.position.set(RWY.x + sx * (RWY.w / 2 + 3), RWY.h + 2.2, z); scene.add(lamp);
  }
  // hangars with orange trim + control tower (debrief backdrop, ref 2)
  for (let i = 0; i < 2; i++) {
    const hx = -95 - i * 78, hz = 150 - i * 30;
    const hangar = new THREE.Mesh(new THREE.CylinderGeometry(21, 21, 58, 12, 1, false, 0, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x9aa4ab, flatShading: true }));
    hangar.rotation.z = Math.PI / 2; hangar.rotation.y = Math.PI / 2;
    hangar.position.set(hx, RWY.h + 1, hz); scene.add(hangar);
    box(60, 3.5, 44, 0xe86f2e, hx, RWY.h + 9, hz);
    box(60, 15, 44, 0x767f86, hx, RWY.h + 1, hz + 0);
  }
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 44, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8ecec, flatShading: true }));
  shaft.position.y = 22; tower.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(11, 9, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0x274b63, flatShading: true }));
  cab.position.y = 48; tower.add(cab);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 3, 10),
    new THREE.MeshLambertMaterial({ color: 0xe86f2e, flatShading: true }));
  roof.position.y = 54; tower.add(roof);
  tower.position.set(88, RWY.h, 60);
  scene.add(tower);
}
buildAirfield();

/* low-poly trees on the green slopes */
function buildTrees() {
  const trunkG = new THREE.CylinderGeometry(0.7, 1, 4, 5);
  const leafG = new THREE.ConeGeometry(4.4, 13, 6);
  const trunkM = new THREE.MeshLambertMaterial({ color: 0x6b4a2e, flatShading: true });
  const leafM = new THREE.MeshLambertMaterial({ color: 0x2f6e3c, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkG, trunkM, 420);
  const leaves = new THREE.InstancedMesh(leafG, leafM, 420);
  const m4 = new THREE.Matrix4(); let n = 0;
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 4000 && n < 420; i++) {
    const x = (rnd() * 2 - 1) * 1500, z = (rnd() * 2 - 1) * 1500;
    const h = heightAt(x, z);
    if (h < 8 || h > 95 || onRunway(x, z) || Math.abs(x) < 70 && z > -480 && z < 320) continue;
    const s = 0.8 + rnd() * 0.9;
    m4.makeScale(s, s, s).setPosition(x, h + 2 * s, z); trunks.setMatrixAt(n, m4);
    m4.makeScale(s, s, s).setPosition(x, h + (4 + 6) * s, z); leaves.setMatrixAt(n, m4);
    n++;
  }
  trunks.count = leaves.count = n;
  scene.add(trunks); scene.add(leaves);
}
buildTrees();

/* soft cartoon clouds */
const clouds = [];
function buildClouds() {
  // soft billboard puffs: a radial-gradient sprite reads as a painted cloud
  const cc = document.createElement('canvas'); cc.width = 256; cc.height = 160;
  const cx2 = cc.getContext('2d');
  for (const [px, py, r] of [[128, 84, 62], [76, 92, 40], [182, 92, 44], [108, 66, 38], [152, 68, 34]]) {
    const gr = cx2.createRadialGradient(px, py, 4, px, py, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.65, 'rgba(255,255,255,0.42)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx2.fillStyle = gr;
    cx2.fillRect(0, 0, 256, 160);
  }
  const tex = new THREE.CanvasTexture(cc);
  let seed = 987654;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 30; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75 + rnd() * 0.2, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(mat);
    const w = 190 + rnd() * 260;
    sp.scale.set(w, w * 0.5, 1);
    sp.position.set((rnd() * 2 - 1) * 2800, 320 + rnd() * 200, (rnd() * 2 - 1) * 2800);
    scene.add(sp); clouds.push(sp);
  }
}
buildClouds();

/* ---------- the Kestrel 07: twin-tail jet, white & orange (ref-2 shape) ----------
   Built entirely from code geometry: swept extruded wings, canted twin fins,
   two round engines with throttle-driven exhaust glow. No model files. */
function flatShape(points, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
}
function buildPlane() {
  const g = new THREE.Group();
  // painted skin for the lathed body: faint panel lines + grime, drawn in code
  const skinC = document.createElement('canvas'); skinC.width = 1024; skinC.height = 256;
  const sk = skinC.getContext('2d');
  sk.fillStyle = '#f2f0ea'; sk.fillRect(0, 0, 1024, 256);
  let seed = 31337;
  const srnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 5200; i++) {
    const v = 226 + Math.round(srnd() * 22);
    sk.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 4) + ')';
    sk.fillRect(srnd() * 1024, srnd() * 256, 2, 2);
  }
  sk.strokeStyle = 'rgba(90,90,88,0.35)'; sk.lineWidth = 2;
  for (let i = 0; i < 26; i++) { // longitudinal panel seams (u runs around the body)
    const px = (i / 26) * 1024 + srnd() * 8;
    sk.beginPath(); sk.moveTo(px, 0); sk.lineTo(px, 256); sk.stroke();
  }
  sk.strokeStyle = 'rgba(90,90,88,0.22)';
  for (const py of [42, 128, 214]) { sk.beginPath(); sk.moveTo(0, py); sk.lineTo(1024, py); sk.stroke(); }
  sk.fillStyle = 'rgba(70,64,58,0.10)';
  for (let i = 0; i < 26; i++) sk.fillRect(srnd() * 1024, 190 + srnd() * 60, 20 + srnd() * 60, 3); // belly grime
  const skinTex = new THREE.CanvasTexture(skinC);
  skinTex.wrapS = THREE.RepeatWrapping;
  const white = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.34, metalness: 0.08 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe86f2e, roughness: 0.42, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3438, roughness: 0.6, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.08, metalness: 0.4 });
  // one continuous lathed body: the profile curve IS the aeroplane's shape,
  // nose tip to tail cone in a single smooth surface (no cylinder joins)
  const profile = [
    [0.01, -7.4], [0.2, -7.05], [0.46, -6.3], [0.72, -5.3], [0.9, -4.1],
    [0.98, -2.2], [1.0, 0.0], [0.98, 2.0], [0.92, 3.6], [0.82, 5.0],
    [0.64, 6.0], [0.42, 6.6], [0.01, 6.95],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const fusGeo = new THREE.LatheGeometry(profile, 30);
  fusGeo.rotateX(Math.PI / 2); // lathe axis becomes the body's long axis, nose to -Z
  const fus = new THREE.Mesh(fusGeo, white);
  g.add(fus);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.86, 20, 14), glass);
  cockpit.scale.set(0.76, 0.6, 2.0); cockpit.position.set(0, 0.62, -3.5); g.add(cockpit);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 6.4), orange);
  spine.position.set(0, 0.88, 1.2); g.add(spine);
  // swept wings: shape drawn with +Y as forward, extruded thin, laid flat
  for (const sx of [-1, 1]) {
    const wingGeo = flatShape([[0.6 * sx, 2.0], [6.9 * sx, -0.7], [6.9 * sx, -1.9], [0.6 * sx, -1.5]], 0.2);
    const wing = new THREE.Mesh(wingGeo, white);
    wing.rotation.x = -Math.PI / 2;
    wing.position.set(0, -0.42, 0);
    g.add(wing);
    const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.0, 1.15), orange);
    winglet.position.set(sx * 6.85, 0.05, 1.35);
    winglet.rotation.z = sx * -0.25;
    g.add(winglet);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 2.6), dark);
    intake.position.set(sx * 1.55, -0.62, -0.4); g.add(intake);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5),
      new THREE.MeshBasicMaterial({ color: sx < 0 ? 0xff4444 : 0x44ff77 }));
    nav.position.set(sx * 6.9, -0.3, 0.6); g.add(nav);
    // rear engines with glowing exhausts
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.54, 3.6, 14), dark);
    eng.rotation.x = Math.PI / 2; eng.position.set(sx * 1.08, -0.28, 4.6); g.add(eng);
    const exhaust = new THREE.Mesh(new THREE.CircleGeometry(0.33, 14),
      new THREE.MeshBasicMaterial({ color: 0xb85f1a }));
    exhaust.position.set(sx * 1.08, -0.28, 6.42); g.add(exhaust);
    // horizontal stabilisers
    const stabGeo = flatShape([[1.0 * sx, 0.9], [3.1 * sx, -0.5], [3.1 * sx, -1.2], [1.0 * sx, -0.7]], 0.16);
    const stab = new THREE.Mesh(stabGeo, white);
    stab.rotation.x = -Math.PI / 2; stab.position.set(0, 0.28, 5.4); g.add(stab);
    // canted twin fins, orange-tipped
    const finGeo = flatShape([[2.2, 0.1], [0.7, 2.6], [-0.9, 2.6], [-1.7, 0.1]], 0.16);
    const fin = new THREE.Mesh(finGeo, white);
    fin.rotation.y = Math.PI / 2;
    const finWrap = new THREE.Group();
    finWrap.add(fin);
    finWrap.position.set(sx * 1.62, 0.3, 4.6);
    finWrap.rotation.z = sx * -0.3;
    g.add(finWrap);
    const finTipGeo = flatShape([[0.7, 2.6], [-0.9, 2.6], [-1.05, 2.05], [0.45, 2.05]], 0.17);
    const finTip = new THREE.Mesh(finTipGeo, orange);
    finTip.rotation.y = Math.PI / 2;
    finWrap.add(finTip);
  }
  // exhaust glow sprites, fed by throttle in the main loop
  const glowC = document.createElement('canvas'); glowC.width = glowC.height = 128;
  const gc = glowC.getContext('2d');
  const grad = gc.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,190,90,0.95)');
  grad.addColorStop(0.4, 'rgba(255,120,40,0.55)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  gc.fillStyle = grad; gc.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(glowC);
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sx of [-1, 1]) {
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(1.9, 1.9, 1);
    glow.position.set(sx * 1.08, -0.28, 6.9);
    g.add(glow);
  }
  g.userData.glowMat = glowMat;
  // painted name decals on both flanks, drawn on a canvas (no image files)
  const decalC = document.createElement('canvas'); decalC.width = 512; decalC.height = 96;
  const dc = decalC.getContext('2d');
  dc.fillStyle = '#2b3438'; dc.font = 'bold 58px Segoe UI, Arial'; dc.textAlign = 'center';
  dc.fillText('K E S T R E L', 256, 62);
  const decalTex = new THREE.CanvasTexture(decalC);
  for (const sx of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.82),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, side: THREE.DoubleSide }));
    decal.position.set(sx * 1.01, 0.16, -0.6);
    decal.rotation.y = sx * Math.PI / 2;
    g.add(decal);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const legs = new THREE.Group();
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.4, 5), dark);
    leg.position.set(sx * 1.5, -1.2, 0.5); legs.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.34, 10), dark);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(sx * 1.5, -1.9, 0.5); legs.add(wheel);
  }
  const noseLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 5), dark);
  noseLeg.position.set(0, -1.15, -4.3); legs.add(noseLeg);
  const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 10), dark);
  noseWheel.rotation.z = Math.PI / 2; noseWheel.position.set(0, -1.8, -4.3); legs.add(noseWheel);
  g.add(legs);
  const prop = new THREE.Group(); // jets have no prop; kept so spin references stay harmless
  g.userData.blurDisc = { material: { opacity: 0 } };
  return { group: g, prop, legs };
}
const plane = buildPlane();
scene.add(plane.group);

/* ---------- gates: six glowing rings flown in order ---------- */
const GATE_DEFS = [
  { x: 330,   y: 110,  z: 520,   ry: -0.5 },
  { x: -380,  y: 80,  z: 560,   ry: 2.9 },
  { x: -880,  y: 90,  z: 120,   ry: 2.2 },
  { x: -1010, y: 105, z: -620,  ry: 1.5 },
  { x: -560,  y: 120, z: -1080, ry: 0.9 },
  { x: 60,    y: 95,  z: -760,  ry: 0.25 },
];
const GATE_R = 34;
const gates = GATE_DEFS.map((d, i) => {
  const grp = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(GATE_R, 1.7, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x8a97a0 }));
  grp.add(ring);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(GATE_R + 3.4, 0.7, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xdfe9ec, transparent: true, opacity: 0.5 }));
  grp.add(halo);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.35, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xcfd8dc }));
    dot.position.set(Math.cos(a) * GATE_R, Math.sin(a) * GATE_R, 0);
    grp.add(dot);
  }
  grp.position.set(d.x, d.y, d.z);
  grp.rotation.y = d.ry;
  scene.add(grp);
  return { grp, ring, halo, def: d, idx: i };
});
function paintGates(activeIdx, doneCount) {
  for (const gt of gates) {
    const isActive = gt.idx === activeIdx;
    const isDone = gt.idx < doneCount;
    const col = isDone ? 0x39d98a : isActive ? 0xffa726 : 0x8a97a0;
    gt.ring.material.color.setHex(col);
    gt.halo.material.color.setHex(isDone ? 0x39d98a : isActive ? 0xffc46b : 0xdfe9ec);
    gt.grp.children.forEach((c, k) => { if (k >= 2) c.material.color.setHex(col); });
    gt.grp.visible = !isDone || isActive;
    if (isDone) gt.grp.visible = false;
  }
}

/* ---------- simple burst particles for gate clears & touchdown ---------- */
const bursts = [];
function burst(x, y, z, color, n, spread) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    v.push(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread * 0.7, (Math.random() - 0.5) * spread));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 2.6 }));
  scene.add(pts);
  bursts.push({ pts, v, life: 1 });
}
function stepBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.life -= dt * 0.9;
    const p = b.pts.geometry.attributes.position;
    for (let k = 0; k < b.v.length; k++) {
      p.setXYZ(k, p.getX(k) + b.v[k].x * dt, p.getY(k) + b.v[k].y * dt, p.getZ(k) + b.v[k].z * dt);
      b.v[k].y -= 12 * dt;
    }
    p.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, b.life);
    b.pts.material.transparent = true;
    if (b.life <= 0) { scene.remove(b.pts); bursts.splice(i, 1); }
  }
}

/* ---------- audio: all synthesised, no files ---------- */
const AudioSys = {
  ctx: null, engineOsc: null, engineGain: null, windGain: null, musicTimer: null, note: 0,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const c = this.ctx;
      this.engineOsc = c.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
      this.engineOsc.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(c.destination);
      this.engineOsc.start();
      const windBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = windBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const wind = c.createBufferSource(); wind.buffer = windBuf; wind.loop = true;
      const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 700;
      this.windGain = c.createGain(); this.windGain.gain.value = 0;
      wind.connect(wf); wf.connect(this.windGain); this.windGain.connect(c.destination);
      wind.start();
      this.startMusic();
    } catch (e) { /* audio is a bonus, never a blocker */ }
  },
  blip(freq, dur, vol, type) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  },
  gateChime() { this.blip(880, 0.22, 0.16); setTimeout(() => this.blip(1318, 0.3, 0.16), 90); },
  thud() { this.blip(72, 0.25, 0.3, 'triangle'); },
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.35, 0.15), i * 130)); },
  startMusic() {
    // gentle island loop: a slow pentatonic figure over a soft pad
    const scale = [262, 294, 330, 392, 440, 392, 330, 294];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || S.mode === 'briefing') return;
      const f = scale[this.note % scale.length]; this.note++;
      this.blip(f, 1.4, 0.045, 'triangle');
      if (this.note % 4 === 0) this.blip(f / 2, 2.2, 0.035, 'sine');
    }, 620);
  },
  update(throttle, speedKt, running) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(running ? 0.015 + throttle * 0.05 : 0, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(48 + throttle * 65, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.06, speedKt / 3000), t, 0.2);
  },
};

/* ---------- input ---------- */
const keys = {};
let mouseYoke = { active: false, pitch: 0, roll: 0 };
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'Space', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyG' && S.mode === 'play') toggleGear();
  if (e.code === 'KeyF' && S.mode === 'play') cycleFlap();
  if (e.code === 'KeyP' && S.mode === 'play') togglePause();
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyH') showBriefing();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => { mouseYoke.active = true; mouseYoke.sx = e.clientX; mouseYoke.sy = e.clientY; });
window.addEventListener('mousemove', (e) => {
  if (!mouseYoke.active) return;
  mouseYoke.roll = Math.max(-1, Math.min(1, (e.clientX - mouseYoke.sx) / 140));
  mouseYoke.pitch = Math.max(-1, Math.min(1, (e.clientY - mouseYoke.sy) / 140));
});
window.addEventListener('mouseup', () => { mouseYoke.active = false; mouseYoke.pitch = 0; mouseYoke.roll = 0; });

/* ---------- sortie state ---------- */
const S = {
  mode: 'briefing',           // briefing | play | debrief | crashed
  paused: false, free: false,
  pos: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0,
  speed: 0,                   // m/s forward
  vy: 0, throttle: 0, fuel: 89, hull: 100,
  gearDown: true, flap: 0,    // flap: 0, 15, 30 degrees
  onGround: true, airborne: false, time: 0,
  gateIdx: 0, score: 0, gLoad: 1, stalled: false,
  touchdown: null, finished: false, propSpin: 0,
};
function resetSortie(free) {
  S.mode = 'play'; S.paused = false; S.free = !!free; S.finished = false;
  S.pos.set(RWY.x, RWY.h + 2.6, -350);
  S.heading = Math.PI; // nose points south (+Z) down RWY 18, out over the bay; compass derives from the forward vector
  S.pitch = 0; S.roll = 0; S.speed = 0; S.vy = 0; S.throttle = 0;
  S.fuel = 89; S.hull = 100; S.gearDown = true; S.flap = 0;
  S.onGround = true; S.airborne = false; S.time = 0;
  S.gateIdx = 0; S.score = 0; S.gLoad = 1; S.stalled = false; S.touchdown = null;
  paintGates(0, 0);
  document.getElementById('debrief').style.display = 'none';
  document.getElementById('briefing').style.display = 'none';
  setMsg(free ? 'Free flight — the island is yours.' : 'Throttle up. Rotate at 62 kt.', 3.5);
}
function toggleGear() {
  S.gearDown = !S.gearDown;
  plane.legs.visible = S.gearDown;
  AudioSys.blip(S.gearDown ? 340 : 260, 0.15, 0.12);
  setMsg(S.gearDown ? 'Gear DOWN' : 'Gear UP', 1.4);
}
function cycleFlap() {
  S.flap = S.flap === 0 ? 15 : S.flap === 15 ? 30 : 0;
  AudioSys.blip(420, 0.12, 0.1);
  setMsg('Flaps ' + S.flap + '°', 1.2);
}
function togglePause() {
  S.paused = !S.paused;
  setMsg(S.paused ? 'PAUSED — P to resume' : '', S.paused ? 999 : 0);
}
let msgTimer = 0;
function setMsg(t, secs) {
  document.getElementById('msg').textContent = t;
  msgTimer = secs || 0;
}

/* ---------- flight model: arcade-true, every number earned ---------- */
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3();
function orientation() {
  _euler.set(S.pitch, S.heading, S.roll, 'YXZ');
  _quat.setFromEuler(_euler);
  _fwd.set(0, 0, -1).applyQuaternion(_quat);
  _up.set(0, 1, 0).applyQuaternion(_quat);
  return _quat;
}
function compassDeg() {
  orientation();
  let d = Math.atan2(_fwd.x, -_fwd.z) * 180 / Math.PI;
  return (d + 360) % 360;
}
function stepFlight(dt) {
  if (S.fuel <= 0) S.throttle = Math.min(S.throttle, 0);
  // throttle: Shift up, Ctrl down, smooth spool
  const thrRate = 0.55;
  if (keys['ShiftLeft'] || keys['ShiftRight']) S.throttle = Math.min(1, S.throttle + thrRate * dt);
  if (keys['ControlLeft'] || keys['ControlRight']) S.throttle = Math.max(0, S.throttle - thrRate * dt);
  if (S.fuel > 0) S.fuel = Math.max(0, S.fuel - dt * (0.12 + S.throttle * 0.55));
  // controls: keyboard yoke + mouse yoke
  let pitchIn = 0, rollIn = 0;
  if (keys['KeyS'] || keys['ArrowDown']) pitchIn += 1;       // pull = climb
  if (keys['KeyW'] || keys['ArrowUp']) pitchIn -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) rollIn -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) rollIn += 1;
  if (mouseYoke.active) { pitchIn += mouseYoke.pitch; rollIn += mouseYoke.roll; }
  pitchIn = Math.max(-1, Math.min(1, pitchIn));
  rollIn = Math.max(-1, Math.min(1, rollIn));
  const authority = S.onGround ? Math.min(1, S.speed / 28) : 1;
  // roll sign: negative Z-roll drops the right wing, which is a right bank
  S.roll += ((-rollIn * 1.05) - S.roll) * Math.min(1, dt * (S.onGround ? 2 : 3.2));
  // bank turns the nose; turn rate grows with bank, fades near the ground
  const turnRate = Math.sin(S.roll) * 0.62 * Math.min(1, S.speed / 30);
  if (!S.onGround) S.heading += turnRate * dt;
  S.gLoad = Math.cos(S.roll) === 0 ? 1 : 1 / Math.max(0.35, Math.cos(S.roll));
  // the yoke moves the nose at a steady rate and the nose stays where it is put:
  // tap W to settle into a descent, tap S to flare — that is how she lands
  S.pitch += pitchIn * 0.38 * dt * authority;
  if (S.stalled) S.pitch -= dt * 0.25; // a stall drops the nose on its own
  S.pitch = Math.max(-0.4, Math.min(0.46, S.pitch));
  if (S.onGround && S.speed < 24) S.pitch = Math.max(0, S.pitch); // no tail-strike on the roll
  orientation();
  // thrust, drag (gear & flaps cost speed), gravity along the flight path
  const kt = S.speed * KT;
  const stallKt = S.flap === 30 ? 44 : S.flap === 15 ? 46 : 50;
  S.stalled = S.airborne && kt < stallKt;
  const dragBase = 0.55 + (S.gearDown ? 0.5 : 0) + (S.flap === 15 ? 0.45 : S.flap === 30 ? 0.95 : 0)
    + (keys['Space'] ? 2.4 : 0) + Math.abs(S.roll) * 0.7;
  let accel = S.throttle * 13.5 - dragBase * (S.speed / 34) - S.speed * S.speed * 0.0011 - 9.2 * _fwd.y * (S.onGround ? 0.25 : 1);
  if (S.onGround) accel -= (keys['KeyB'] ? 7.5 : 0.35); // rolling friction / brakes
  S.speed = Math.max(0, S.speed + accel * dt);
  // lift: keeps her up when fast & level, quits in a stall
  const liftNeeded = 9.2;
  let lift = Math.min(1.25, (S.speed / 26) * (S.speed / 26)) * (S.flap === 30 ? 1.18 : S.flap === 15 ? 1.09 : 1);
  if (S.stalled) lift *= 0.45;
  const vyTarget = Math.max(-26, Math.min(20, _fwd.y * S.speed)) + (lift - 1) * 3.4 - (S.stalled ? 6.5 : 0);
  S.vy += (vyTarget - S.vy) * Math.min(1, dt * 2.2);
  // integrate
  const vx = _fwd.x * S.speed, vz = _fwd.z * S.speed;
  S.pos.x += vx * dt; S.pos.z += vz * dt;
  S.pos.y += S.vy * dt;
  S.pos.x = Math.max(-2400, Math.min(2400, S.pos.x));
  S.pos.z = Math.max(-2400, Math.min(2400, S.pos.z));
  S.pos.y = Math.min(1500, S.pos.y);
  const groundY = heightAt(S.pos.x, S.pos.z) + 2.6;
  const wasAirborne = S.airborne;
  if (S.pos.y <= groundY) {
    S.pos.y = groundY;
    handleGroundContact(wasAirborne);
  } else {
    S.onGround = false; S.airborne = true;
  }
  if (S.airborne && !wasAirborne && !S.finished) setMsg('Airborne. Gate 1 is lit orange — chase it.', 3);
  // gate capture: crossing the ring's disc, in order
  if (S.airborne && !S.free && S.gateIdx < gates.length) checkGate();
  S.time += dt;
  S.propSpin += dt * (4 + S.throttle * 46);
}
function handleGroundContact(wasAirborne) {
  // the flattened apron around the strip counts as runway for touchdown:
  // clipping the grass 20 m short of the threshold should not end a sortie
  const onRw = onRunway(S.pos.x, S.pos.z) ||
    (Math.abs(S.pos.x - RWY.x) <= RWY.w * 0.5 + 6 && S.pos.z >= RWY.zTop - 40 && S.pos.z <= RWY.zBot + 40 &&
     Math.abs(heightAt(S.pos.x, S.pos.z) - RWY.h) < 1.5);
  const sink = -S.vy; // m/s downward at contact
  if (!wasAirborne) { S.onGround = true; S.vy = Math.max(0, S.vy); return; }
  // a real touchdown
  S.onGround = true; S.airborne = false;
  AudioSys.thud();
  const sinkFpm = Math.round(sink * 196.85);
  const centre = Math.abs(S.pos.x - RWY.x);
  const dmg = Math.max(0, (sink - 2.2) * 9) + (!S.gearDown ? 26 : 0) + (onRw ? 0 : 14);
  S.hull = Math.max(0, S.hull - dmg);
  burst(S.pos.x, S.pos.y, S.pos.z, 0xffffff, 16, 9);
  if (!onRw || sink > 7.5 || S.hull <= 0) {
    crash(onRw ? 'She came down too hard — the gear folded.' : 'Down off the runway. The island wins this one.');
    return;
  }
  S.touchdown = { sinkFpm, iasKt: Math.round(S.speed * KT), centreM: Math.round(centre * 10) / 10, at: S.time };
  if (!S.free && S.gateIdx >= gates.length && !S.finished) finishSortie();
  else if (!S.free && S.gateIdx < gates.length) setMsg('Touch-and-go counts for nothing — the gates are still waiting.', 3);
  else setMsg('Touchdown: ' + sinkFpm + ' FPM. Throttle up to fly again, B to stop.', 3.5);
}
function checkGate() {
  const gt = gates[S.gateIdx];
  const local = gt.grp.worldToLocal(S.pos.clone());
  const radial = Math.hypot(local.x, local.y);
  if (Math.abs(local.z) < 9 && radial < GATE_R) {
    const centreBonus = Math.round((1 - radial / GATE_R) * 150);
    const gained = 200 + centreBonus;
    S.score += gained;
    burst(gt.def.x, gt.def.y, gt.def.z, 0xffc46b, 30, 16);
    AudioSys.gateChime();
    S.gateIdx++;
    paintGates(S.gateIdx, S.gateIdx);
    if (S.gateIdx >= gates.length) setMsg('All six gates! Bring her home to RWY 18 — gear down, flaps in, gentle.', 4.5);
    else setMsg('Gate clear +' + gained + '. Next gate lit.', 2.2);
  }
}
function landingGrade(td) {
  if (td.sinkFpm <= 180) return { label: 'BUTTER LANDING', bonus: 2500 };
  if (td.sinkFpm <= 320) return { label: 'SMOOTH LANDING', bonus: 1800 };
  if (td.sinkFpm <= 520) return { label: 'FIRM LANDING', bonus: 1000 };
  if (td.sinkFpm <= 750) return { label: 'HARD LANDING', bonus: 400 };
  return { label: 'TEETH-RATTLER', bonus: 100 };
}
function finishSortie() {
  if (S.speed > 20) return; // still rolling fast: wait until she slows on the strip
  S.finished = true;
  const td = S.touchdown;
  const grade = landingGrade(td);
  const centrePenalty = Math.min(600, Math.round(td.centreM * 40));
  const total = S.score + grade.bonus - centrePenalty + Math.round(S.fuel * 10);
  S.score = total;
  AudioSys.fanfare();
  showDebrief({
    kicker: 'Sortie 01 · Golden Hour · Complete',
    title: 'TOUCHDOWN — ' + grade.label,
    sub: 'Landed on RWY 18 (Gullwing Ridge) at ' + td.sinkFpm + ' FPM sink rate, ' +
      td.iasKt + ' KT, ' + td.centreM + 'm off centreline.',
    sink: td.sinkFpm + ' FPM', ias: td.iasKt + ' KT · ' + td.centreM + 'M',
    gates: S.gateIdx + ' / 6', fuel: Math.round(S.fuel) + '% / ' + Math.round(S.hull) + '%',
    bonus: '+' + grade.bonus.toLocaleString(), score: total.toLocaleString(),
  });
}
function crash(why) {
  S.mode = 'crashed'; S.finished = true;
  burst(S.pos.x, S.pos.y + 2, S.pos.z, 0xff7b4d, 46, 20);
  AudioSys.thud();
  showDebrief({
    kicker: 'Sortie 01 · Ended Early',
    title: 'SORTIE OVER',
    sub: why + ' Gates cleared: ' + S.gateIdx + ' of 6.',
    sink: '—', ias: Math.round(S.speed * KT) + ' KT',
    gates: S.gateIdx + ' / 6', fuel: Math.round(S.fuel) + '% / ' + Math.round(S.hull) + '%',
    bonus: '+0', score: S.score.toLocaleString(),
  });
}
function showDebrief(d) {
  S.mode = 'debrief';
  document.getElementById('debKicker').textContent = d.kicker;
  document.getElementById('debTitle').textContent = d.title;
  document.getElementById('debSub').textContent = d.sub;
  document.getElementById('debSink').textContent = d.sink;
  document.getElementById('debIas').textContent = d.ias;
  document.getElementById('debGates').textContent = d.gates;
  document.getElementById('debFuel').textContent = d.fuel;
  document.getElementById('debBonus').textContent = d.bonus;
  document.getElementById('debScore').textContent = d.score;
  document.getElementById('debrief').style.display = 'flex';
}

/* ---------- HUD: heading tape, attitude ball, V/S dial, sector map ---------- */
const $ = (id) => document.getElementById(id);
const hdgCtx = $('headingCanvas').getContext('2d');
const attCtx = $('attCanvas').getContext('2d');
const vsCtx = $('vsCanvas').getContext('2d');
const mapCtx = $('mapCanvas').getContext('2d');
function drawHeading(deg) {
  const c = hdgCtx, W = 360, H = 30;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, 0, W, H);
  c.font = '10px Segoe UI'; c.textAlign = 'center';
  const base = Math.floor((deg - 58) / 5) * 5;
  for (let d = base; d <= deg + 58; d += 5) {
    const dd = ((d % 360) + 360) % 360;
    const px = W / 2 + (d - deg) * 2.6;
    if (px < 8 || px > W - 8) continue;
    const isCard = dd % 90 === 0, isTen = dd % 10 === 0;
    c.fillStyle = isCard ? '#ffd9a0' : '#cfe9ea';
    c.fillRect(px, isTen ? 4 : 9, 1.4, isTen ? 9 : 5);
    if (isTen) c.fillText(dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd).padStart(3, '0'), px, 26);
  }
  c.fillStyle = '#ffb347';
  c.beginPath(); c.moveTo(W / 2 - 6, 0); c.lineTo(W / 2 + 6, 0); c.lineTo(W / 2, 8); c.fill();
}
function drawAttitude(pitch, roll) {
  const c = attCtx, W = 86, cx = 43, cy = 43, r = 38;
  c.clearRect(0, 0, W, W);
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  c.translate(cx, cy); c.rotate(-roll);
  const po = pitch * 90;
  c.fillStyle = '#5aa7d6'; c.fillRect(-60, -60 + po, 120, 60);
  c.fillStyle = '#b07a3f'; c.fillRect(-60, po, 120, 60);
  c.fillStyle = '#fff'; c.fillRect(-60, po - 1, 120, 2);
  for (const m of [-20, -10, 10, 20]) {
    c.fillRect(-11, po + m * 1.6 - 0.75, 22, 1.5);
  }
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, r - 1, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#ffd34d'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(cx - 17, cy); c.lineTo(cx - 5, cy); c.lineTo(cx, cy + 5); c.lineTo(cx + 5, cy); c.lineTo(cx + 17, cy); c.stroke();
}
function drawVS(vsFpm) {
  const c = vsCtx, W = 62, H = 86, cx = 31, cy = 43, r = 26;
  c.clearRect(0, 0, W, H);
  c.beginPath(); c.arc(cx, cy, r + 5, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.07)'; c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.6; c.stroke();
  c.fillStyle = '#cfe9ea'; c.font = '9px Segoe UI'; c.textAlign = 'center';
  c.fillText('V/S', cx, cy + 16);
  for (let v = -2000; v <= 2000; v += 1000) {
    const a = Math.PI * 0.75 + (v + 2000) / 4000 * Math.PI * 1.5;
    c.fillRect(cx + Math.cos(a) * (r - 3) - 0.7, cy + Math.sin(a) * (r - 3) - 0.7, 1.4, 1.4);
  }
  const clamped = Math.max(-2000, Math.min(2000, vsFpm));
  const a = Math.PI * 0.75 + (clamped + 2000) / 4000 * Math.PI * 1.5;
  c.strokeStyle = '#aef3e2'; c.lineWidth = 2.4;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5)); c.stroke();
}
const MAP_SCALE = 172 / 3400;
function w2m(x, z) { return [86 + x * MAP_SCALE, 75 + z * MAP_SCALE]; }
function drawMap() {
  const c = mapCtx, W = 172, H = 150;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#123a4a'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(140,220,225,0.14)'; c.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 18) { c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke(); }
  for (let gy = 0; gy < H; gy += 18) { c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
  // island blobs from the same height field the world is built from
  c.fillStyle = '#5d9153';
  for (let gx = -1600; gx <= 1600; gx += 90) for (let gz = -1600; gz <= 1600; gz += 90) {
    if (rawHeight(gx, gz) > 3) { const [px, py] = w2m(gx, gz); c.fillRect(px - 2.4, py - 2.4, 4.8, 4.8); }
  }
  const [rx, ry] = w2m(RWY.x, 0);
  c.fillStyle = '#e8ecec'; c.fillRect(rx - 1.4, ry - 17, 2.8, 34);
  gates.forEach((gt, i) => {
    const [px, py] = w2m(gt.def.x, gt.def.z);
    c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2);
    c.fillStyle = i < S.gateIdx ? '#39d98a' : i === S.gateIdx ? '#ffa726' : '#8a97a0';
    c.fill();
  });
  const [px, py] = w2m(S.pos.x, S.pos.z);
  const hd = compassDeg() * Math.PI / 180;
  c.save(); c.translate(px, py); c.rotate(hd);
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(0, 2.4); c.lineTo(-4, 5); c.fill();
  c.restore();
  c.fillStyle = '#ffd9a0'; c.font = 'bold 10px Segoe UI'; c.textAlign = 'right';
  c.fillText('N', W - 6, 13);
}
function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function updateHUD() {
  const kt = Math.round(S.speed * KT);
  const altFt = Math.max(0, Math.round(S.pos.y * FT));
  const aglFt = Math.max(0, Math.round((S.pos.y - heightAt(S.pos.x, S.pos.z)) * FT));
  const vsFpm = Math.round(S.vy * 196.85);
  const deg = compassDeg();
  $('iasVal').textContent = kt;
  $('altVal').textContent = altFt;
  $('aglVal').textContent = aglFt;
  $('hdgVal').textContent = 'HDG ' + String(Math.round(deg)).padStart(3, '0') + '°';
  $('gatesVal').textContent = String(S.gateIdx).padStart(2, '0') + ' / 06';
  $('ptsVal').textContent = String(S.score).padStart(5, '0');
  $('timeVal').textContent = fmtTime(S.time);
  $('thrPct').textContent = Math.round(S.throttle * 100) + '%';
  $('thrPct2').textContent = Math.round(S.throttle * 100) + '%';
  $('thrBar').style.width = (S.throttle * 100) + '%';
  $('fuelBar').style.width = S.fuel + '%';
  $('fuelPct').textContent = Math.round(S.fuel) + '%';
  $('hullBar').style.width = S.hull + '%';
  $('hullBar').style.background = S.hull < 45 ? '#ff5d5d' : '#57e6a3';
  $('hullPct').textContent = Math.round(S.hull) + '%';
  $('vsVal').textContent = (vsFpm > 0 ? '+' : '') + vsFpm;
  $('gVal').textContent = S.gLoad.toFixed(1);
  $('gearVal').textContent = S.gearDown ? 'DOWN' : 'UP';
  $('flapVal').textContent = S.flap + '°';
  $('airborneTxt').textContent = S.mode === 'debrief' ? 'SORTIE COMPLETE' : S.airborne ? 'AIRBORNE' : 'ON GROUND';
  const gt = gates[S.gateIdx];
  if (gt && !S.free && S.mode === 'play') {
    const dist = Math.round(S.pos.distanceTo(gt.grp.position));
    $('nextVal').textContent = dist + ' M';
    $('gateTagTxt').textContent = 'GATE ' + String(S.gateIdx + 1).padStart(2, '0') + ' · ' + dist + ' M';
    $('gateTag').style.display = 'block';
  } else if (!S.free && S.mode === 'play') {
    $('nextVal').textContent = 'RTB';
    $('gateTagTxt').textContent = 'ALL GATES CLEAR · LAND RWY 18';
    $('gateTag').style.display = 'block';
  } else {
    $('nextVal').textContent = '-- M';
    $('gateTag').style.display = 'none';
  }
  $('warn').style.display = S.stalled ? 'block' : 'none';
  if (S.stalled) $('warn').textContent = 'STALL';
  drawHeading(deg);
  drawAttitude(S.pitch, S.roll);
  drawVS(vsFpm);
  drawMap();
}

/* ---------- camera: smooth chase behind the tail ---------- */
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 40, 260);
function stepCamera(dt) {
  orientation();
  const back = _fwd.clone().multiplyScalar(-17);
  const want = S.pos.clone().add(back).add(_up.clone().multiplyScalar(5.2));
  want.y = Math.max(want.y, heightAt(want.x, want.z) + 3.4);
  const k = S.mode === 'briefing' ? 1.6 : 5.2;
  camPos.lerp(want, Math.min(1, dt * k));
  camera.position.copy(camPos);
  camTarget.copy(S.pos).add(_fwd.clone().multiplyScalar(26));
  camera.lookAt(camTarget);
  plane.group.position.copy(S.pos);
  plane.group.quaternion.copy(_quat);
  plane.prop.rotation.z = S.propSpin;
}

/* ---------- flow helpers ---------- */
function parkOnRunway() {
  S.pos.set(RWY.x, RWY.h + 2.6, -350);
  S.heading = Math.PI; S.pitch = 0; S.roll = 0; S.speed = 0; S.vy = 0;
  orientation();
  plane.group.position.copy(S.pos);
  plane.group.quaternion.copy(_quat);
}
function showBriefing() {
  S.mode = 'briefing';
  document.getElementById('debrief').style.display = 'none';
  document.getElementById('briefing').style.display = 'flex';
  parkOnRunway();
}
function restart() {
  AudioSys.init();
  if (S.mode === 'briefing') return;
  resetSortie(S.free);
}
document.getElementById('flyBtn').addEventListener('click', () => { AudioSys.init(); resetSortie(false); });
document.getElementById('freeBtn').addEventListener('click', () => { AudioSys.init(); resetSortie(true); });
document.getElementById('againBtn').addEventListener('click', () => restart());
document.getElementById('nextBtn').addEventListener('click', () => { AudioSys.init(); resetSortie(false); setMsg('Sortie 2 flies the same circuit in reverse weather — circuit reset.', 3); });
document.getElementById('briefBtn').addEventListener('click', () => showBriefing());

/* ---------- deterministic screenshot states (?shot=...) ---------- */
function aimAt(tx, tz) {
  const dx = tx - S.pos.x, dz = tz - S.pos.z;
  S.heading = Math.atan2(-dx, -dz);
}
function applyShotMode() {
  const q = new URLSearchParams(location.search);
  const shot = q.get('shot');
  if (!shot) return;
  if (shot === 'play' || shot === 'cover') {
    resetSortie(false);
    S.gateIdx = 4; S.score = 1200;
    paintGates(4, 4);
    S.pos.set(-352, 128, -882);
    aimAt(gates[4].def.x, gates[4].def.z);
    S.speed = 55; S.throttle = 0.66; S.fuel = 69;
    S.onGround = false; S.airborne = true; S.gearDown = false;
    plane.legs.visible = false;
    S.time = 96;
    document.getElementById('briefing').style.display = 'none';
  } else if (shot === 'approach') {
    resetSortie(false);
    S.gateIdx = 6; paintGates(6, 6);
    S.pos.set(14, 72, 1090);
    aimAt(RWY.x, 120);
    S.speed = 30; S.throttle = 0.34; S.flap = 30;
    S.onGround = false; S.airborne = true; S.gearDown = true;
    S.pitch = -0.05; S.time = 210; S.score = 1980;
    document.getElementById('briefing').style.display = 'none';
  } else if (shot === 'end' || shot === 'debrief') {
    resetSortie(false);
    S.gateIdx = 6; paintGates(6, 6);
    S.pos.set(3, RWY.h + 2.6, 40);
    S.speed = 0; S.throttle = 0; S.onGround = true; S.airborne = false;
    S.fuel = 44; S.hull = 96; S.time = 226;
    showDebrief({
      kicker: 'Sortie 01 · Golden Hour · Complete',
      title: 'TOUCHDOWN — BUTTER LANDING',
      sub: 'Landed on RWY 18 (Gullwing Ridge) at 148 FPM sink rate, 58 KT, 1.4m off centreline.',
      sink: '148 FPM', ias: '58 KT · 1.4M', gates: '6 / 6',
      fuel: '44% / 96%', bonus: '+2,500', score: '4,986',
    });
  }
}

/* ---------- main loop ---------- */
const clock = new THREE.Clock();
let orbitA = 0.8;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  sea.position.y = 0.4 + Math.sin(t * 0.5) * 0.18;
  seaBump.offset.set(t * 0.006, t * 0.0023);
  for (const cl of clouds) { cl.position.x += dt * 2.2; if (cl.position.x > 2900) cl.position.x = -2900; }
  const active = gates[S.gateIdx];
  if (active && S.mode === 'play') {
    const pulse = 1 + Math.sin(t * 3.4) * 0.03;
    active.grp.scale.set(pulse, pulse, 1);
    active.halo.rotation.z += dt * 0.7;
  }
  if (S.mode === 'play' && !S.paused) {
    stepFlight(dt);
    // ditching: nose at sea level over open water is a crash, not a landing
    if (S.mode === 'play' && S.pos.y <= 3.1 && rawHeight(S.pos.x, S.pos.z) < 0.5 && !onRunway(S.pos.x, S.pos.z)) {
      crash('Ditchelled in Bellwater Bay. The Kestrel floats — briefly.');
    }
    // sortie completes once she has landed after all gates AND rolled to a near stop
    if (S.mode === 'play' && !S.free && !S.finished && S.touchdown && S.gateIdx >= gates.length && S.onGround && S.speed <= 20) {
      finishSortie();
    }
    stepCamera(dt);
  } else if (S.mode === 'briefing') {
    orbitA += dt * 0.07;
    camera.position.set(S.pos.x + Math.sin(orbitA) * 30, S.pos.y + 9, S.pos.z + Math.cos(orbitA) * 30);
    camera.lookAt(S.pos.x, S.pos.y + 1.5, S.pos.z);
    plane.prop.rotation.z += dt * 2;
  } else {
    stepCamera(dt);
  }
  stepBursts(dt);
  // keep the low golden-hour sun (and its shadows) centred on the action;
  // the jet's exhaust glow breathes with throttle
  sun.position.set(S.pos.x - 850, 560, S.pos.z - 420);
  sun.target.position.copy(S.pos);
  if (plane.group.userData.glowMat) {
    plane.group.userData.glowMat.opacity = 0.16 + S.throttle * 0.62 + Math.sin(t * 31) * 0.03;
  }
  const targetFov = 58 + Math.min(8, Math.max(0, (S.speed - 30) * 0.16)) + (S.onGround && S.throttle > 0.8 ? Math.sin(t * 47) * 0.4 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov += (targetFov - camera.fov) * 0.08; camera.updateProjectionMatrix(); }
  if (msgTimer > 0 && msgTimer < 900) { msgTimer -= dt; if (msgTimer <= 0) document.getElementById('msg').textContent = ''; }
  AudioSys.update(S.throttle, S.speed * KT, S.mode === 'play');
  updateHUD();
  renderer.render(scene, camera);
}
parkOnRunway();
paintGates(0, 0);
applyShotMode();
if (new URLSearchParams(location.search).get('shot')) {
  setMsg('', 0);
  document.getElementById('msg').textContent = '';
  stepCamera(2); stepCamera(2); // snap the chase cam into place for the still
}
animate();
