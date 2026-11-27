'use strict';
/* SKYHARBOR — Kestrel 07. A complete low-poly flight sortie:
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
/* the archipelago: a low airport island in the centre, high mountain
   islands flanking west and east, one backdrop peak north, islets south.
   Each island carries a region type that drives its painted palette. */
const ISLANDS = [
  { x: 0, z: -260, r: 720, h: 66, t: 'lush' },      // airport island
  { x: 60, z: 330, r: 640, h: 56, t: 'lush' },
  { x: -1470, z: -650, r: 560, h: 305, t: 'volc' }, // west chain
  { x: -1670, z: 250, r: 520, h: 268, t: 'lush' },
  { x: -1270, z: 950, r: 430, h: 214, t: 'lush' },
  { x: 1520, z: -700, r: 580, h: 318, t: 'lush' },  // east chain
  { x: 1700, z: 300, r: 500, h: 252, t: 'dry' },
  { x: 1320, z: 980, r: 420, h: 205, t: 'dry' },
  { x: -150, z: -1700, r: 800, h: 345, t: 'lush' }, // north backdrop peak
  { x: 350, z: 1400, r: 300, h: 62, t: 'dry' },     // south islets
  { x: -700, z: 1300, r: 260, h: 48, t: 'lush' },
];
function mountainFactor(x, z) {
  let m = 0;
  for (const I of ISLANDS) if (I.h > 150) m += gauss(x, z, I.x, I.z, I.r, 1);
  return Math.min(1, m * 1.5);
}
/* which region owns a point: the strongest island of each type */
function regionAt(x, z) {
  let best = null, bs = 0;
  for (const I of ISLANDS) {
    const s = gauss(x, z, I.x, I.z, I.r, 1);
    if (s > bs) { bs = s; best = I.t; }
  }
  return bs > 0.12 ? best : null;
}
function rawHeight(x, z) {
  let h = -26;                                       // seabed
  for (const I of ISLANDS) h += gauss(x, z, I.x, I.z, I.r, I.h);
  // craggy ridged detail on the high islands, so peaks read as mountains
  const mf = mountainFactor(x, z);
  if (mf > 0.02 && h > 2) {
    const rn = fbm(x * 0.004 + 70, z * 0.004 + 3);
    const ridge = 1 - Math.abs(rn * 2 - 1);
    h += ridge * ridge * 74 * mf;
    h += (fbm(x * 0.017 + 9, z * 0.017 + 44) - 0.5) * 26 * mf;
  }
  h += Math.sin(x * 0.004 + z * 0.003) * 2.6 * Math.max(0, Math.min(1, (h + 10) / 40));
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
  const top = new THREE.Color(0x3d5c74), mid = new THREE.Color(0xc9a189);
  const low = new THREE.Color(0xf7ab58), tmp = new THREE.Color();
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
  if (postRT) postRT.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- realistic grade pass ----------
   The scene renders to a target, then a fullscreen shader applies a filmic
   grade: S-curve contrast, a saturation lift, warm-highlight / cool-shadow
   split toning, a soft vignette and animated grain. This is what makes the
   flat-shaded world read as a photographed place instead of a diagram. */
let postRT = null, postScene = null, postCam = null, postMat = null;
function initPost() {
  postRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
  postScene = new THREE.Scene();
  postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postMat = new THREE.ShaderMaterial({
    uniforms: { tD: { value: postRT.texture }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'uniform sampler2D tD; uniform float uT; varying vec2 vUv;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'void main(){',
      '  vec3 c = texture2D(tD, vUv).rgb;',
      '  c = c * c * (3.0 - 2.0 * c) * 0.22 + c * 0.78;',                    // S-curve contrast
      '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
      '  c = mix(vec3(l), c, 1.14);',                                       // saturation lift
      '  c += vec3(0.045, 0.018, -0.020) * l + vec3(-0.012, 0.004, 0.030) * (1.0 - l);', // split tone
      '  float d = distance(vUv, vec2(0.5));',
      '  c *= smoothstep(0.95, 0.42, d) * 0.24 + 0.76;',                    // vignette
      '  c += (hash(vUv * (913.0 + fract(uT) * 7.0)) - 0.5) * 0.028;',      // film grain
      '  gl_FragColor = vec4(c, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <encodings_fragment>',
      '}',
    ].join('\n'),
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  quad.frustumCulled = false;
  postScene.add(quad);
}
initPost();
function renderFrame(t) {
  renderer.toneMapping = THREE.NoToneMapping;   // grade pass owns tone mapping
  renderer.setRenderTarget(postRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  postMat.uniforms.uT.value = t;
  renderer.render(postScene, postCam);
}
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
/* value noise for painting: deterministic hash lattice, smooth interpolation */
function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.13 + 7.3, z * 2.13 + 2.9) * 0.28 + vnoise(x * 4.7 + 3.1, z * 4.7 + 8.4) * 0.17;
}
/* The island's skin, painted per pixel from its own heightfield: biome by
   height and slope, mottled by three noise octaves, foam laced along the
   waterline, strata bands on the high rock. This one painting is what the
   reference islands have and flat vertex colours can never give. */
function paintTerrainTexture() {
  const S = 2048, world = WORLD * 2;
  // heights sampled on a coarse grid (the landforms are smooth) and bilinearly
  // upsampled — per-pixel height calls would stall the load for no visual gain
  const G = 256, grid = new Float32Array((G + 1) * (G + 1));
  for (let gy = 0; gy <= G; gy++) for (let gx = 0; gx <= G; gx++) {
    grid[gy * (G + 1) + gx] = heightAt((gx / G - 0.5) * world, (gy / G - 0.5) * world);
  }
  const heights = new Float32Array(S * S);
  for (let py = 0; py < S; py++) {
    const fy = (py / S) * G, gy = Math.min(G - 1, Math.floor(fy)), ty = fy - gy;
    for (let px = 0; px < S; px++) {
      const fx = (px / S) * G, gx = Math.min(G - 1, Math.floor(fx)), tx = fx - gx;
      const a = grid[gy * (G + 1) + gx], b = grid[gy * (G + 1) + gx + 1];
      const c2 = grid[(gy + 1) * (G + 1) + gx], d2 = grid[(gy + 1) * (G + 1) + gx + 1];
      heights[py * S + px] = a + (b - a) * tx + (c2 - a) * ty + (a - b - c2 + d2) * tx * ty;
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  const mix = (a, b, t) => a + (b - a) * t;
  for (let py = 0; py < S; py++) {
    const wz = (py / S - 0.5) * world;
    for (let px = 0; px < S; px++) {
      const wx = (px / S - 0.5) * world;
      const h = heights[py * S + px];
      const hx = heights[py * S + Math.min(S - 1, px + 3)], hz = heights[Math.min(S - 1, py + 3) * S + px];
      const slope = (Math.abs(hx - h) + Math.abs(hz - h)) / 18; // ~0 flat .. 1 cliff
      const nBig = fbm(wx * 0.0016, wz * 0.0016);
      const nMid = fbm(wx * 0.013 + 40, wz * 0.013 + 9);
      const nFine = vnoise(wx * 0.11, wz * 0.11);
      const nMicro = vnoise(wx * 0.34 + 90, wz * 0.34 + 31); // grain you only see up close
      let r, g, b;
      if (h < 1.2) {            // seabed: wet sand falling into blue-green depth
        const t = Math.max(0, (h + 24) / 25);
        r = mix(38, 196, t); g = mix(104, 178, t); b = mix(140, 128, t);
      } else if (h < 5.5) {     // beach sand with damp patches
        const damp = nMid * 26;
        r = 226 - damp; g = 199 - damp; b = 138 - damp * 0.7;
      } else if (h < 95) {      // grass and low forest: deep green mottled with dry patches
        const dry = Math.max(0, nBig - 0.55) * 1.6;
        r = mix(74, 158, dry) + (nMid - 0.5) * 32 + (nMicro - 0.5) * 15;
        g = mix(122, 146, dry) + (nMid - 0.5) * 28 + (nMicro - 0.5) * 13;
        b = mix(52, 76, dry) + (nFine - 0.5) * 15;
        const forest = Math.max(0, (h - 16) / 40) * Math.max(0, nBig - 0.32) * 1.9; // dark woodland blotches
        r = mix(r, 50, Math.min(0.82, forest)); g = mix(g, 100, Math.min(0.82, forest)); b = mix(b, 48, Math.min(0.82, forest));
      } else if (h < 195) {     // high forest: stays green, only warming slightly with altitude
        const t = (h - 95) / 100;
        r = mix(62, 104, t) + (nMid - 0.5) * 30;
        g = mix(110, 106, t) + (nMid - 0.5) * 26;
        b = mix(54, 72, t) + (nFine - 0.5) * 14;
      } else {                  // bare peaks only at the very top: banded strata
        const band = 0.5 + 0.5 * Math.sin(h * 0.55 + nMid * 3);
        r = 142 + band * 24 + (nMid - 0.5) * 26;
        g = 124 + band * 20 + (nMid - 0.5) * 22;
        b = 102 + band * 16 + (nFine - 0.5) * 12;
        const cap = Math.min(0.55, Math.max(0, (h - 225) / 40));
        r = mix(r, 224, cap); g = mix(g, 220, cap); b = mix(b, 208, cap);
      }
      if (h > 10 && slope > 0.52) {  // only truly steep faces shed their green
        const t = Math.min(0.62, (slope - 0.52) * 1.5);
        r = mix(r, 140, t); g = mix(g, 112, t); b = mix(b, 84, t);
      }
      if (h > 0.4 && h < 3.4) {     // foam lace along the waterline
        const foam = Math.max(0, nFine - 0.42) * (1 - Math.abs(h - 1.6) / 1.8);
        r = mix(r, 244, Math.min(0.75, foam)); g = mix(g, 248, Math.min(0.75, foam)); b = mix(b, 244, Math.min(0.75, foam));
      }
      // painted per region: each island type owns its palette
      const region = regionAt(wx, wz);
      if (region === 'volc' && h > 3) {          // volcanic island: forested flanks, bare ash only at the top
        const t = 0.34;
        r = mix(r, r * 0.6 + 14, t); g = mix(g, g * 0.62 + 12, t); b = mix(b, b * 0.66 + 13, t);
        if (h > 175) { const at = Math.min(0.65, (h - 175) / 90); r = mix(r, 146, at); g = mix(g, 134, at); b = mix(b, 122, at); }
      } else if (region === 'dry' && h > 3) {    // savanna island, warm and sparse
        r = mix(r, r * 1.14 + 26, 0.55); g = mix(g, g * 1.0 + 8, 0.55); b = mix(b, b * 0.78, 0.55);
      } else if (region === 'lush' && h > 3) {   // deep saturated jungle green
        r = mix(r, r * 0.82, 0.4); g = mix(g, g * 1.06 + 6, 0.4); b = mix(b, b * 0.85, 0.4);
      }
      // forest floor: dark humus green-brown where the canopy noise runs thick
      if (h > 6 && h < 175 && slope < 0.5) {
        const canopy = fbm(wx * 0.006 + 120, wz * 0.006 + 60);
        if (canopy > 0.56) {
          const t = Math.min(0.6, (canopy - 0.56) * 2.4);
          r = mix(r, 52, t); g = mix(g, 84, t); b = mix(b, 40, t);
        }
      }
      const i = (py * S + px) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  window.__terrainCanvas = c; // the same painting drives the satellite-style map
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}
/* a true normal map derived from the height field itself, so slopes and
   ridges catch the low sun like real ground instead of flat colour */
function makeTerrainNormal() {
  const S = 384, world = WORLD * 2;
  const hs = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    hs[j * S + i] = heightAt(-WORLD + (i / (S - 1)) * world, -WORLD + (j / (S - 1)) * world);
  }
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cell = world / (S - 1), strength = 2.4;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const iL = Math.max(0, i - 1), iR = Math.min(S - 1, i + 1), jD = Math.max(0, j - 1), jU = Math.min(S - 1, j + 1);
    const dx = (hs[j * S + iR] - hs[j * S + iL]) / (2 * cell);
    const dz = (hs[jU * S + i] - hs[jD * S + i]) / (2 * cell);
    const nx = -dx * strength, nz = -dz * strength, ny = 1;
    const il = 1 / Math.hypot(nx, ny, nz);
    const k = (j * S + i) * 4;
    d[k] = (nx * il * 0.5 + 0.5) * 255;
    d[k + 1] = (nz * il * 0.5 + 0.5) * 255;
    d[k + 2] = (ny * il * 0.5 + 0.5) * 255;
    d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
function buildTerrain() {
  const size = WORLD * 2, seg = 512;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const skin = paintTerrainTexture();
  const mat = new THREE.MeshStandardMaterial({ map: skin, normalMap: makeTerrainNormal(), normalScale: new THREE.Vector2(1.35, 1.35), roughness: 0.94, metalness: 0, envMapIntensity: 0.34 });
  // a second, finely tiled detail layer multiplied over the painting — this
  // is what keeps the ground crisp at low altitude instead of washing out
  const detailTex = makeNoiseTexture(256, 158, 84, 200);
  detailTex.repeat.set(1, 1);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailTex = { value: detailTex };
    shader.vertexShader = 'varying vec2 vDetailUv;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\n  vDetailUv = uv;'
    );
    shader.fragmentShader = 'uniform sampler2D detailTex;\nvarying vec2 vDetailUv;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n  diffuseColor.rgb *= texture2D(detailTex, vDetailUv * 260.0).rgb * 1.62;'
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
scene.add(buildTerrain());

/* sea surface (translucent, animated in the loop) */
/* water normal map derived from the same fbm field, so the swell has shape */
function makeWaterNormal() {
  const S = 256, hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = fbm(x * 0.055, y * 0.055) + 0.4 * vnoise(x * 0.21, y * 0.21);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const xm = (x - 1 + S) % S, xp = (x + 1) % S, ym = (y - 1 + S) % S, yp = (y + 1) % S;
    const dx = (hgt[y * S + xp] - hgt[y * S + xm]) * 2.2;
    const dy = (hgt[yp * S + x] - hgt[ym * S + x]) * 2.2;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * S + x) * 4;
    d[i] = (-dx * inv * 0.5 + 0.5) * 255; d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255; d[i + 2] = inv * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 70);
  return tex;
}
const seaNormal = makeWaterNormal();
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD * 2.4, WORLD * 2.4),
  new THREE.MeshStandardMaterial({ color: 0x1a6484, roughness: 0.07, metalness: 0.05, normalMap: seaNormal, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 1.6, transparent: true, opacity: 0.97 })
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

/* ---------- the city: instanced towers with lit windows, a terminal, parked jets ---------- */
function facadeTextures(seedBase, base) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  const e = document.createElement('canvas'); e.width = e.height = 256;
  const ex = e.getContext('2d');
  ex.fillStyle = '#000000'; ex.fillRect(0, 0, 256, 256);
  let seed = seedBase;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // concrete panel seams and grime streaks under each window row
  x.strokeStyle = 'rgba(70,74,78,0.35)'; x.lineWidth = 1;
  for (let wy = 12; wy < 256; wy += 16) { x.beginPath(); x.moveTo(0, wy + 11); x.lineTo(256, wy + 11); x.stroke(); }
  for (let wy = 10; wy < 250; wy += 16) for (let wx = 9; wx < 250; wx += 14) {
    const lit = rnd();
    x.fillStyle = lit > 0.45 ? '#37434e' : '#68737d';
    x.fillRect(wx, wy, 9, 10);
    x.fillStyle = 'rgba(255,255,255,0.20)'; x.fillRect(wx, wy, 9, 3);   // sky glint on the glass
    if (rnd() > 0.6) { x.fillStyle = 'rgba(60,58,52,0.18)'; x.fillRect(wx + 2, wy + 10, 5, 6); } // grime drip
    if (lit > 0.70) { ex.fillStyle = rnd() > 0.3 ? '#ffc978' : '#cfe4ff'; ex.fillRect(wx, wy, 9, 10); }
  }
  const map = new THREE.CanvasTexture(c);
  map.anisotropy = 4;
  const emissive = new THREE.CanvasTexture(e);
  return { map, emissive };
}
/* terminal block east of the apron + two parked jets waiting at gates */
function buildTerminal() {
  const wall = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.55, metalness: 0.1 });
  const glassM = new THREE.MeshStandardMaterial({ color: 0x274b63, roughness: 0.12, metalness: 0.4 });
  const term = new THREE.Mesh(new THREE.BoxGeometry(150, 16, 34), wall);
  term.position.set(150, RWY.h + 8, -60); term.castShadow = true; scene.add(term);
  const band = new THREE.Mesh(new THREE.BoxGeometry(150, 6, 35), glassM);
  band.position.set(150, RWY.h + 10, -60); scene.add(band);
  const roofT = new THREE.Mesh(new THREE.BoxGeometry(158, 2.5, 42), new THREE.MeshStandardMaterial({ color: 0x0e7c86, roughness: 0.5 }));
  roofT.position.set(150, RWY.h + 17.2, -60); scene.add(roofT);
  for (let i = 0; i < 3; i++) {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(26, 4, 5), wall);
    bridge.position.set(96, RWY.h + 6, -128 + i * 62); scene.add(bridge);
  }
  // parked jets: simple lofted-look silhouettes from cylinders and boxes
  for (const [px, pz, ry] of [[78, -128, 0.5], [78, -4, -0.4]]) {
    const jet = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.2, 30, 12), new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.35 }));
    body.rotation.x = Math.PI / 2; jet.add(body);
    const noseJ = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), body.material);
    noseJ.scale.set(1, 1, 1.8); noseJ.position.z = -15; jet.add(noseJ);
    const wingJ = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 5), body.material);
    wingJ.position.set(0, -0.6, -1); jet.add(wingJ);
    const finJ = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 4.5), roofT.material);
    finJ.position.set(0, 4.4, 13.6); jet.add(finJ);
    jet.position.set(px, RWY.h + 3.4, pz);
    jet.rotation.y = ry;
    jet.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    scene.add(jet);
  }
}
buildTerminal();

/* ---------- fine detail layer: street lights, approach lights, taxiway, dome ---------- */
function buildAirportDetail() {
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0bc });
  const lampGeo = new THREE.SphereGeometry(0.85, 6, 5);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 44);
  const m4 = new THREE.Matrix4();
  let n = 0;
  // approach light rows reaching out from both thresholds, like the reference final
  for (let i = 1; i <= 11; i++) {
    m4.makeTranslation(0, RWY.h + 1.6, RWY.zTop - i * 42); lamps.setMatrixAt(n++, m4);
    m4.makeTranslation(0, RWY.h + 1.6, RWY.zBot + i * 42); lamps.setMatrixAt(n++, m4);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 11; i++) {   // runway centreline lights
    m4.makeTranslation(sx * (RWY.w / 2 + 2), RWY.h + 1.2, RWY.zTop + 30 + i * 62); lamps.setMatrixAt(n++, m4);
  }
  lamps.count = n;
  scene.add(lamps);
  // taxiway from the strip to the terminal, with its yellow centreline
  const taxi = new THREE.Mesh(new THREE.BoxGeometry(120, 0.5, 15), new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
  taxi.position.set(84, RWY.h + 0.28, -60); taxi.receiveShadow = true; scene.add(taxi);
  const line = new THREE.Mesh(new THREE.BoxGeometry(120, 0.56, 1.1), new THREE.MeshBasicMaterial({ color: 0xd9b93c }));
  line.position.set(84, RWY.h + 0.3, -60); scene.add(line);
  // concrete apron under the terminal and parked jets
  const apron = new THREE.Mesh(new THREE.BoxGeometry(210, 0.5, 330), new THREE.MeshLambertMaterial({ color: 0x8f9296 }));
  apron.position.set(128, RWY.h + 0.24, -60); apron.receiveShadow = true; scene.add(apron);
}
buildAirportDetail();

/* trees on the green slopes: jittered-blob canopies, no two alike */
function makeBlobGeo() {
  const geo = new THREE.IcosahedronGeometry(4.6, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = hash2(Math.round(vx * 40) + 90, Math.round(vz * 40) + Math.round(vy * 40));
    const s = 0.76 + n * 0.52;
    p.setXYZ(i, vx * s, vy * s * 1.05, vz * s);
  }
  geo.computeVertexNormals();
  return geo;
}
/* leaf-speckle texture so canopies read as foliage, not plastic balls */
function makeLeafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#8a9a86'; x.fillRect(0, 0, 128, 128);
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 2600; i++) {
    const v = 96 + Math.round(rnd() * 110);
    x.fillStyle = 'rgb(' + Math.round(v * 0.72) + ',' + v + ',' + Math.round(v * 0.66) + ')';
    x.fillRect(rnd() * 128, rnd() * 128, 2.4, 2.4);
  }
  for (let i = 0; i < 260; i++) {  // shadow pockets inside the canopy
    x.fillStyle = 'rgba(28,44,26,0.35)';
    x.fillRect(rnd() * 128, rnd() * 128, 3.4, 3.4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
/* foliage as painted alpha cards: clusters of individual leaves with real
   transparency, on two crossed planes — from the air this reads as an actual
   tree crown with holes and edges, not a green ball */
function makeLeafAlphaTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const clusters = [[128, 84], [76, 128], [180, 128], [128, 168], [58, 92], [198, 92], [104, 200], [156, 200]];
  const leaf = (cx, cy, dark) => {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * 34;
    const lx = cx + Math.cos(a) * r, ly = cy + Math.sin(a) * r * 0.78;
    const hue = 96 + rnd() * 34, li = dark ? 15 + rnd() * 10 : 24 + rnd() * 20;
    x.save(); x.translate(lx, ly); x.rotate(rnd() * Math.PI);
    x.fillStyle = 'hsl(' + hue + ',' + (34 + rnd() * 18) + '%,' + li + '%)';
    x.beginPath(); x.ellipse(0, 0, 6 + rnd() * 7, 3 + rnd() * 3.4, 0, 0, Math.PI * 2); x.fill();
    x.restore();
  };
  for (const [cx, cy] of clusters) for (let i = 0; i < 46; i++) leaf(cx, cy + 7, true);   // shaded underlayer
  for (const [cx, cy] of clusters) for (let i = 0; i < 62; i++) leaf(cx, cy, false);      // lit leaves
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
function makeCrossGeo() {
  const p1 = new THREE.PlaneGeometry(8.4, 9.2);
  p1.translate(0, 4.6, 0);
  const p2 = p1.clone(); p2.rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  for (const src of [p1, p2]) {
    const base = pos.length / 3;
    const pa = src.attributes.position, ua = src.attributes.uv;
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); uv.push(ua.getX(i), ua.getY(i)); }
    const ia = src.index;
    for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + base);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function buildTrees() {
  const trunkG = new THREE.CylinderGeometry(0.55, 0.8, 3.4, 5);
  const leafG = makeCrossGeo();
  const trunkM = new THREE.MeshLambertMaterial({ color: 0x6b4a2e, flatShading: true });
  const leafM = new THREE.MeshLambertMaterial({ map: makeLeafAlphaTexture(), alphaTest: 0.42, side: THREE.DoubleSide });
  const MAX = 3400;
  const trunks = new THREE.InstancedMesh(trunkG, trunkM, MAX);
  const leaves = new THREE.InstancedMesh(leafG, leafM, MAX);
  const tints = [new THREE.Color(0x9fb98a), new THREE.Color(0xffffff), new THREE.Color(0x7fae72), new THREE.Color(0xc2cf9a)];
  const m4 = new THREE.Matrix4(); let n = 0;
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const tryTree = (x, z, slopeLim) => {
    if (n >= MAX) return;
    const h = heightAt(x, z);
    if (h < 6 || h > 190 || onRunway(x, z)) return;                 // up to the treeline
    if (Math.abs(x) < 75 && z > -490 && z < 330) return;            // runway corridor
    if (x > 20 && x < 295 && z > -450 && z < 320) return;           // airport grounds
    const slope = Math.abs(heightAt(x + 22, z) - h) / 22 + Math.abs(heightAt(x, z + 22) - h) / 22;
    if (slope > slopeLim) return;                                   // not on sheer cliff faces
    if (regionAt(x, z) === 'dry' && rnd() > 0.4) return;            // savanna stays sparse
    const s = 0.55 + rnd() * 0.75;
    m4.makeScale(s, s, s).setPosition(x, h + 1.7 * s, z); trunks.setMatrixAt(n, m4);
    m4.makeRotationY(rnd() * Math.PI * 2).scale(new THREE.Vector3(s, s, s)).setPosition(x, h + 1.1 * s, z); leaves.setMatrixAt(n, m4);
    leaves.setColorAt(n, tints[Math.floor(rnd() * tints.length)]);
    n++;
  };
  // the mountain flanks get the first and densest pass
  for (const I of ISLANDS) {
    if (I.h < 150) continue;
    for (let i = 0; i < 3200 && n < MAX; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * I.r * 0.98;
      tryTree(I.x + Math.cos(a) * rr, I.z + Math.sin(a) * rr, 2.1);
    }
  }
  for (let i = 0; i < 20000 && n < MAX; i++) tryTree((rnd() * 2 - 1) * 1950, (rnd() * 2 - 1) * 1950, 1.5);
  trunks.count = leaves.count = n;
  scene.add(trunks); scene.add(leaves);
}
buildTrees();

/* boulders and rock outcrops: their own coarse rock material, scattered on
   the steep faces and high ground where trees cannot hold */
function buildRocks() {
  const geo = new THREE.IcosahedronGeometry(3.4, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const nn = hash2(Math.round(vx * 31) + 7, Math.round(vz * 31) + Math.round(vy * 31));
    const s = 0.62 + nn * 0.85;
    p.setXYZ(i, vx * s, vy * s * 0.72, vz * s);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 1, metalness: 0, flatShading: true, envMapIntensity: 0.15 });
  const MAX = 420;
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler();
  const sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const shades = [new THREE.Color(0xffffff), new THREE.Color(0xcfc8ba), new THREE.Color(0x9a917f), new THREE.Color(0x7e7668)];
  let seed = 31337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let n = 0;
  for (let i = 0; i < 9000 && n < MAX; i++) {
    const x = (rnd() * 2 - 1) * 1950, z = (rnd() * 2 - 1) * 1950;
    const h = heightAt(x, z);
    if (h < 4 || onRunway(x, z)) continue;
    const slope = Math.abs(heightAt(x + 12, z) - h) / 12 + Math.abs(heightAt(x, z + 12) - h) / 12;
    if (slope < 0.85 && h < 170) continue;                           // cliffs and high ground only
    if (Math.abs(x) < 640 && Math.abs(z) < 640 && slope < 1.2) continue; // keep the airport meadow clean
    if (Math.abs(x) < 300 && z < -400 && h < 210) continue;          // keep the final-approach valley clean
    if (Math.abs(x) < 80 && z > -490 && z < 330) continue;
    const s = 0.4 + rnd() * 1.2;
    eu.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.6); q.setFromEuler(eu);
    sv.set(s, s, s); pv.set(x, h + 0.4, z);
    m4.compose(pv, q, sv);
    mesh.setMatrixAt(n, m4);
    mesh.setColorAt(n, shades[Math.floor(rnd() * shades.length)]);
    n++;
  }
  mesh.count = n;
  mesh.castShadow = true;
  scene.add(mesh);
}
buildRocks();

/* soft cartoon clouds */
const clouds = [];
function buildClouds() {
  // soft billboard puffs: a radial-gradient sprite reads as a painted cloud
  const cc = document.createElement('canvas'); cc.width = 512; cc.height = 320;
  const cx2 = cc.getContext('2d');
  const puffs = [[256, 168, 124], [152, 184, 80], [364, 184, 88], [216, 132, 76], [304, 136, 68], [110, 200, 52], [410, 202, 56]];
  // shaded bellies first, warm grey where the low sun underlights the cloud
  for (const [px, py, r] of puffs) {
    const gr = cx2.createRadialGradient(px, py + r * 0.22, 4, px, py + r * 0.22, r);
    gr.addColorStop(0, 'rgba(198,188,180,0.5)');
    gr.addColorStop(0.7, 'rgba(190,182,176,0.26)');
    gr.addColorStop(1, 'rgba(190,182,176,0)');
    cx2.fillStyle = gr;
    cx2.fillRect(0, 0, 512, 320);
  }
  // then the lit tops, offset toward the sun
  for (const [px, py, r] of puffs) {
    const gr = cx2.createRadialGradient(px, py - r * 0.3, 4, px, py - r * 0.26, r * 0.94);
    gr.addColorStop(0, 'rgba(255,247,235,0.88)');
    gr.addColorStop(0.65, 'rgba(255,242,226,0.44)');
    gr.addColorStop(1, 'rgba(255,242,226,0)');
    cx2.fillStyle = gr;
    cx2.fillRect(0, 0, 512, 320);
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
  // horizon cloud banks: huge, low, warm-lit layers that give the sunset sky
  // its depth in the reference — pink-orange shelves stacked at the rim
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + rnd() * 0.4;
    const dist = 3900 + rnd() * 900;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5 + rnd() * 0.22, depthWrite: false, fog: false, color: new THREE.Color().setHSL(0.06 + rnd() * 0.03, 0.55, 0.72 + rnd() * 0.1) });
    const sp = new THREE.Sprite(mat);
    const w = 1500 + rnd() * 1300;
    sp.scale.set(w, w * 0.30, 1);
    sp.position.set(Math.cos(ang) * dist, 130 + rnd() * 190, Math.sin(ang) * dist);
    scene.add(sp); clouds.push(sp);
  }
  // the sun itself: a soft additive glow sitting low in the north-west
  const sc2 = document.createElement('canvas'); sc2.width = sc2.height = 256;
  const sg = sc2.getContext('2d');
  const sgrad = sg.createRadialGradient(128, 128, 4, 128, 128, 126);
  sgrad.addColorStop(0, 'rgba(255,236,190,1)');
  sgrad.addColorStop(0.18, 'rgba(255,205,120,0.75)');
  sgrad.addColorStop(0.55, 'rgba(255,160,80,0.28)');
  sgrad.addColorStop(1, 'rgba(255,140,70,0)');
  sg.fillStyle = sgrad; sg.fillRect(0, 0, 256, 256);
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sunSpr.scale.set(2400, 2400, 1);
  sunSpr.position.set(-4300, 780, -2150);
  scene.add(sunSpr);
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
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.09, bevelSegments: 2, steps: 1 });
}
/* lofted body: superellipse cross-sections swept along the fuselage, the way
   real airframes are shaped — each station has its own width, height and
   centreline rise, so nose, cockpit swell and tail upsweep are one surface */
function loftGeometry(stations, radial) {
  const verts = [], uvs = [], idx = [];
  const zMin = stations[0].z, zMax = stations[stations.length - 1].z;
  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const co = Math.cos(th), si = Math.sin(th);
      const px = st.rx * Math.sign(co) * Math.pow(Math.abs(co), 0.72);
      const py = st.ry * Math.sign(si) * Math.pow(Math.abs(si), 0.72);
      verts.push(px, py + st.cy, st.z);
      uvs.push(j / radial, (st.z - zMin) / (zMax - zMin));
    }
  }
  for (let s = 0; s < stations.length - 1; s++) {
    for (let j = 0; j < radial; j++) {
      const a = s * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
function buildPlane() {
  const g = new THREE.Group();
  // painted skin for the lofted body (u wraps the body, v runs nose to tail):
  // panel seams, rivet rows, an orange tail band, a dark radome, exhaust grime
  const skinC = document.createElement('canvas'); skinC.width = 2048; skinC.height = 512;
  const sk = skinC.getContext('2d');
  sk.fillStyle = '#f2f0ea'; sk.fillRect(0, 0, 2048, 512);
  let seed = 31337;
  const srnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 16000; i++) {
    const v = 224 + Math.round(srnd() * 24);
    sk.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 4) + ')';
    sk.fillRect(srnd() * 2048, srnd() * 512, 2, 2);
  }
  sk.fillStyle = '#0e7c86'; sk.fillRect(0, 46, 2048, 26);        // teal tail band (v near the tail)
  sk.fillStyle = '#d9a441'; sk.fillRect(0, 78, 2048, 7);         // thin gold pinstripe ahead of it
  sk.fillStyle = '#2b3438'; sk.fillRect(0, 494, 2048, 18);       // dark radome tip (v at the nose)
  sk.strokeStyle = 'rgba(90,90,88,0.32)'; sk.lineWidth = 2;
  for (let i = 0; i < 52; i++) { // longitudinal panel seams
    const px = (i / 52) * 2048 + srnd() * 10;
    sk.beginPath(); sk.moveTo(px, 0); sk.lineTo(px, 512); sk.stroke();
  }
  sk.strokeStyle = 'rgba(90,90,88,0.20)';
  for (let i = 1; i < 12; i++) { // ring seams along the body
    const py = (i / 12) * 512;
    sk.beginPath(); sk.moveTo(0, py); sk.lineTo(2048, py); sk.stroke();
  }
  sk.fillStyle = 'rgba(80,80,78,0.5)';                            // rivet rows beside two seams
  for (const px of [512, 1536]) for (let py = 6; py < 512; py += 9) { sk.fillRect(px + 5, py, 2, 2); sk.fillRect(px - 7, py, 2, 2); }
  const grime = sk.createLinearGradient(0, 330, 0, 512);          // exhaust and belly grime toward the tail underside
  grime.addColorStop(0, 'rgba(70,64,58,0)'); grime.addColorStop(1, 'rgba(70,64,58,0.16)');
  sk.fillStyle = grime; sk.fillRect(0, 330, 2048, 182);
  for (let i = 0; i < 40; i++) sk.fillRect(srnd() * 2048, 400 + srnd() * 100, 24 + srnd() * 70, 3);
  const skinTex = new THREE.CanvasTexture(skinC);
  skinTex.wrapS = THREE.RepeatWrapping;
  skinTex.anisotropy = 8;
  const white = new THREE.MeshPhysicalMaterial({ map: skinTex, roughness: 0.32, metalness: 0.08, clearcoat: 0.65, clearcoatRoughness: 0.28, envMapIntensity: 1.1 });
  const orange = new THREE.MeshStandardMaterial({ color: 0x0e7c86, roughness: 0.42, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3438, roughness: 0.6, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.08, metalness: 0.4 });
  // lofted airframe: stations from nose tip to tail cone (z, half-width,
  // half-height, centreline rise) swept into one continuous skin
  const stations = [
    { z: -7.4, rx: 0.03, ry: 0.03, cy: 0.06 }, { z: -7.0, rx: 0.3, ry: 0.3, cy: 0.05 },
    { z: -6.2, rx: 0.56, ry: 0.53, cy: 0.04 }, { z: -5.2, rx: 0.79, ry: 0.73, cy: 0.02 },
    { z: -4.2, rx: 0.93, ry: 0.85, cy: 0.0 }, { z: -3.2, rx: 1.0, ry: 0.91, cy: 0.02 },
    { z: -2.0, rx: 1.04, ry: 0.95, cy: 0.03 }, { z: -0.5, rx: 1.06, ry: 0.98, cy: 0.03 },
    { z: 1.0, rx: 1.04, ry: 0.97, cy: 0.04 }, { z: 2.5, rx: 1.0, ry: 0.94, cy: 0.05 },
    { z: 4.0, rx: 0.94, ry: 0.88, cy: 0.06 }, { z: 5.2, rx: 0.85, ry: 0.8, cy: 0.07 },
    { z: 6.2, rx: 0.71, ry: 0.67, cy: 0.08 }, { z: 6.9, rx: 0.46, ry: 0.45, cy: 0.09 },
    { z: 7.3, rx: 0.05, ry: 0.05, cy: 0.1 },
  ];
  const fus = new THREE.Mesh(loftGeometry(stations, 30), white);
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
    // rear engines: lathed nacelles with a rounded intake lip, glowing exhausts
    const nacProfile = [
      [0.2, -1.95], [0.48, -1.85], [0.6, -1.5], [0.64, -0.5], [0.63, 0.6], [0.57, 1.5], [0.5, 1.95],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const nacGeo = new THREE.LatheGeometry(nacProfile, 20);
    nacGeo.rotateX(Math.PI / 2);
    const eng = new THREE.Mesh(nacGeo, dark);
    eng.position.set(sx * 1.08, -0.28, 4.45); g.add(eng);
    const intakeFace = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16),
      new THREE.MeshBasicMaterial({ color: 0x0c0f11 }));
    intakeFace.rotation.y = Math.PI; intakeFace.position.set(sx * 1.08, -0.28, 2.52); g.add(intakeFace);
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
  // afterburner flames: nested gradient cones per engine, driven by throttle
  // in the main loop (lit above ~0.62 throttle, full length at military power)
  const flameC = document.createElement('canvas'); flameC.width = 16; flameC.height = 128;
  const fx = flameC.getContext('2d');
  const fg = fx.createLinearGradient(0, 0, 0, 128);
  fg.addColorStop(0, 'rgba(255,80,20,0)');        // canvas top = cone tip (v=1)
  fg.addColorStop(0.45, 'rgba(255,110,30,0.45)');
  fg.addColorStop(0.78, 'rgba(255,180,80,0.9)');
  fg.addColorStop(1, 'rgba(255,244,205,1)');      // canvas bottom = cone base at the nozzle
  fx.fillStyle = fg; fx.fillRect(0, 0, 16, 128);
  const flameTex = new THREE.CanvasTexture(flameC);
  const burners = [];
  for (const sx of [-1, 1]) {
    const grp = new THREE.Group();
    grp.position.set(sx * 1.08, -0.28, 6.42);
    const outerMat = new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const outerGeo = new THREE.ConeGeometry(0.36, 5.2, 14, 1, true);
    outerGeo.rotateX(Math.PI / 2);   // apex toward +z (rear)
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.z = 2.6;
    grp.add(outer);
    const innerMat = new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const innerGeo = new THREE.ConeGeometry(0.2, 3.0, 12, 1, true);
    innerGeo.rotateX(Math.PI / 2);
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.z = 1.5;
    grp.add(inner);
    grp.visible = false;
    g.add(grp);
    burners.push({ grp, outerMat, innerMat });
  }
  g.userData.burners = burners;
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
  { x: 420,   y: 110, z: 560,   ry: 2.9 },   // SE shore of the airport island
  { x: 1330,  y: 205, z: -320,  ry: 1.9 },   // east mountain pass
  { x: 640,   y: 210, z: -1180, ry: 1.2 },   // NE high saddle
  { x: -520,  y: 215, z: -1250, ry: 0.4 },   // below the north backdrop peak
  { x: -1350, y: 235, z: -320,  ry: -0.5 },  // west volcanic flank
  { x: -820,  y: 120, z: 720,   ry: -1.2 },  // SW islet hop, then home
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

/* ---------- cannons: twin wing guns, tracer fire, target balloons ----------
   Hold X or the mouse button to fire. Balloons float beside the gates;
   popping one is worth 150 points. Tracer fire is what the top leaderboard
   entries show streaking across their arenas, so it lives here too. */
const tracerGeo = new THREE.CylinderGeometry(0.085, 0.085, 3.6, 5);
tracerGeo.rotateX(Math.PI / 2);
const tracerMesh = new THREE.InstancedMesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffc46b }), 90);
tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
tracerMesh.frustumCulled = false;
scene.add(tracerMesh);
const tracers = [];
let gunCool = 0, gunSide = 1, mouseFire = false;
canvas.addEventListener('mousedown', () => { mouseFire = true; });
window.addEventListener('mouseup', () => { mouseFire = false; });
function makeFlashSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.35, 'rgba(255,180,80,0.75)'); g.addColorStop(1, 'rgba(255,140,50,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.set(4.2, 4.2, 1);
  return sp;
}
const flashL = makeFlashSprite(); flashL.position.set(-2.4, -0.3, -3.6); plane.group.add(flashL);
const flashR = makeFlashSprite(); flashR.position.set(2.4, -0.3, -3.6); plane.group.add(flashR);
/* target balloons moored beside the gates */
const balloons = [];
{
  const bMat = new THREE.MeshStandardMaterial({ color: 0xd8402e, roughness: 0.35, metalness: 0.05, envMapIntensity: 0.9 });
  const bMat2 = new THREE.MeshStandardMaterial({ color: 0xe8871e, roughness: 0.35, metalness: 0.05, envMapIntensity: 0.9 });
  const basketM = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
  GATE_DEFS.forEach((d, i) => {
    for (let k = 0; k < 2; k++) {
      const grp = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(4.6, 14, 11), k ? bMat2 : bMat);
      env.scale.y = 1.15; grp.add(env);
      const basket = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.6), basketM);
      basket.position.y = -6.4; grp.add(basket);
      const bx = d.x + (k ? -95 : 85), bz = d.z + (k ? 60 : -70);
      grp.position.set(bx, d.y + (k ? 14 : -8), bz);
      scene.add(grp);
      balloons.push({ grp, alive: true, x: bx, y: grp.position.y, z: bz });
    }
  });
}
function resetBalloons() { for (const b of balloons) { b.alive = true; b.grp.visible = true; } }
let lastSortieTime = 0;
const _m4 = new THREE.Matrix4(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _zero = new THREE.Vector3();
function stepGuns(dt) {
  if (S.time < lastSortieTime - 1) resetBalloons();
  lastSortieTime = S.time;
  const firing = (keys['KeyX'] || mouseFire) && S.mode === 'play' && !S.paused && S.engineOn;
  gunCool -= dt;
  if (firing && gunCool <= 0 && tracers.length < 88) {
    gunCool = 0.085; gunSide = -gunSide;
    orientation();
    _v1.set(gunSide * 2.4, -0.3, -3.6).applyMatrix4(plane.group.matrixWorld);
    _v2.copy(_fwd).multiplyScalar(265 + S.speed);
    _v2.x += (Math.random() - 0.5) * 3; _v2.y += (Math.random() - 0.5) * 3; _v2.z += (Math.random() - 0.5) * 3;
    tracers.push({ p: _v1.clone(), v: _v2.clone(), life: 1.6 });
    (gunSide < 0 ? flashL : flashR).material.opacity = 0.95;
  }
  flashL.material.opacity = Math.max(0, flashL.material.opacity - dt * 9);
  flashR.material.opacity = Math.max(0, flashR.material.opacity - dt * 9);
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.p.addScaledVector(t.v, dt);
    t.v.y -= 3.4 * dt;
    t.life -= dt;
    let dead = t.life <= 0;
    if (!dead && t.p.y <= heightAt(t.p.x, t.p.z) + 0.4) { burst(t.p.x, t.p.y + 1, t.p.z, 0xffb066, 6, 7); dead = true; }
    if (!dead) for (const b of balloons) {
      if (!b.alive) continue;
      const dx = t.p.x - b.x, dy = t.p.y - b.y, dz = t.p.z - b.z;
      if (dx * dx + dy * dy + dz * dz < 42) {
        b.alive = false; b.grp.visible = false;
        burst(b.x, b.y, b.z, 0xff5030, 26, 13);
        S.score += 150;
        setMsg('Balloon down! +150', 2);
        dead = true; break;
      }
    }
    if (dead) tracers.splice(i, 1);
  }
  for (let i = 0; i < 90; i++) {
    if (i < tracers.length) {
      const t = tracers[i];
      _m4.lookAt(_zero, t.v, _up.set(0, 1, 0));
      _q2.setFromRotationMatrix(_m4);
      _m4.compose(t.p, _q2, _v1.set(1, 1, 1));
    } else {
      _m4.makeScale(0, 0, 0);
    }
    tracerMesh.setMatrixAt(i, _m4);
  }
  tracerMesh.instanceMatrix.needsUpdate = true;
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
  if (e.code === 'KeyE' && S.mode === 'play') toggleEngine();
  if (e.code === 'KeyC' && S.mode === 'play') cycleCam();
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
  engineOn: true, timeScale: 1, camMode: 0,
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
  setMsg(free ? 'Free flight — the city is yours.' : 'Throttle up. Rotate at 62 kt.', 3.5);
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
function toggleEngine() {
  S.engineOn = !S.engineOn;
  AudioSys.blip(S.engineOn ? 520 : 190, 0.18, 0.12);
  setMsg(S.engineOn ? 'Engine ON' : 'Engine OFF — glide!', 1.6);
}
function cycleCam() {
  S.camMode = (S.camMode + 1) % 3;
  setMsg(['Camera: chase', 'Camera: far chase', 'Camera: tower'][S.camMode], 1.4);
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
  let accel = (S.engineOn ? S.throttle : 0) * 13.5 - dragBase * (S.speed / 34) - S.speed * S.speed * 0.0011 - 9.2 * _fwd.y * (S.onGround ? 0.25 : 1);
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
    sub: 'Landed on RWY 18 (Skyharbor) at ' + td.sinkFpm + ' FPM sink rate, ' +
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
const attCtx = $('attCanvas').getContext('2d');
const spdCtx = $('spdCanvas').getContext('2d');
const altCtx = $('altCanvas').getContext('2d');
const mapCtx = $('mapCanvas').getContext('2d');
/* analogue dials for the console, drawn like the reference panel's gauges */
function dialFace(c, cx, cy, r, label) {
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = 'rgba(10,24,32,0.92)'; c.fill();
  c.strokeStyle = 'rgba(160,225,230,0.65)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#9fd8dc'; c.font = '8.5px Segoe UI'; c.textAlign = 'center';
  c.fillText(label, cx, cy + r * 0.52);
}
function drawSpeedDial(kt) {
  const c = spdCtx, cx = 46, cy = 46, r = 41;
  c.clearRect(0, 0, 92, 92);
  dialFace(c, cx, cy, r, 'KNOTS');
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  c.fillStyle = '#eaf6f6'; c.font = '9px Segoe UI'; c.textAlign = 'center';
  for (let v = 0; v <= 160; v += 20) {
    const a = a0 + (v / 160) * sweep;
    const x1 = cx + Math.cos(a) * (r - 4), y1 = cy + Math.sin(a) * (r - 4);
    const x2 = cx + Math.cos(a) * (r - 10), y2 = cy + Math.sin(a) * (r - 10);
    c.strokeStyle = v >= 120 ? '#ff8a7a' : '#cfe9ea'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.fillText(String(v), cx + Math.cos(a) * (r - 17), cy + Math.sin(a) * (r - 17) + 3);
  }
  const a = a0 + (Math.min(170, kt) / 160) * sweep;
  c.strokeStyle = '#ffc93c'; c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); c.stroke();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 3.4, 0, Math.PI * 2); c.fill();
}
function drawAltDial(ft) {
  const c = altCtx, cx = 46, cy = 46, r = 41;
  c.clearRect(0, 0, 92, 92);
  dialFace(c, cx, cy, r, 'FEET x100');
  c.fillStyle = '#eaf6f6'; c.font = '9px Segoe UI'; c.textAlign = 'center';
  for (let v = 0; v < 20; v += 2) {
    const a = -Math.PI / 2 + (v / 20) * Math.PI * 2;
    c.fillText(String(v / 2 === 0 ? 0 : v / 2), cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13) + 3);
    const x1 = cx + Math.cos(a) * (r - 4), y1 = cy + Math.sin(a) * (r - 4);
    const x2 = cx + Math.cos(a) * (r - 8), y2 = cy + Math.sin(a) * (r - 8);
    c.strokeStyle = '#cfe9ea'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  const aLong = -Math.PI / 2 + ((ft % 1000) / 1000) * Math.PI * 2;
  const aShort = -Math.PI / 2 + ((ft % 10000) / 10000) * Math.PI * 2;
  c.strokeStyle = '#fff'; c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(aLong) * (r - 9), cy + Math.sin(aLong) * (r - 9)); c.stroke();
  c.strokeStyle = '#ffc93c'; c.lineWidth = 3.4;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(aShort) * (r - 20), cy + Math.sin(aShort) * (r - 20)); c.stroke();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 3.4, 0, Math.PI * 2); c.fill();
}
function drawAttitude(pitch, roll) {
  const c = attCtx, W = 92, cx = 46, cy = 46, r = 41;
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
const MAP_SCALE = 212 / 3400;
function w2m(x, z) { return [106 + x * MAP_SCALE, 93 + z * MAP_SCALE]; }
function drawMap() {
  const c = mapCtx, W = 212, H = 186;
  c.clearRect(0, 0, W, H);
  // satellite base: the very canvas the terrain is painted from, cropped to the sector
  const tc = window.__terrainCanvas;
  if (tc) {
    const src = (3400 / (WORLD * 2)) * tc.width;
    const sx = (tc.width - src) / 2;
    c.drawImage(tc, sx, sx, src, src, 0, 0, W, H);
    c.fillStyle = 'rgba(10,26,34,0.16)'; c.fillRect(0, 0, W, H);
  } else {
    c.fillStyle = '#123a4a'; c.fillRect(0, 0, W, H);
  }
  c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 26) { c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke(); }
  for (let gy = 0; gy < H; gy += 26) { c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
  const [rx, ry] = w2m(RWY.x, (RWY.zTop + RWY.zBot) / 2);
  c.fillStyle = '#f2f4f4'; c.fillRect(rx - 1.6, ry - 21, 3.2, 42);
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.strokeRect(rx - 1.6, ry - 21, 3.2, 42);
  gates.forEach((gt, i) => {
    const [px, py] = w2m(gt.def.x, gt.def.z);
    c.beginPath(); c.arc(px, py, 4.4, 0, Math.PI * 2);
    c.fillStyle = i < S.gateIdx ? '#39d98a' : i === S.gateIdx ? '#ffa726' : '#aeb9be';
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.stroke();
  });
  // destination pin on the active target, like the reference map
  const tgt = gates[S.gateIdx];
  const [tx, ty] = tgt && S.mode === 'play' ? w2m(tgt.def.x, tgt.def.z) : w2m(RWY.x, 0);
  c.fillStyle = '#ff4747';
  c.beginPath(); c.arc(tx, ty - 9, 5, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(tx - 4, ty - 6); c.lineTo(tx + 4, ty - 6); c.lineTo(tx, ty + 1); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 1.2;
  c.beginPath(); c.arc(tx, ty - 9, 5, 0, Math.PI * 2); c.stroke();
  const [px, py] = w2m(S.pos.x, S.pos.z);
  const hd = compassDeg() * Math.PI / 180;
  c.save(); c.translate(px, py); c.rotate(hd);
  c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,0.5)';
  c.beginPath(); c.moveTo(0, -6.4); c.lineTo(4.2, 5.2); c.lineTo(0, 2.6); c.lineTo(-4.2, 5.2); c.closePath(); c.fill(); c.stroke();
  c.restore();
  c.fillStyle = '#fff'; c.font = 'bold 10px Segoe UI'; c.textAlign = 'right';
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
  $('aglVal').textContent = aglFt;
  $('hdgVal').textContent = String(Math.round(deg)).padStart(3, '0') + '°';
  $('gatesVal').textContent = String(S.gateIdx).padStart(2, '0') + ' / 06';
  $('ptsVal').textContent = String(S.score).padStart(5, '0');
  $('timeVal').textContent = fmtTime(S.time);
  $('thrPct2').textContent = Math.round(S.throttle * 100) + '%';
  $('thrBar').style.width = (S.throttle * 100) + '%';
  $('thrFill').style.height = (S.throttle * 100) + '%';
  $('thrPctBig').textContent = Math.round(S.throttle * 100) + '%';
  $('fuelBar').style.width = S.fuel + '%';
  $('fuelBar').style.background = S.fuel < 25 ? '#ff5d5d' : '#39d98a';
  $('fuelPct').textContent = Math.round(S.fuel) + '%';
  $('hullBar').style.width = S.hull + '%';
  $('hullBar').style.background = S.hull < 45 ? '#ff5d5d' : '#57e6a3';
  $('hullPct').textContent = Math.round(S.hull) + '%';
  $('vsVal').textContent = (vsFpm > 0 ? '+' : '') + vsFpm;
  $('gVal').textContent = S.gLoad.toFixed(1);
  $('gearVal').textContent = S.gearDown ? 'DOWN' : 'UP';
  $('flapVal').textContent = S.flap + '°';
  $('altBig').innerHTML = altFt + ' <span>FT</span>';
  $('airborneTxt').textContent = S.mode === 'debrief' ? 'SORTIE COMPLETE' : S.airborne ? 'AIRBORNE' : 'ON GROUND';
  $('brakeLamp').className = (keys['KeyB'] && S.onGround) || (keys['Space'] && S.airborne) ? 'on' : '';
  $('brakeLamp').id = 'brakeLamp';
  const gl = $('gearLights').children;
  for (let i = 0; i < 3; i++) gl[i].className = S.gearDown ? 'on' : '';
  const starN = Math.min(5, S.gateIdx + (S.finished ? 1 : 0));
  const stars = $('stars').children;
  for (let i = 0; i < 5; i++) stars[i].className = i < starN ? 'lit' : '';
  $('engineBtn').className = S.engineOn ? 'on' : '';
  $('engineBtn').id = 'engineBtn';
  $('yokeSvg').style.transform = 'rotate(' + (-S.roll * 46) + 'deg) translateY(' + (S.pitch * 14) + 'px)';
  const gt = gates[S.gateIdx];
  if (gt && !S.free && S.mode === 'play') {
    const dist = Math.round(S.pos.distanceTo(gt.grp.position));
    $('nextVal').textContent = dist + ' M';
    $('objNext').textContent = 'Fly through Gate ' + String(S.gateIdx + 1).padStart(2, '0');
    $('objTitle').textContent = S.airborne ? 'Fly the island circuit' : 'Line up and take off';
    $('objSub').textContent = S.airborne ? 'Next checkpoint ' + dist + ' m ahead' : 'Rotate at 62 kt on RWY 18';
    $('gateTagTxt').textContent = 'GATE ' + String(S.gateIdx + 1).padStart(2, '0') + ' · ' + dist + ' M';
    $('gateTag').style.display = 'block';
  } else if (!S.free && S.mode === 'play') {
    $('nextVal').textContent = 'RTB';
    $('objNext').textContent = 'Land back on RWY 18';
    $('objTitle').textContent = 'Complete the landing';
    $('objSub').textContent = 'Land the plane safely on the runway';
    $('gateTagTxt').textContent = 'ALL GATES CLEAR · LAND RWY 18';
    $('gateTag').style.display = 'block';
  } else {
    $('nextVal').textContent = '-- M';
    $('objNext').textContent = S.mode === 'debrief' ? 'Sortie complete' : 'Free flight';
    $('gateTag').style.display = 'none';
  }
  $('warn').style.display = S.stalled ? 'block' : 'none';
  if (S.stalled) $('warn').textContent = 'STALL';
  drawSpeedDial(kt);
  drawAttitude(S.pitch, S.roll);
  drawAltDial(altFt);
  drawMap();
}

/* ---------- camera: smooth chase behind the tail ---------- */
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 40, 260);
function stepCamera(dt) {
  orientation();
  plane.group.position.copy(S.pos);
  plane.group.quaternion.copy(_quat);
  plane.prop.rotation.z = S.propSpin;
  if (S.camMode === 2 && S.mode === 'play') {
    // tower view: the camera sits in the control tower cab and tracks the jet
    camera.position.set(88, RWY.h + 52, 60);
    camera.lookAt(S.pos.x, S.pos.y, S.pos.z);
    camPos.copy(camera.position);
    return;
  }
  const dist = S.camMode === 1 ? 30 : 17, lift = S.camMode === 1 ? 10 : 5.2;
  const back = _fwd.clone().multiplyScalar(-dist);
  const want = S.pos.clone().add(back).add(_up.clone().multiplyScalar(lift));
  want.y = Math.max(want.y, heightAt(want.x, want.z) + 3.4);
  const k = S.mode === 'briefing' ? 1.6 : 5.2;
  camPos.lerp(want, Math.min(1, dt * k));
  camera.position.copy(camPos);
  camTarget.copy(S.pos).add(_fwd.clone().multiplyScalar(26));
  camera.lookAt(camTarget);
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
document.getElementById('engineBtn').addEventListener('click', () => { AudioSys.init(); if (S.mode === 'play') toggleEngine(); });
document.getElementById('pauseBtn').addEventListener('click', () => { if (S.mode === 'play') togglePause(); });
document.getElementById('towerBtn').addEventListener('click', () => {
  AudioSys.init();
  setMsg(S.gateIdx >= gates.length ? 'Tower: cleared to land RWY 18, wind calm.' : 'Tower: Kestrel 07, circuit active — next gate is lit orange.', 3);
});
document.querySelectorAll('#spdChips button').forEach((b) => b.addEventListener('click', () => {
  S.timeScale = parseFloat(b.dataset.ts);
  document.querySelectorAll('#spdChips button').forEach((x) => x.classList.toggle('on', x === b));
}));

/* ---------- deterministic screenshot states (?shot=...) ---------- */
function aimAt(tx, tz) {
  const dx = tx - S.pos.x, dz = tz - S.pos.z;
  S.heading = Math.atan2(-dx, -dz);
}
/* for the action screenshot: a frozen tracer stream and muzzle flashes riding
   with the plane, and a balloon parked right in the firing line */
function stageActionFX() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  for (let i = 0; i < 13; i++) {
    const t = new THREE.Mesh(tracerGeo, mat);
    const side = i % 2 ? 2.4 : -2.4;
    t.position.set(side + (Math.random() - 0.5) * 0.8, -0.3 - i * 0.35, -8 - i * 11);
    t.rotation.y = Math.PI;
    grp.add(t);
  }
  const f1 = makeFlashSprite(); f1.material.opacity = 0.95; f1.position.set(-2.4, -0.3, -3.6); grp.add(f1);
  const f2 = makeFlashSprite(); f2.material.opacity = 0.8; f2.position.set(2.4, -0.3, -3.6); grp.add(f2);
  plane.group.add(grp);
  const b = balloons[4];
  if (b) {
    orientation();
    b.grp.position.copy(S.pos).addScaledVector(_fwd, 165); b.grp.position.y -= 5;
    b.x = b.grp.position.x; b.y = b.grp.position.y; b.z = b.grp.position.z;
  }
}
function applyShotMode() {
  const q = new URLSearchParams(location.search);
  const shot = q.get('shot');
  if (!shot) return;
  if (shot === 'play' || shot === 'cover') {
    // hero composition: gate 1's ring dead centre, airport island framed
    // through it, burners lit — the plane runs in from the south-east shore
    resetSortie(false);
    S.gateIdx = 0; S.score = 0;
    paintGates(0, 0);
    S.pos.set(549, 104, 755);
    aimAt(gates[0].def.x, gates[0].def.z);
    const g0 = gates[0];   // stage the ring face-on to the camera for the still
    g0.grp.rotation.y = Math.atan2(S.pos.x - g0.def.x, S.pos.z - g0.def.z);
    S.speed = 58; S.throttle = 0.97; S.fuel = 97;
    S.onGround = false; S.airborne = true; S.gearDown = false;
    plane.legs.visible = false;
    S.roll = -0.22; S.pitch = 0.02;       // gentle bank, ring stays centred
    S.time = 8;
    document.getElementById('briefing').style.display = 'none';
  } else if (shot === 'action') {
    resetSortie(false);
    S.gateIdx = 2; S.score = 640;
    paintGates(2, 2);
    S.pos.set(gates[2].def.x - 300, gates[2].def.y + 30, gates[2].def.z + 330);
    aimAt(gates[2].def.x, gates[2].def.z);
    S.speed = 62; S.throttle = 0.97; S.fuel = 81;
    S.onGround = false; S.airborne = true; S.gearDown = false;
    plane.legs.visible = false;
    S.roll = -0.85; S.pitch = 0.05;       // hard banked firing pass
    S.time = 61;
    document.getElementById('briefing').style.display = 'none';
    stageActionFX();
  } else if (shot === 'approach') {
    resetSortie(false);
    S.gateIdx = 6; paintGates(6, 6);
    S.pos.set(12, 86, -1180);
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
      sub: 'Landed on RWY 18 (Skyharbor) at 148 FPM sink rate, 58 KT, 1.4m off centreline.',
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
  const dt = Math.min(0.05, clock.getDelta()) * (S.mode === 'play' && !S.paused ? S.timeScale : 1);
  const t = clock.elapsedTime;
  sea.position.y = 0.4 + Math.sin(t * 0.5) * 0.18;
  seaNormal.offset.set(t * 0.008, t * 0.0031);
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
      crash('Ditched in the sea. The Kestrel floats — briefly.');
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
  stepGuns(dt);
  // keep the low golden-hour sun (and its shadows) centred on the action;
  // the jet's exhaust glow breathes with throttle
  sun.position.set(S.pos.x - 850, 560, S.pos.z - 420);
  sun.target.position.copy(S.pos);
  if (plane.group.userData.glowMat) {
    plane.group.userData.glowMat.opacity = 0.16 + S.throttle * 0.62 + Math.sin(t * 31) * 0.03;
  }
  // afterburner: ramps in past 0.62 throttle, flickers, dies with the engine
  const burn = Math.max(0, Math.min(1, (S.throttle - 0.62) / 0.38)) * (S.engineOn ? 1 : 0);
  if (plane.group.userData.burners) {
    const flick = 0.92 + Math.sin(t * 43) * 0.05 + Math.sin(t * 61 + 1.7) * 0.03;
    for (const b of plane.group.userData.burners) {
      b.grp.visible = burn > 0.02;
      b.grp.scale.set(0.7 + burn * 0.5, 0.7 + burn * 0.5, Math.max(0.05, burn) * flick);
      b.outerMat.opacity = burn * 0.85;
      b.innerMat.opacity = burn * 0.95;
    }
  }
  const targetFov = 58 + Math.min(8, Math.max(0, (S.speed - 30) * 0.16)) + (S.onGround && S.throttle > 0.8 ? Math.sin(t * 47) * 0.4 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov += (targetFov - camera.fov) * 0.08; camera.updateProjectionMatrix(); }
  if (msgTimer > 0 && msgTimer < 900) { msgTimer -= dt; if (msgTimer <= 0) document.getElementById('msg').textContent = ''; }
  AudioSys.update(S.throttle, S.speed * KT, S.mode === 'play');
  updateHUD();
  renderFrame(t);
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
