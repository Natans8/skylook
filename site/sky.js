// The skybox engine: the procedural sky cone, the LightData day cycle, the animated skybox M2 and an
// approximate celestial layer, drawn the way the client layers them, for every roster build from Classic Era to
// Midnight. It owns the canvas and nothing else on the page: `app.js` is the interface, and reaches everything
// through the `Sky` export at the foot of this file.
import * as THREE from "./lib/three.module.js?v=f2df4334b3";
import { loadM2, loadBlpInto, placeholderTexture } from "./wowload.js?v=f2df4334b3";
import { FFX_SCROLL_SPEED, NO_BLEND_SET, ffxConstants, ffxTextures } from "./ts.ffx.js?v=f2df4334b3";
import { cloudNoise } from "./ts.raster.js?v=f2df4334b3";
import { gifEncoder, videoEncoder } from "./encode.js?v=f2df4334b3";
import { TABLES_URL } from "./assets.js?v=f2df4334b3";

const DAY = 2880; // the client's day, in half-minutes
const DEFAULT_BUILD = "9.2.7.45745";
const LOOK = { yaw: 0, pitch: 0.15 };
const state = {
  builds: [],
  build: DEFAULT_BUILD,
  light: null,
  paramId: 1952,
  time: 1440,
  playing: false,
  speed: 10, // game minutes per real second
  layers: { cone: true, clouds: true, model: true, celestialModel: true, fogcone: true, celestials: false, lut: true, ground: true, neutral: false },
  body: "auto", // which CelestialBody row draws: auto, none, or a row id
  pano: true,
  skybox: null,
  celestial: null,
  loading: "",
  map: null, // data/epsilon_map.json, the 9.2.7 skybox-to-Epsilon map
  screen: null, // the ScreenEffect row in force, with its id and spell
  screenSkybox: null, // the skybox row a screen effect swapped in through its LightParams
};

// colour helpers
const rgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const hex = (n) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// day cycle
/** The two LightData stops around a time, and the blend between them, wrapping at the day's end. */
function stopsAround(ramp, t) {
  if (ramp.length === 1) return [ramp[0], ramp[0], 0];
  const i = ramp.findIndex((s) => s.time > t);
  let a, b, ta, tb;
  if (i === 0) {
    a = ramp[ramp.length - 1]; b = ramp[0]; ta = a.time - DAY; tb = b.time;
  } else if (i === -1) {
    a = ramp[ramp.length - 1]; b = ramp[0]; ta = a.time; tb = b.time + DAY;
  } else {
    a = ramp[i - 1]; b = ramp[i]; ta = a.time; tb = b.time;
  }
  const k = tb === ta ? 0 : clamp((t - ta) / (tb - ta), 0, 1);
  return [a, b, k];
}

const EMPTY_STOP = { time: 0, SkyTopColor: 0x203050, SkyMiddleColor: 0x304060, SkyBand1Color: 0x405070, SkyBand2Color: 0x506080, SkySmogColor: 0x607090, SkyFogColor: 0x7080a0, EndFogColor: 0, FogHeightColor: 0, SunFogColor: 0, SunFogAngle: 1, SunFogStrength: 0, DirectColor: 0xffffff, AmbientColor: 0x808080, SunColor: 0xffffff, CloudSunColor: 0xffffff, CloudEmissiveColor: 0, CloudLayer1AmbientColor: 0x808080, CloudLayer2AmbientColor: 0x808080, FogEnd: 0, FogScaler: 0, CloudDensity: 0, EndFogColorDistance: 0, ColorGradingFileDataID: 0, DarkerColorGradingFileDataID: 0 };

/** A stop as the client reads it: an absent end fog or height fog is the sky fog, and no sun colour is no glow. */
function withFallbacks(stop) {
  const o = { ...stop };
  if (!o.EndFogColor) o.EndFogColor = o.SkyFogColor;
  if (!o.FogHeightColor) o.FogHeightColor = o.SkyFogColor;
  if (!o.SunFogColor) o.SunFogAngle = 1.0;
  return o;
}

/** The sky at one time: every colour and fog value blended, with the client's fallbacks applied. */
function evalLight(param, t) {
  const [a, b, k] = param.ramp.length ? stopsAround(param.ramp, t) : [EMPTY_STOP, EMPTY_STOP, 0];
  const A = withFallbacks(a), B = withFallbacks(b);
  const col = (f) => lerp3(rgb(A[f]), rgb(B[f]), k);
  const num = (f) => lerp(A[f], B[f], k);
  const out = {
    top: col("SkyTopColor"), middle: col("SkyMiddleColor"), band1: col("SkyBand1Color"), band2: col("SkyBand2Color"),
    smog: col("SkySmogColor"), fog: col("SkyFogColor"), endFog: col("EndFogColor"),
    direct: col("DirectColor"), ambient: col("AmbientColor"), sun: col("SunColor"), cloudSun: col("CloudSunColor"),
    cloudEmissive: col("CloudEmissiveColor"), cloud1: col("CloudLayer1AmbientColor"), cloud2: col("CloudLayer2AmbientColor"),
    sunFogColor: col("SunFogColor"), fogEnd: num("FogEnd"), fogScaler: num("FogScaler"), cloudDensity: num("CloudDensity"),
    endFogDist: num("EndFogColorDistance"), lutA: A.ColorGradingFileDataID || 0, lutB: B.ColorGradingFileDataID || 0, k, a: A, b: B,
    // what the preset does to the world beyond the sky: the water it tints and the light the ground is shaded by
    riverClose: col("RiverCloseColor"), riverFar: col("RiverFarColor"),
    oceanClose: col("OceanCloseColor"), oceanFar: col("OceanFarColor"),
    groundAmbient: col("GroundAmbientColor"), horizonAmbient: col("HorizonAmbientColor"),
    shadowOpacity: num("ShadowOpacity"),
  };
  // the sun's fog blend has its own rules: an angle of 1 means "no sun glow" and does not interpolate
  if (A.SunFogAngle >= 1 && B.SunFogAngle >= 1) { out.sunAngle = 1; out.sunStrength = 0; }
  else if (A.SunFogAngle >= 1) { out.sunAngle = B.SunFogAngle; out.sunStrength = B.SunFogStrength * k; }
  else if (B.SunFogAngle >= 1) { out.sunAngle = A.SunFogAngle; out.sunStrength = A.SunFogStrength * (1 - k); }
  else { out.sunAngle = num("SunFogAngle"); out.sunStrength = num("SunFogStrength"); }
  return out;
}

// celestial paths (WoWViewer's tables)
const SUN_PHI = [[0.25, 1.7453293], [0.49652779, 0.08726646], [0.5, 0.08726646], [0.50347221, 0.08726646], [0.79166669, 1.7453293]];
const SUN_THETA = [[0.25, 0.78539819], [0.5, 0.78539819], [0.79166669, 0.78539819]];
const MOON_PHI = [[0, 0.61086524], [0.0034722222, 0.61086524], [0.16666667, 1.7453293], [0.89583331, 1.7453293], [0.99652779, 0.61086524]];
const MOON_THETA = [[0, 0.78539819], [0.16666667, 0.78539819], [0.89583331, 0.78539819]];
function interpTable(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return x1 === x0 ? y1 : lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return tab[tab.length - 1][1];
}
function skyVector(phiTab, thetaTab, t) {
  const f = t / DAY;
  const phi = interpTable(phiTab, f), theta = interpTable(thetaTab, f);
  return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
}
/** The sun's direction: an 11.x preset with SunPolar or SunAzimuth set fixes it by polar angle from the zenith and
 * azimuth. Which flag enables it is unsettled (0x100 and 0x200 both appear beside the angles), so the angles decide. */
function sunDirection(param, t) {
  if (param.sun && (param.sun.polar || param.sun.azimuth)) {
    const polar = (param.sun.polar * Math.PI) / 180, az = (param.sun.azimuth * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(polar) * Math.cos(az), Math.sin(polar) * Math.sin(az), Math.cos(polar));
  }
  return skyVector(SUN_PHI, SUN_THETA, t);
}

// three.js scene
const canvas = document.getElementById("gl");
// a laptop with two graphics chips is asked for the stronger one; the browser decides, and may still refuse
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
// the client's cameraFov cvar defaults to 90, a horizontal angle at 4:3 that the engine keeps vertical-fixed: 73.74 degrees
const DEFAULT_FOV = 2 * Math.atan(Math.tan(Math.PI / 4) * 3 / 4) * 180 / Math.PI;
const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 20000);
camera.up.set(0, 0, 1);
camera.position.set(0, 0, 0);

// The sky cone: WoWViewer's mesh, one colour index per ring, scaled by 33.333 like its shader.
const CONE_RINGS = [
  [0.4903, 0.1391, 1], [0.568, 0.0849, 2], [0.6413, 0.0242, 3], [0.6531, 0.0135, 4], [0.6875, -0.005, 5],
];
function buildCone(startRing, alphaByRing) {
  const pos = [], cidx = [], alpha = [], idx = [];
  const N = 48;
  const push = (x, y, z, c, a) => { pos.push(x * 33.333, y * 33.333, z * 33.333); cidx.push(c); alpha.push(a); return pos.length / 3 - 1; };
  const rings = CONE_RINGS.slice(startRing);
  const apex = startRing === 0 ? push(0, 0, 0.2929, 0, alphaByRing ? alphaByRing[0] : 1) : -1;
  const ringStart = [];
  rings.forEach(([r, z, c], ri) => {
    ringStart.push(pos.length / 3);
    const a = alphaByRing ? alphaByRing[ri + startRing + 1] : 1;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      push(Math.cos(ang) * r, Math.sin(ang) * r, z, c, a);
    }
  });
  const bottom = push(0, 0, -1.7071, 5, alphaByRing ? alphaByRing[6] : 1);
  if (apex >= 0) for (let i = 0; i < N; i++) idx.push(apex, ringStart[0] + i, ringStart[0] + ((i + 1) % N));
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < N; i++) {
      const a = ringStart[r] + i, b = ringStart[r] + ((i + 1) % N), c = ringStart[r + 1] + i, d = ringStart[r + 1] + ((i + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = ringStart[rings.length - 1];
  for (let i = 0; i < N; i++) idx.push(last + i, bottom, last + ((i + 1) % N));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("cidx", new THREE.Float32BufferAttribute(cidx, 1));
  g.setAttribute("calpha", new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(idx);
  return g;
}
const coneMaterial = (transparent) => new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    skyColor: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0.2, 0.3, 0.5)) },
    sunDir: { value: new THREE.Vector3(0, 0, 1) },
    sunFogColor: { value: new THREE.Vector3(1, 1, 1) },
    sunAngle: { value: 1 },
    sunStrength: { value: 0 },
    cloudMap: { value: null },
    cloudOn: { value: 0 },
  },
  vertexShader: `
    in float cidx; in float calpha;
    uniform vec3 skyColor[6];
    out vec4 vColor; out vec3 vDir;
    void main() {
      vColor = vec4(skyColor[int(cidx + 0.5)], calpha);
      vDir = position;
      gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
    }`,
  fragmentShader: `
    precision highp float; precision highp int;
    in vec4 vColor; in vec3 vDir;
    uniform vec3 sunDir; uniform vec3 sunFogColor; uniform float sunAngle; uniform float sunStrength;
    uniform sampler2D cloudMap; uniform float cloudOn;
    out vec4 fragColor;
    void main() {
      vec3 c = vColor.rgb;
      vec3 d = normalize(vDir);
      float nDotSun = clamp(dot(d, normalize(sunDir)) - sunAngle, 0.0, 1.0);
      if (nDotSun > 0.0 && sunAngle < 1.0) {
        nDotSun = (1.0 / (1.0 - sunAngle)) * nDotSun;
        nDotSun = nDotSun * nDotSun * nDotSun;
        c = mix(c, sunFogColor, clamp(nDotSun * sunStrength, 0.0, 1.0));
      }
      if (vColor.a >= 0.999 && cloudOn > 0.5) {
        vec2 uv = vec2(atan(d.y, d.x) / 6.28318530718 + 0.5, 0.5 - asin(clamp(d.z, -1.0, 1.0)) / 3.14159265359);
        vec4 cl = texture(cloudMap, uv); c = mix(c, cl.rgb, cl.a);
      }
      fragColor = vec4(c, vColor.a);
    }`,
  depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent,
});
// The procedural cloud layer, computed on the CPU into an equirectangular map whenever the time or preset
// changes. It is the same lattice hash, noise and layer maths as the TypeScript and Python renderers.
const CLOUD_W = 512, CLOUD_H = 256;
const cloudData = new Uint8Array(CLOUD_W * CLOUD_H * 4);
const cloudTexture = new THREE.DataTexture(cloudData, CLOUD_W, CLOUD_H, THREE.RGBAFormat);
cloudTexture.wrapS = THREE.RepeatWrapping; cloudTexture.wrapT = THREE.ClampToEdgeWrapping;
cloudTexture.minFilter = THREE.LinearFilter; cloudTexture.magFilter = THREE.LinearFilter; cloudTexture.colorSpace = THREE.NoColorSpace;
let cloudKey = "";
/** Fill the cloud map for a light state; returns whether anything was drawn. */
function updateClouds(L, sunDir, time) {
  const key = `${state.build}:${state.paramId}:${Math.round(time)}:${L.cloudDensity.toFixed(3)}`;
  if (key === cloudKey) return L.cloudDensity > 0.001;
  cloudKey = key;
  if (L.cloudDensity <= 0.001) return false;
  const cover = 0.72 - L.cloudDensity * 0.3;
  const layers = [[1.0, 0.055, 0.00006, L.cloud2], [1.6, 0.03, 0.00004, L.cloud1]];
  for (let py = 0; py < CLOUD_H; py++) {
    const lat = (0.5 - (py + 0.5) / CLOUD_H) * Math.PI;
    const z = Math.sin(lat), cl = Math.cos(lat);
    for (let px = 0; px < CLOUD_W; px++) {
      const lon = ((px + 0.5) / CLOUD_W - 0.5) * 2 * Math.PI;
      const wx = cl * Math.cos(lon), wy = cl * Math.sin(lon), wz = z;
      const o = (py * CLOUD_W + px) * 4;
      let r = 0, g = 0, b = 0, alpha = 0;
      if (z > 0.02) {
        const horizon = Math.min(1, (z - 0.02) / 0.18);
        const sunK = Math.pow(Math.max(0, wx * sunDir.x + wy * sunDir.y + wz * sunDir.z), 4);
        for (const [height, scale, speed, ambient] of layers) {
          const t = height / z;
          const n = cloudNoise(wx * t * scale + time * speed, wy * t * scale + time * speed * 0.6);
          let a = Math.min(1, Math.max(0, (n - cover) / 0.15));
          a = a * a * (3 - 2 * a) * horizon;
          if (a <= 0.002) continue;
          const lit = Math.min(1, Math.max(0, (n - cover) / 0.25)) * (0.55 + 0.45 * sunK);
          const cr = ambient[0] * (1 - lit) + L.cloudSun[0] * lit + L.cloudEmissive[0];
          const cg = ambient[1] * (1 - lit) + L.cloudSun[1] * lit + L.cloudEmissive[1];
          const cb = ambient[2] * (1 - lit) + L.cloudSun[2] * lit + L.cloudEmissive[2];
          r = r * (1 - a) + cr * a; g = g * (1 - a) + cg * a; b = b * (1 - a) + cb * a;
          alpha = alpha + a * (1 - alpha);
        }
      }
      const inv = alpha > 0 ? 1 / alpha : 0;
      cloudData[o] = Math.min(255, r * inv * 255); cloudData[o + 1] = Math.min(255, g * inv * 255); cloudData[o + 2] = Math.min(255, b * inv * 255); cloudData[o + 3] = alpha * 255;
    }
  }
  cloudTexture.needsUpdate = true;
  return true;
}
const cone = new THREE.Mesh(buildCone(0, null), coneMaterial(false));
cone.renderOrder = 0;
cone.frustumCulled = false;
scene.add(cone);
// the halved cone the client blends over a flag-4 skybox: fog colour, fading out upward
const fogCone = new THREE.Mesh(buildCone(1, [0, 0, 0, 0.55, 0.85, 1, 1]), coneMaterial(true));
fogCone.renderOrder = 200;
fogCone.frustumCulled = false;
scene.add(fogCone);

// textures, per build
const texCache = new Map();
let texPending = 0, texTotal = 0;
// A texture by file id: a grey stand-in at once, the BLP decoded in the browser and swapped in when it arrives.
function loadTex(fid, flags) {
  const key = `${state.build}:${fid}:${flags}`;
  if (texCache.has(key)) return texCache.get(key);
  texPending++; texTotal++;
  const t = placeholderTexture(flags);
  loadBlpInto(t, state.build, fid)
    .catch((e) => console.warn(`texture ${fid}: ${e.message}`))
    .finally(() => { texPending = Math.max(0, texPending - 1); });
  texCache.set(key, t);
  return t;
}
function lutTexture(fid) {
  const t = loadTex(fid, 0);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}
// the approximate sun, moon and star field, which use three stock Blizzard textures present in every build
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.12, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
const stockTex = (fid, flags) => { const t = placeholderTexture(flags); loadBlpInto(t, DEFAULT_BUILD, fid).catch((e) => console.warn(`texture ${fid}: ${e.message}`)); return t; };
// world-space quads facing the origin, not sprites: a sprite turns to face each cube-capture camera
// separately, so across a face edge its two halves disagree and the disc goes heart-shaped
function celestialQuad(map, size, order) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
  mesh.renderOrder = order;
  scene.add(mesh);
  return mesh;
}
const sunSprite = celestialQuad(glowTexture(), 180, 10);
const moonSprite = celestialQuad(stockTex(130561, 0), 70, 11);
const starTex = stockTex(130628, 3); starTex.repeat.set(6, 3);
const stars = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
stars.renderOrder = 5; scene.add(stars);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 64), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false }));
ground.position.z = -60; ground.rotation.z = Math.PI; ground.renderOrder = 6; scene.add(ground); // the disc seam points backward, or it draws a hairline down the default view

// A black backdrop for judging a screen effect on its own, nothing else in the scene.
const backdrop = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), new THREE.ShaderMaterial({
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); }`,
  fragmentShader: `void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`,
  side: THREE.BackSide, depthTest: false, depthWrite: false,
}));
backdrop.renderOrder = -1; backdrop.frustumCulled = false; backdrop.visible = false;
scene.add(backdrop);

// CelestialBody (7.3+): Argus and the red star
// A textured quad in the row's direction: the base disc shaded by its light mask, the atmosphere texture
// scrolled through its mask, and two glow textures added through theirs; the whole disc turns at RotateRate.
// The size reads BodyBaseScale as degrees of angular diameter. TODO: confirm the unit against the client.
const BODY_FRAG = `
  varying vec2 vUv;
  uniform sampler2D base, lightMask, atmoMask, atmoMod, glowMask0, glowMod0, glowMask1, glowMod1;
  uniform float hasLight, hasAtmo, hasGlow0, hasGlow1, rot, atmoScale, glowScale0, glowScale1, opacity;
  uniform vec2 scroll0, scroll1;
  vec2 spin(vec2 uv, float a) { uv -= 0.5; float c = cos(a), s = sin(a); return vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5; }
  vec2 zoom(vec2 uv, float s) { return (uv - 0.5) * s + 0.5; }
  void main() {
    vec2 uv = spin(vUv, rot);
    vec4 b = texture2D(base, uv);
    vec3 c = b.rgb; float a = b.a;
    if (hasLight > 0.5) c *= 0.35 + 1.3 * texture2D(lightMask, uv).r;
    if (hasAtmo > 0.5) {
      float m = texture2D(atmoMask, zoom(uv, atmoScale)).a;
      vec4 at = texture2D(atmoMod, fract(uv + scroll0));
      c = mix(c, at.rgb, m * at.a); a = max(a, m * at.a);
    }
    if (hasGlow0 > 0.5) { vec4 g = texture2D(glowMod0, fract(uv + scroll1)); float m = texture2D(glowMask0, zoom(uv, glowScale0)).a; c += g.rgb * g.a * m; a = max(a, g.a * m); }
    if (hasGlow1 > 0.5) { vec4 g = texture2D(glowMod1, fract(uv - scroll1)); float m = texture2D(glowMask1, zoom(uv, glowScale1)).a; c += g.rgb * g.a * m; a = max(a, g.a * m); }
    gl_FragColor = vec4(c, a * opacity);
  }`;
const BODY_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
class CelestialBodyLayer {
  constructor() {
    this.row = null;
    const u = {};
    for (const n of ["base", "lightMask", "atmoMask", "atmoMod", "glowMask0", "glowMod0", "glowMask1", "glowMod1"]) u[n] = { value: null };
    for (const n of ["hasLight", "hasAtmo", "hasGlow0", "hasGlow1", "rot"]) u[n] = { value: 0 };
    for (const n of ["atmoScale", "glowScale0", "glowScale1", "opacity"]) u[n] = { value: 1 };
    u.scroll0 = { value: new THREE.Vector2() }; u.scroll1 = { value: new THREE.Vector2() };
    this.uniforms = u;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: u, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  set(row) {
    this.row = row;
    this.mesh.visible = !!row;
    if (!row) return;
    const u = this.uniforms;
    const tex = (fid) => (fid ? loadTex(fid, 0) : null);
    u.base.value = tex(row.base);
    u.lightMask.value = tex(row.lightMask); u.hasLight.value = row.lightMask ? 1 : 0;
    u.atmoMask.value = tex(row.atmoMask); u.atmoMod.value = tex(row.atmoModified); u.hasAtmo.value = row.atmoMask && row.atmoModified ? 1 : 0;
    u.glowMask0.value = tex(row.glowMask[0]); u.glowMod0.value = tex(row.glowModified[0]); u.hasGlow0.value = row.glowMask[0] && row.glowModified[0] ? 1 : 0;
    u.glowMask1.value = tex(row.glowMask[1]); u.glowMod1.value = tex(row.glowModified[1]); u.hasGlow1.value = row.glowMask[1] && row.glowModified[1] ? 1 : 0;
    u.atmoScale.value = 1 / (row.atmoScale || 1); u.glowScale0.value = 1 / (row.glowScale[0] || 1); u.glowScale1.value = 1 / (row.glowScale[1] || 1);
    const dir = new THREE.Vector3(...row.pos).normalize();
    const dist = 1400;
    const size = 2 * dist * Math.tan(((row.scale || 5) * Math.PI) / 360);
    this.mesh.position.copy(dir).multiplyScalar(dist);
    this.mesh.scale.set(size, size, 1);
    this.mesh.lookAt(0, 0, 0);
  }
  update(nowMs, daylight) {
    if (!this.row) return;
    const u = this.uniforms;
    u.rot.value = rateOffset(nowMs, this.row.rotateRate / (2 * Math.PI)) * 2 * Math.PI;
    u.scroll0.value.set(rateOffset(nowMs, this.row.scrollU[0]), rateOffset(nowMs, this.row.scrollV[0]));
    u.scroll1.value.set(rateOffset(nowMs, this.row.scrollU[1]), rateOffset(nowMs, this.row.scrollV[1]));
    u.opacity.value = 1 - daylight * 0.5;
  }
}
const bodyLayer = new CelestialBodyLayer();

// M2 skybox model
const BLEND = {
  0: {}, 1: { alphaTest: 0.5 },
  2: { src: THREE.SrcAlphaFactor, dst: THREE.OneMinusSrcAlphaFactor },
  3: { src: THREE.OneFactor, dst: THREE.OneFactor },
  4: { src: THREE.SrcAlphaFactor, dst: THREE.OneFactor },
  5: { src: THREE.DstColorFactor, dst: THREE.ZeroFactor },
  6: { src: THREE.DstColorFactor, dst: THREE.SrcColorFactor },
  7: { src: THREE.OneFactor, dst: THREE.OneMinusSrcAlphaFactor },
};
// WoWViewer's shader table, pixel then vertex, for shader ids with the 0x8000 bit
const SHADER_TABLE = [[12, 3], [13, 3], [14, 3], [15, 6], [16, 3], [13, 7], [16, 7], [17, 3], [18, 3], [19, 6], [20, 7], [21, 3], [22, 3], [23, 3], [23, 7], [20, 2], [24, 3], [25, 6], [26, 0], [33, 9], [27, 11], [6, 12], [28, 2], [29, 7], [25, 11], [33, 13], [30, 14], [31, 2], [32, 14], [34, 7], [35, 15], [35, 16], [0, 0], [7, 12], [1, 9], [36, 12]];
function pixelShaderId(shaderId, n) {
  if (shaderId & 0x8000) return SHADER_TABLE[shaderId & 0x7fff]?.[0] ?? 1;
  if (n === 1) return (shaderId & 0x70) !== 0 ? 1 : 0;
  const low = shaderId & 7;
  if (shaderId & 0x70) return [11, 6, 6, 8, 7, 6, 9, 10][low];
  return [5, 2, 2, 13, 3, 2, 4, 14][low];
}
function vertexShaderId(shaderId, n) {
  if (shaderId & 0x8000) return SHADER_TABLE[shaderId & 0x7fff]?.[1] ?? 0;
  if (n === 1) return (shaderId & 0x80) === 0 ? ((shaderId & 0x4000) ? 10 : 0) : 1;
  if ((shaderId & 0x80) === 0) return (shaderId & 8) ? 3 : ((shaderId & 0x4000) ? 2 : 7);
  return (shaderId & 8) ? 5 : 4;
}

const M2_VERT = `
  attribute vec2 uv1; attribute vec4 skinIndex; attribute vec4 skinWeight;
  uniform mat4 bones[NBONES]; uniform mat4 texMat0; uniform mat4 texMat1; uniform int vsId;
  varying vec2 vUv1; varying vec2 vUv2;
  void main() {
    mat4 skin = skinWeight.x * bones[int(skinIndex.x)] + skinWeight.y * bones[int(skinIndex.y)]
              + skinWeight.z * bones[int(skinIndex.z)] + skinWeight.w * bones[int(skinIndex.w)];
    vec4 p = skin * vec4(position, 1.0);
    vec2 t1 = (texMat0 * vec4(uv, 0.0, 1.0)).xy;
    vec2 t2 = (texMat1 * vec4(uv1, 0.0, 1.0)).xy;
    vUv1 = (vsId == 10) ? t2 : t1;
    vUv2 = (vsId == 2 || vsId == 14 || vsId == 15) ? t2 : t1;
    gl_Position = projectionMatrix * viewMatrix * vec4(p.xyz + cameraPosition, 1.0);
  }`;
const M2_FRAG = `
  uniform sampler2D tex1; uniform sampler2D tex2; uniform sampler2D tex3; uniform sampler2D tex4;
  uniform vec3 meshColor; uniform float opacity; uniform vec3 weights; uniform int psId; uniform float alphaTest;
  varying vec2 vUv1; varying vec2 vUv2;
  void main() {
    vec4 t1 = texture2D(tex1, vUv1);
    vec4 t2 = texture2D(tex2, (psId == 26 || psId == 28) ? vUv1 : vUv2);
    vec4 t3 = texture2D(tex3, vUv1);
    vec4 t4 = texture2D(tex4, vUv2);
    vec3 rgb; float a;
    if (psId == 0) { rgb = meshColor * t1.rgb; a = 1.0; }
    else if (psId == 2) { rgb = meshColor * t1.rgb * t2.rgb; a = t2.a; }
    else if (psId == 3) { rgb = meshColor * t1.rgb * t2.rgb * 2.0; a = t2.a; }
    else if (psId == 4) { rgb = meshColor * t1.rgb * t2.rgb * 2.0; a = 1.0; }
    else if (psId == 5) { rgb = meshColor * t1.rgb * t2.rgb; a = 1.0; }
    else if (psId == 6) { rgb = meshColor * t1.rgb * t2.rgb; a = t1.a * t2.a; }
    else if (psId == 7) { rgb = meshColor * t1.rgb * t2.rgb * 2.0; a = t1.a * t2.a * 2.0; }
    else if (psId == 8) { rgb = meshColor * (t1.rgb + t2.rgb); a = t1.a + t2.a; }
    else if (psId == 9) { rgb = meshColor * t1.rgb * t2.rgb * 2.0; a = t1.a; }
    else if (psId == 10) { rgb = meshColor * (t1.rgb + t2.rgb); a = t1.a; }
    else if (psId == 11) { rgb = meshColor * t1.rgb * t2.rgb; a = t1.a; }
    else if (psId == 12) { rgb = meshColor * mix(t1.rgb * t2.rgb * 2.0, t1.rgb, vec3(t1.a)); a = 1.0; }
    else if (psId == 13) { rgb = meshColor * (t1.rgb + t2.rgb * t2.a); a = 1.0; }
    else if (psId == 18) { rgb = meshColor * mix(mix(t1.rgb, t2.rgb, vec3(t2.a)), t1.rgb, vec3(t1.a)); a = 1.0; }
    else if (psId == 22) { rgb = meshColor * mix(t1.rgb * t2.rgb, t1.rgb, vec3(t1.a)); a = 1.0; }
    else if (psId == 26) { vec4 m = mix(mix(t1, t2, clamp(weights.g, 0.0, 1.0)), t3, clamp(weights.b, 0.0, 1.0)); rgb = meshColor * m.rgb; a = m.a; }
    else if (psId == 28) { vec4 m = mix(mix(t1, t2, clamp(weights.g, 0.0, 1.0)), t3, clamp(weights.b, 0.0, 1.0)); rgb = meshColor * m.rgb; a = m.a * t4.a; }
    else if (psId == 29) { rgb = meshColor * mix(t1.rgb, t2.rgb, vec3(t2.a)); a = 1.0; }
    else { rgb = meshColor * t1.rgb; a = t1.a; }
    a *= opacity;
    if (a < alphaTest) discard;
    gl_FragColor = vec4(rgb, a);
  }`;

const IDENTITY = new THREE.Matrix4();

// the loop clock
// While an export renders a loop, every period read from the wall clock is snapped to a whole number of cycles
// over the loop, so the last frame runs into the first. LOOP is null in ordinary play.
let LOOP = null; // { ms, phase, snap }
// a clock far slower than the loop is held still, one near it or faster runs a whole number of cycles
const loopCycles = (x) => (x < 0.5 ? 0 : Math.max(1, Math.round(x)));
/** The time within a period of `len` ms at wall time `nowMs`. */
function cycleTime(nowMs, len) {
  if (!(len > 0)) return 0;
  if (!LOOP?.snap) return nowMs % len;
  return ((LOOP.phase * loopCycles(LOOP.ms / len)) % 1) * len;
}
/** How far a rate per second has travelled by `nowMs`, in cycles, which is a period of 1000 / rate ms read as a fraction. */
function rateOffset(nowMs, rate) {
  if (rate === 0) return 0;
  const len = 1000 / Math.abs(rate);
  return (Math.sign(rate) * cycleTime(nowMs, len)) / len;
}

/** Sample an M2 track at a time in one sequence (or its global loop), with the given default. */
function sampleTrack(track, kind, animMs, seqIdx, nowMs, loops, dflt) {
  if (!track) return dflt;
  let seq, t;
  if (track.gseq >= 0) {
    seq = track.seqs[0];
    const len = loops[track.gseq] || 0;
    t = cycleTime(nowMs, len);
  } else {
    seq = track.seqs[seqIdx] ?? track.seqs[0];
    t = animMs;
  }
  if (!seq || seq.t.length === 0) return dflt;
  const ts = seq.t, vs = seq.v;
  if (t <= ts[0] || ts.length === 1) return vs[0];
  if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; }
  const k = track.interp === 0 ? 0 : (t - ts[lo]) / (ts[hi] - ts[lo]);
  const a = vs[lo], b = vs[hi];
  if (kind === "num") return lerp(a, b, k);
  if (kind === "quat") {
    const qa = new THREE.Quaternion(a[0], a[1], a[2], a[3]), qb = new THREE.Quaternion(b[0], b[1], b[2], b[3]);
    return qa.slerp(qb, k).toArray();
  }
  return lerp3(a, b, k);
}

class SkyboxModel {
  constructor(model, skyboxRow, baseOrder) {
    this.model = model;
    this.flags = skyboxRow.flags;
    this.root = new THREE.Group();
    this.root.renderOrder = baseOrder;
    const m = model;
    if (!m.skin) throw new Error("model has no skin");
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(m.uv0, 2));
    geom.setAttribute("uv1", new THREE.Float32BufferAttribute(m.uv1, 2));
    geom.setAttribute("skinIndex", new THREE.Float32BufferAttribute(m.boneIndices, 4));
    geom.setAttribute("skinWeight", new THREE.Float32BufferAttribute(m.boneWeights, 4));
    geom.setIndex(m.skin.indices);
    this.textures = m.textures.map((t) => (t.fid ? loadTex(t.fid, t.flags) : null));
    this.boneMats = m.bones.map(() => new THREE.Matrix4());
    this.texMats = m.textureTransforms.map(() => new THREE.Matrix4());
    this.batches = [];
    // the client's transparent order: priority plane ascending, then far to near
    const rank = new Map(m.skin.batches.map((b, i) => [i, {p: b.priority, d: Math.hypot(...(m.skin.submeshes[b.submesh].sortCenter ?? [0, 0, 0])), i}])
      .toSorted((x, y) => x[1].p - y[1].p || y[1].d - x[1].d || x[1].i - y[1].i).map(([i], r) => [i, r]));
    m.skin.batches.forEach((b, bi) => {
      const sub = m.skin.submeshes[b.submesh];
      const mat = m.materials[b.material];
      const texIds = [];
      for (let k = 0; k < b.textureCount; k++) texIds.push(m.textureLookup[b.textureCombo + k]);
      const ps = pixelShaderId(b.shader, b.textureCount), vs = vertexShaderId(b.shader, b.textureCount);
      const blend = BLEND[mat.blend] || {};
      const uniforms = {
        bones: { value: this.boneMats },
        texMat0: { value: new THREE.Matrix4() }, texMat1: { value: new THREE.Matrix4() },
        vsId: { value: vs }, psId: { value: ps },
        tex1: { value: this.textures[texIds[0]] }, tex2: { value: this.textures[texIds[1]] ?? this.textures[texIds[0]] },
        tex3: { value: this.textures[texIds[2]] ?? this.textures[texIds[0]] }, tex4: { value: this.textures[texIds[3]] ?? this.textures[texIds[0]] },
        meshColor: { value: new THREE.Vector3(1, 1, 1) }, opacity: { value: 1 }, weights: { value: new THREE.Vector3(1, 1, 1) },
        alphaTest: { value: mat.blend === 1 ? 0.5 : mat.blend === 0 ? 0 : 1 / 255 },
      };
      const material = new THREE.ShaderMaterial({
        uniforms, vertexShader: M2_VERT.replace("NBONES", String(Math.max(1, m.bones.length))), fragmentShader: M2_FRAG,
        depthTest: false, depthWrite: false, transparent: mat.blend !== 0,
        side: mat.flags & 4 ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (blend.src) {
        material.blending = THREE.CustomBlending; material.blendEquation = THREE.AddEquation;
        material.blendSrc = blend.src; material.blendDst = blend.dst;
        material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      } else material.blending = THREE.NoBlending;
      const g = geom.clone();
      g.setDrawRange(sub.indexStart, sub.indexCount);
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = baseOrder + rank.get(bi);
      this.root.add(mesh);
      const xf = [];
      for (let k = 0; k < 2; k++) {
        const li = b.transformCombo + k;
        xf.push(li < m.textureTransformLookup.length ? m.textureTransformLookup[li] : -1);
      }
      const wIdx = [];
      for (let k = 0; k < 3; k++) {
        const li = b.weightCombo + k;
        wIdx.push(li < m.transparencyLookup.length ? m.transparencyLookup[li] : -1);
      }
      this.batches.push({ b, mat, uniforms, xf, wIdx, ps, vs, texIds });
    });
  }

  /** Advance every track: bones, texture transforms, colours and weights, then push the uniforms. */
  update(animPerc, nowMs) {
    const m = this.model;
    const seq = m.sequences[0];
    const dur = seq ? seq.duration : 1;
    const animMs = this.flags & 1 ? animPerc * dur : cycleTime(nowMs, dur);
    const loops = m.globalLoops;
    const T = new THREE.Matrix4(), R = new THREE.Matrix4(), S = new THREE.Matrix4(), P = new THREE.Matrix4(), NP = new THREE.Matrix4();
    m.bones.forEach((bone, i) => {
      const tr = sampleTrack(bone.translation, "vec3", animMs, 0, nowMs, loops, [0, 0, 0]);
      const q = sampleTrack(bone.rotation, "quat", animMs, 0, nowMs, loops, [0, 0, 0, 1]);
      const sc = sampleTrack(bone.scale, "vec3", animMs, 0, nowMs, loops, [1, 1, 1]);
      P.makeTranslation(bone.pivot[0], bone.pivot[1], bone.pivot[2]);
      NP.makeTranslation(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]);
      T.makeTranslation(tr[0], tr[1], tr[2]);
      R.makeRotationFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]));
      S.makeScale(sc[0], sc[1], sc[2]);
      const local = P.clone().multiply(T).multiply(R).multiply(S).multiply(NP);
      const parent = this.boneMats[bone.parent];
      this.boneMats[i].copy(parent ? parent.clone().multiply(local) : local);
    });
    m.textureTransforms.forEach((x, i) => {
      const tr = sampleTrack(x.translation, "vec3", animMs, 0, nowMs, loops, [0, 0, 0]);
      const q = sampleTrack(x.rotation, "quat", animMs, 0, nowMs, loops, [0, 0, 0, 1]);
      const sc = sampleTrack(x.scale, "vec3", animMs, 0, nowMs, loops, [1, 1, 1]);
      P.makeTranslation(0.5, 0.5, 0); NP.makeTranslation(-0.5, -0.5, 0);
      T.makeTranslation(tr[0], tr[1], tr[2]);
      R.makeRotationFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]));
      S.makeScale(sc[0], sc[1], sc[2]);
      this.texMats[i].copy(T).multiply(P).multiply(R).multiply(NP).multiply(P).multiply(S).multiply(NP);
    });
    const colors = m.colors.map((c) => ({
      rgb: sampleTrack(c.color, "vec3", animMs, 0, nowMs, loops, [1, 1, 1]),
      a: sampleTrack(c.alpha, "num", animMs, 0, nowMs, loops, 1),
    }));
    const weights = m.textureWeights.map((w) => sampleTrack(w, "num", animMs, 0, nowMs, loops, 1));
    for (const bt of this.batches) {
      const u = bt.uniforms;
      const col = bt.b.color !== 65535 && colors[bt.b.color] ? colors[bt.b.color] : { rgb: [1, 1, 1], a: 1 };
      u.meshColor.value.set(col.rgb[0], col.rgb[1], col.rgb[2]);
      const w = bt.wIdx.map((i) => (i >= 0 && i < weights.length ? weights[i] : 1));
      u.weights.value.set(w[0], w[1], w[2]);
      let op = col.a;
      if (bt.b.textureCount && !(bt.b.flags & 0x40)) op *= w[0];
      u.opacity.value = op;
      u.texMat0.value.copy(this.texMats[bt.xf[0]] ?? IDENTITY);
      u.texMat1.value.copy(this.texMats[bt.xf[1]] ?? IDENTITY);
    }
  }

  dispose() {
    scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

// colour grading (the LightData LUT) as a post pass
// A 1024x32 texture is 32 slices of 32x32: blue picks the slice, red the column inside it, green the row.
const LUT_GLSL = `
  uniform sampler2D lutA; uniform sampler2D lutB; uniform float lutOnA; uniform float lutOnB; uniform float lutK;
  vec3 lutLookup(sampler2D t, vec3 c) {
    c = clamp(c, 0.0, 1.0);
    float b = c.b * 31.0; float s0 = floor(b); float s1 = min(s0 + 1.0, 31.0); float f = b - s0;
    float y = (c.g * 31.0 + 0.5) / 32.0;
    float x0 = (s0 * 32.0 + c.r * 31.0 + 0.5) / 1024.0; float x1 = (s1 * 32.0 + c.r * 31.0 + 0.5) / 1024.0;
    return mix(texture2D(t, vec2(x0, y)).rgb, texture2D(t, vec2(x1, y)).rgb, f);
  }
  vec3 grade(vec3 c) {
    vec3 a = mix(c, lutLookup(lutA, c), lutOnA);
    vec3 b = mix(c, lutLookup(lutB, c), lutOnB);
    return mix(a, b, lutK);
  }`;
const lutUniforms = () => ({ lutA: { value: null }, lutB: { value: null }, lutOnA: { value: 0 }, lutOnB: { value: 0 }, lutK: { value: 0 } });
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let viewTarget = new THREE.WebGLRenderTarget(4, 4);
/** The target at that size: the same one when it already is, a fresh one otherwise. */
function sized(target, w, h) {
  if (target.width === w && target.height === h) return target;
  target.dispose();
  return new THREE.WebGLRenderTarget(w, h);
}
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { view: { value: viewTarget.texture }, ...lutUniforms() },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D view; varying vec2 vUv; ${LUT_GLSL} void main(){ gl_FragColor = vec4(grade(texture2D(view, vUv).rgb), 1.0); }`,
  depthTest: false, depthWrite: false,
}));
postScene.add(postQuad);

// screen effects (the client's FFX pixel shaders, read from their DXBC)
// Each ScreenEffect type is one branch. Death, GlowFade (unconscious), NetherCombine (netherworld), FogCombine
// (swirling fog), ColorGrading (type 6, a LUT by file id in Param_0), SpectralSight and Custom (the
// FullScreenEffect row) follow the disassembled arithmetic; the sketch pass (type 5) and the fog's own buffer are
// approximated, since those live across several frames and textures the preview does not have.
const SE_GLSL = `
  uniform sampler2D seView; uniform vec2 seSize; uniform int seType; uniform vec4 seColor; uniform float seP1; uniform float seP2; uniform float seGlow;
  uniform float seTime;
  uniform sampler2D seLut; uniform float seLutOn;
  // FFXCustom, the type-8 effect: PSConstantsFFXCustom exactly as the client fills it (ffxConstants below), the
  // four textures in sampler order, and ffxBound saying which of them are bound
  uniform vec4 ffxGamma; uniform vec4 ffxMultiply; uniform vec4 ffxAdd; uniform vec4 ffxRadialAnim; uniform vec4 ffxTexAnim0; uniform vec4 ffxTexAnim1;
  uniform vec4 ffxGammaParams; uniform vec4 ffxMultiplyParams; uniform vec4 ffxAddParams; uniform vec4 ffxBlurParams; uniform vec4 ffxColorMod; uniform vec4 ffxSwizzle;
  uniform sampler2D ffxMaskTex; uniform sampler2D ffxRadialTex; uniform sampler2D ffxOverlayTex0; uniform sampler2D ffxOverlayTex1; uniform vec4 ffxBound;
  vec3 box4(vec2 uv, float r) {
    vec2 o = r / seSize;
    return 0.25 * (texture2D(seView, uv + vec2(-o.x, -o.y)).rgb + texture2D(seView, uv + vec2(o.x, -o.y)).rgb + texture2D(seView, uv + vec2(-o.x, o.y)).rgb + texture2D(seView, uv + o).rgb);
  }
  vec3 blurred(vec2 uv, float r) { return 0.5 * (box4(uv, r) + box4(uv, r * 2.3)); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
  float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  // a stage's mask, by its mode: 1 the whole screen, 2 the squared distance from (0.5, 0.5 + offset) times the
  // multiplier to the power, 3 the same inverted; cuv is the client's uv, which runs down
  float ffxMask(vec2 cuv, vec4 p, float mode) {
    if (mode < 1.5) return 1.0;
    vec2 d = vec2(cuv.x - 0.5, cuv.y - (0.5 + p.x));
    float k = min(dot(d, d) * p.y, 1.0);
    if (mode > 2.5) k = 1.0 - k;
    return pow(max(k, 1e-6), p.z);
  }
  float ffxPick(vec4 v, float i) { return i < 0.5 ? v.x : i < 1.5 ? v.y : i < 2.5 ? v.z : v.w; }
  vec3 ffxCustom(vec3 scene, vec2 uv) {
    vec2 cuv = vec2(uv.x, 1.0 - uv.y);
    float fade = ffxRadialAnim.w;
    // the blur permutation first: the blurred scene through its own mask
    if (ffxBlurParams.y > 0.0) scene = mix(scene, blurred(uv, 3.0), ffxMask(cuv, ffxBlurParams, 2.0));
    // gamma (from the green channel) or saturation, then multiply, then add, each behind its mask
    vec3 r = ffxGamma.w > 0.5
      ? mix(scene, pow(vec3(max(scene.g, 1e-6)), ffxGamma.xyz), ffxMask(cuv, ffxGammaParams, ffxGamma.w) * fade)
      : mix(scene, vec3(dot(scene, vec3(0.3, 0.6, 0.1))), ffxBlurParams.w);
    if (ffxMultiply.w > 0.5) r *= 1.0 + ffxMask(cuv, ffxMultiplyParams, ffxMultiply.w) * fade * (ffxMultiply.xyz - 1.0);
    if (ffxAdd.w > 0.5) r += ffxAdd.xyz * min(ffxMask(cuv, ffxAddParams, ffxAdd.w) * fade, 1.0);
    // the layer: the radial texture in polar coordinates, times both overlays and colorMod, over the scene,
    // swizzled, and blended in by the mask texture. The angle is the shader's own: dx folded to its magnitude,
    // measured from the downward vertical, the top half mirrored, so u runs 0..1 from the bottom centre round
    // to the top centre on either side.
    vec2 d = cuv - 0.5; float fold = atan(abs(d.x), abs(d.y)); float angle = d.y >= 0.0 ? fold : 3.14159265 - fold;
    vec4 radial = ffxBound.y > 0.5 ? texture2D(ffxRadialTex, vec2(angle * 0.31831, length(d)) * ffxRadialAnim.z + ffxRadialAnim.xy) : vec4(1.0);
    vec4 overlay = ffxColorMod;
    if (ffxBound.z > 0.5) overlay *= texture2D(ffxOverlayTex0, cuv * ffxTexAnim0.zw + ffxTexAnim0.xy);
    if (ffxBound.w > 0.5) overlay *= texture2D(ffxOverlayTex1, cuv * ffxTexAnim1.zw + ffxTexAnim1.xy);
    vec4 layer = radial * overlay;
    vec4 composed = vec4(scene * (1.0 - layer.a) + layer.rgb, layer.a);
    vec4 picked = vec4(ffxPick(composed, ffxSwizzle.x), ffxPick(composed, ffxSwizzle.y), ffxPick(composed, ffxSwizzle.z), ffxPick(composed, ffxSwizzle.w));
    float mask = ffxBound.x > 0.5 ? texture2D(ffxMaskTex, cuv).a : 1.0;
    return mix(r, picked.rgb, clamp(mask * picked.a * fade, 0.0, 1.0));
  }
  vec3 screenEffect(vec3 c, vec2 uv) {
    // FFXGlow, always on: the scene blurred at a quarter size, squared, times the preset's Glow, added back
    if (seGlow > 0.0) { vec3 b = blurred(uv, 4.0); c += b * b * seGlow; }
    if (seType == 1) { // FFXDeath: luminance plus a mid-tone teal tint
      float l = clamp(lumaOf(c + blurred(uv, 2.0) * blurred(uv, 2.0) * 0.5), 0.0, 1.0);
      float k = min(4.0 * l * (1.0 - l), 1.0);
      return vec3(l) + k * vec3(0.325, 0.576, 0.659);
    }
    if (seType == 2) { // FFXNetherCombine: half scene plus blur, flattened toward its mean, tinted, blended in by the combine amount
      vec3 b = blurred(uv, 2.0 + seP1 * 0.03);
      vec3 c2 = c * 0.5 + b;
      float avg = (c2.r + c2.g + c2.b) * 0.166666;
      c2 = c2 * 0.5 + avg;
      vec3 tint = seColor.rgb == vec3(0.0) ? vec3(0.75, 0.85, 1.0) : seColor.rgb;
      return mix(c, c2 * tint, seP2 * 0.01);
    }
    if (seType == 3) { // FFXFogSeed, PropagateFog, FogCombine
      // Param_1 is the screen-edge size: the lower it is, the closer to the centre the fog reaches, and at zero it
      // covers the screen; Param_2 is the greyscale amount, 100 being black and white.
      // The propagated buffer is sampled in polar coordinates by the combine pass, which is the slow swirl.
      vec2 d = uv - 0.5; float r = length(d) * 2.0; float ang = atan(d.y, d.x) * 0.31831;
      float n = fbm(vec2(ang * 3.0 + seTime * 0.02, r * 2.0 - seTime * 0.04) * 2.0);
      float inner = 0.3 + clamp(seP1 / 6.0, 0.0, 1.0); // where the fog begins, in half-screen units; zero reaches the centre
      float cover = smoothstep(inner, inner + 0.6, r) * 0.6; // the buffer never saturates: a corner is a dark tint, not a fill
      float fogA = clamp(cover * (0.85 + 0.3 * (n - 0.5)), 0.0, 1.0);
      float l = dot(c, vec3(0.333333));
      vec3 s = mix(c, vec3(l), clamp(seP2 * 0.01, 0.0, 1.0));
      return mix(s, seColor.rgb, fogA);
    }
    if (seType == 4) { // FFXGlowFade: the scene blurs as it fades to the colour; drawn at the end of its fade
      return seColor.rgb;
    }
    if (seType == 5) { // FFXSketch: edges become ink over a toned paper
      vec2 px = 1.0 / seSize;
      float tl = lumaOf(texture2D(seView, uv + px * vec2(-1.5, -1.5)).rgb), tr = lumaOf(texture2D(seView, uv + px * vec2(1.5, -1.5)).rgb);
      float bl = lumaOf(texture2D(seView, uv + px * vec2(-1.5, 1.5)).rgb), br = lumaOf(texture2D(seView, uv + px * vec2(1.5, 1.5)).rgb);
      float gx = (tr + br) - (tl + bl), gy = (bl + br) - (tl + tr);
      float edge = pow(clamp(sqrt(gx * gx + gy * gy) * 4.0, 0.0, 1.0), 0.8);
      float l = lumaOf(c);
      float tone = pow(l, 0.9);
      vec3 paper = vec3(0.93, 0.88, 0.76) * (0.85 + 0.15 * vnoise(uv * seSize * 0.5));
      vec3 ink = vec3(0.12, 0.09, 0.06);
      vec3 s = mix(ink, paper, tone);
      s = mix(s, ink, edge);
      if (seP2 >= 1000.0) s = mix(paper * 0.9, s, 0.8); // the parchment filter keeps more of the page
      return s;
    }
    if (seType == 6) { // FFXColorGrading by the file id in Param_0
      return seLutOn > 0.5 ? lutLookup(seLut, c) : c;
    }
    if (seType == 7) { // FFXSpectralSight: contrast, desaturation, a drifting noise veil, a vignette and the tint
      vec3 b = blurred(uv, 2.0);
      vec3 con = pow(max(b, vec3(0.0)), vec3(1.7, 1.4, 1.7)) * 1.1 - 0.1;
      float l = dot(c, vec3(0.3, 0.6, 0.1));
      vec3 d = mix(c, vec3(l), 0.7);
      d = abs(d) * 1.5; d = d * d;
      vec2 q = uv - 0.5;
      float vig = pow(1.0 - min(dot(q, q) * 5.0, 1.0), 8.0);
      float n = vnoise(uv * 4.0 + seTime * 0.1) * vnoise(uv * 9.0 - seTime * 0.13);
      vec3 tint = seColor.rgb == vec3(0.0) ? vec3(0.4, 0.9, 0.2) : seColor.rgb;
      vec3 s = mix(con, d, vig) * tint + n * tint * 0.8;
      return s;
    }
    if (seType == 8) return ffxCustom(c, uv);
    return c;
  }`;
/** PSConstantsFFXCustom's fields, in the shader's order; each is one vec4 uniform named ffx<Field>. */
const FFX_CONSTANTS = ["gamma", "multiply", "add", "radialAnim", "texAnim0", "texAnim1", "gammaParams", "multiplyParams", "addParams", "blurParams", "colorMod", "swizzle"];
const FFX_UNIFORMS = FFX_CONSTANTS.map((name) => "ffx" + name[0].toUpperCase() + name.slice(1));
/** The FullScreenEffect row and blend set of the screen effect in force, or null when it is not a type 8. */
function currentFfx() {
  const se = state.screen;
  const f = se?.row.effect === 8 ? state.light.fullScreenEffects?.[se.row.fullScreen] : null;
  return f ? { f, bs: state.light.textureBlendSets?.[f.TextureBlendSetID] ?? NO_BLEND_SET } : null;
}
const screenScene = new THREE.Scene();
let screenTarget = new THREE.WebGLRenderTarget(4, 4);
const seUniforms = () => ({
  seView: { value: screenTarget.texture }, seSize: { value: new THREE.Vector2(4, 4) }, seType: { value: 0 }, seColor: { value: new THREE.Vector4(0, 0, 0, 0) },
  seP1: { value: 0 }, seP2: { value: 0 }, seTime: { value: 0 }, seLut: { value: null }, seLutOn: { value: 0 }, seGlow: { value: 0 },
  ...Object.fromEntries(FFX_UNIFORMS.map((name) => [name, { value: new THREE.Vector4() }])),
  ffxMaskTex: { value: null }, ffxRadialTex: { value: null }, ffxOverlayTex0: { value: null }, ffxOverlayTex1: { value: null }, ffxBound: { value: new THREE.Vector4() },
});
const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { ...seUniforms(), ...lutUniforms() },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `varying vec2 vUv; ${LUT_GLSL} ${SE_GLSL} void main(){ gl_FragColor = vec4(screenEffect(texture2D(seView, vUv).rgb, vUv), 1.0); }`,
  depthTest: false, depthWrite: false,
}));
screenScene.add(screenQuad);
/** Push the screen effect in force into the pass; type 0 and no effect leave the image alone. */
function updateScreenUniforms(nowMs, width, height) {
  const u = screenQuad.material.uniforms;
  u.seSize.value.set(width, height);
  const se = state.screen;
  u.seType.value = se ? se.row.effect : 0;
  u.seTime.value = nowMs / 1000;
  u.seGlow.value = state.layers.lut ? (state.light.params[state.paramId]?.glow ?? 0) : 0;
  if (!se) return;
  const p = se.row.params;
  // ScreenEffect packs a colour as rrggbbxx, red in the low byte and the top byte unused
  u.seColor.value.set((p[0] & 255) / 255, ((p[0] >> 8) & 255) / 255, ((p[0] >> 16) & 255) / 255, ((p[0] >>> 24) & 255) / 255);
  u.seP1.value = p[1]; u.seP2.value = p[2];
  if (se.row.effect === 6) { u.seLut.value = p[0] ? lutTexture(p[0]) : null; u.seLutOn.value = p[0] ? 1 : 0; }
  if (se.row.effect === 8) {
    const ffx = currentFfx();
    if (!ffx) { u.seType.value = 0; return; }
    const [mask, radial, overlay0, overlay1] = ffxTextures(ffx.f, ffx.bs);
    const radialTex = radial ? loadTex(radial, 3) : null;
    const radialSize = radialTex && radialTex.image.width > 1 ? [radialTex.image.width, radialTex.image.height] : [256, 256]; // the placeholder is one texel until the file lands
    // the scroll clock counts from the effect's start; under a loop render it completes whole cycles
    const scroll = (rate) => rateOffset(nowMs - se.since, rate * FFX_SCROLL_SPEED);
    const k = ffxConstants(ffx.f, ffx.bs, (nowMs - se.since) / 1000, [width, height], radialSize, scroll);
    for (let i = 0; i < FFX_CONSTANTS.length; i++) { const v = k[FFX_CONSTANTS[i]]; u[FFX_UNIFORMS[i]].value.set(v[0], v[1], v[2], v[3]); }
    u.ffxMaskTex.value = mask ? loadTex(mask, 0) : null;
    u.ffxRadialTex.value = radialTex;
    u.ffxOverlayTex0.value = overlay0 ? loadTex(overlay0, 3) : null;
    u.ffxOverlayTex1.value = overlay1 ? loadTex(overlay1, 3) : null;
    u.ffxBound.value.set(mask ? 1 : 0, radialTex ? 1 : 0, overlay0 ? 1 : 0, overlay1 ? 1 : 0);
  }
}
/** Draw the graded image through the screen pass to the current target; `w` and `h` size the intermediate. */
function screenPass(w, h, drawGraded) {
  screenTarget = sized(screenTarget, w, h); screenQuad.material.uniforms.seView.value = screenTarget.texture;
  const saved = renderer.getRenderTarget();
  renderer.setRenderTarget(screenTarget);
  renderer.clear();
  drawGraded();
  renderer.setRenderTarget(saved);
  renderer.render(screenScene, postCam);
}

// panorama (Mercator strip of a cube capture)
const PANO_LO = -4, PANO_HI = 64; // degrees of elevation the strip spans
const mercY = (deg) => Math.log(Math.tan(Math.PI / 4 + (deg * Math.PI / 180) / 2));
const PANO_ASPECT = (2 * Math.PI) / (mercY(PANO_HI) - mercY(PANO_LO));
const PAGE_CUBE = 1024; // per face: what the page's own panorama is captured into
let cubeTarget = new THREE.WebGLCubeRenderTarget(PAGE_CUBE);
const cubeCam = new THREE.CubeCamera(0.1, 20000, cubeTarget);
const panoScene = new THREE.Scene();
const panoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const panoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { cube: { value: cubeTarget.texture }, yaw0: { value: 0 }, span: { value: 1 }, ...lutUniforms() },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    // Mercator strip from -4 to 64 degrees of elevation: conformal, so the moon stays round; yaw0 scrolls it
    // span is the share of the turn the canvas shows: the whole turn is 1, a window of it on a narrow page less
    uniform samplerCube cube; uniform float yaw0; uniform float span; varying vec2 vUv;
    ${LUT_GLSL}
    void main(){
      float lon = (vUv.x - 0.5) * 6.28318530718 * span + yaw0;
      float y0 = log(tan(0.7853981634 + (PANO_LO * 0.0174532925) * 0.5));
      float y1 = log(tan(0.7853981634 + (PANO_HI * 0.0174532925) * 0.5));
      float lat = 2.0 * atan(exp(mix(y0, y1, vUv.y))) - 1.5707963268;
      vec3 d = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
      gl_FragColor = vec4(grade(textureCube(cube, d).rgb), 1.0);
    }`.replace("PANO_LO", PANO_LO.toFixed(1)).replace("PANO_HI", PANO_HI.toFixed(1)),
  depthTest: false, depthWrite: false,
}));
panoScene.add(panoQuad);

/**
 * Size the cube the turn is captured into for a strip `width` wide: a quarter of the width per face, rounded up to a
 * power of two, never coarser than the page's own and never past what the card allows. A large export otherwise
 * stretches the page's cube, which softens every model texture finer than it.
 */
function sizeCube(width) {
  const limit = Math.min(4096, renderer.capabilities.maxCubemapSize);
  const size = Math.min(limit, Math.max(PAGE_CUBE, 2 ** Math.ceil(Math.log2(Math.max(1, width / 4)))));
  if (cubeTarget.width === size) return;
  cubeTarget.dispose();
  cubeTarget = new THREE.WebGLCubeRenderTarget(size);
  cubeCam.renderTarget = cubeTarget;
  panoQuad.material.uniforms.cube.value = cubeTarget.texture;
}

// a model is parsed once per build and file id, since several presets share one sky
const modelCache = new Map();
// a preset can be asked for while the last one is still fetching, so a load that is no longer wanted is dropped
let loadSerial = 0;
async function loadModel(fid, sb, baseOrder, what) {
  state.loading = `loading ${what} ${fid}…`;
  const key = `${state.build}:${fid}`;
  if (!modelCache.has(key)) modelCache.set(key, loadM2(state.build, fid).catch((e) => { modelCache.delete(key); throw e; }));
  const model = await modelCache.get(key);
  const sky = new SkyboxModel(model, sb, baseOrder);
  scene.add(sky.root);
  return sky;
}

/** Swap the skybox model for another skybox row's, as a ScreenEffect with LightFlags bit 1 does; null restores the preset's own. */
async function swapSkybox(sb) {
  const param = state.light.params[state.paramId];
  const own = state.light.skyboxes[param.skybox];
  const target = sb ?? own;
  if (state.skybox) { state.skybox.dispose(); state.skybox = null; }
  state.screenSkybox = sb;
  if (target && target.fid) {
    try { state.skybox = await loadModel(target.fid, target, 100, "skybox model"); } catch { state.loading = ""; }
  }
  state.loading = "";
}

async function applyScreen(id, spell) {
  const row = state.light.screenEffects?.[id];
  if (!row) return;
  state.screen = { id, row, spell, since: performance.now() };
  if (row.timeOfDay >= 0) state.time = row.timeOfDay * 2;
  // an effect is drawn over the look view and never over the strip, so asking for one turns the panorama off
  if (row.effect && state.pano) state.pano = false;
  if (row.effect === 6 && row.params[0]) lutTexture(row.params[0]);
  const lp = row.lightParams && row.lightFlags & 1 ? state.light.params[row.lightParams] : null;
  const sb = lp ? state.light.skyboxes[lp.skybox] : null;
  if (sb && sb.fid) await swapSkybox(sb);
  else if (state.screenSkybox) await swapSkybox(null);
  emit("preset", state.paramId);
}
async function clearScreen() {
  state.screen = null;
  if (state.screenSkybox) await swapSkybox(null);
  emit("preset", state.paramId);
}
async function loadParam(id) {
  const param = state.light.params[id];
  if (!param) throw new Error(`no LightParams ${id} on ${state.build}`);
  const serial = ++loadSerial;
  state.paramId = id;
  state.error = "";
  emit("preset", id);
  for (const k of ["skybox", "celestial"]) { if (state[k]) { state[k].dispose(); state[k] = null; } }
  state.screenSkybox = null;
  const sb = state.light.skyboxes[param.skybox];
  state.loading = "";
  if (sb && (sb.fid || sb.celestialFid)) {
    try {
      const [main, cel] = await Promise.all([
        sb.fid ? loadModel(sb.fid, sb, 100, "skybox model") : null,
        sb.celestialFid ? loadModel(sb.celestialFid, sb, 50, "celestial model") : null,
      ]);
      if (serial !== loadSerial) { main?.dispose(); cel?.dispose(); return; }
      state.skybox = main; state.celestial = cel;
    } catch (e) {
      state.error = `the model could not be loaded: ${e.message}`;
    }
  }
  state.loading = "";
  // the LUTs the ramp names, so the post pass never waits on the first frame that needs one
  for (const s of param.ramp) if (s.ColorGradingFileDataID) lutTexture(s.ColorGradingFileDataID);
  chooseBody(param);
  emit("preset", id);
}

/** Which CelestialBody row this preset draws: the red star unless the preset hides it, or what the select says. */
function chooseBody(param) {
  const bodies = state.light.celestialBodies || [];
  let row = null;
  if (state.body === "auto") row = param.flags & 128 ? null : bodies.find((b) => b.id === 20) ?? bodies[0] ?? null;
  else if (state.body !== "none") row = bodies.find((b) => String(b.id) === state.body) ?? null;
  bodyLayer.set(row);
}

/**
 * Fetch a build's light tables, saying how much has arrived: they run to megabytes, and a bare spinner over that
 * reads as a hang. An address ending in `.gz` is a gzipped copy, unpacked as it streams in.
 */
async function fetchTables(build) {
  const url = TABLES_URL.replace("{build}", build);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`the ${build} tables did not load (${res.status})`);
  let got = 0;
  const counted = res.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      got += chunk.byteLength;
      state.loading = `loading the ${build} tables, ${(got / 1048576).toFixed(1)} MB`;
      controller.enqueue(chunk);
    },
  }));
  return new Response(url.endsWith(".gz") ? counted.pipeThrough(new DecompressionStream("gzip")) : counted).json();
}

async function loadBuild(build, keepParam) {
  state.loading = `loading the ${build} tables`;
  let tables;
  try {
    tables = await fetchTables(build);
  } catch (e) {
    state.loading = "";
    state.error = e.message;
    throw e;
  }
  // the build and its tables change together, so no frame reads one build's rows under another's name
  state.build = build;
  state.light = tables;
  state.loading = "";
  if (build === DEFAULT_BUILD && !state.map) {
    try {
      const m = await (await fetch("./data/epsilon_map.json")).json();
      m.bySkybox = new Map(m.skyboxes.map((r) => [r.skybox, r]));
      state.map = m;
    } catch { state.map = null; }
  }
  state.screen = null; state.screenSkybox = null;
  emit("build", build);
  const id = keepParam && state.light.params[keepParam] ? keepParam : Number(Object.keys(state.light.params).find((k) => state.light.params[k].skybox) ?? Object.keys(state.light.params)[0]);
  await loadParam(id);
}

// exports: a picture, or a loop encoded in the page
let exportTarget = new THREE.WebGLRenderTarget(4, 4);
let exportScratch = new Uint8Array(0);
/** Draw one offscreen image of `width` by `height` at a day time and wall time, through `draw`, and return its rows top first. */
function renderToImage(width, height, time, nowMs, draw) {
  exportTarget = sized(exportTarget, width, height);
  try {
    updateScene(nowMs, time);
    draw(exportTarget);
  } finally {
    renderer.setRenderTarget(null);
  }
  const bytes = width * height * 4;
  if (exportScratch.length < bytes) exportScratch = new Uint8Array(bytes);
  renderer.readRenderTargetPixels(exportTarget, 0, 0, width, height, exportScratch);
  const rgba = new Uint8ClampedArray(bytes); // GL reads bottom-up
  for (let y = 0; y < height; y++) rgba.set(exportScratch.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  return { width, height, rgba };
}
/** How tall a picture `width` wide is: the strip keeps its own aspect, and the look view takes the canvas's. */
const stripHeight = (width) => Math.round(width / PANO_ASPECT);
const lookHeight = (width) => Math.round((width * canvas.clientHeight) / canvas.clientWidth);
const viewHeight = (width) => (state.pano ? stripHeight(width) : lookHeight(width));
/** The strip at a width, at a day time and wall time. */
function renderStrip(width, time, nowMs = performance.now()) {
  return renderToImage(width, stripHeight(width), time, nowMs, (target) => {
    panoQuad.material.uniforms.yaw0.value = LOOK.yaw;
    panoQuad.material.uniforms.span.value = 1; // a picture is always the whole turn, whatever the page shows
    sizeCube(width);
    cubeCam.position.set(0, 0, 0);
    cubeCam.update(renderer, scene);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(panoScene, panoCam);
  });
}
/** Point the camera where the look angles say; every draw does this, so none depends on another having done it. */
function aimCamera() {
  camera.lookAt(Math.cos(LOOK.pitch) * Math.cos(LOOK.yaw), Math.cos(LOOK.pitch) * Math.sin(LOOK.yaw), Math.sin(LOOK.pitch));
}
/** The look view at a width, graded and with the screen effect, in `height` or else the canvas's own aspect. */
function renderLook(width, time, nowMs = performance.now(), height = lookHeight(width)) {
  const aspect = camera.aspect;
  try {
    return renderToImage(width, height, time, nowMs, (target) => {
      aimCamera();
      updateScreenUniforms(nowMs, width, height);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      viewTarget = sized(viewTarget, width, height); postQuad.material.uniforms.view.value = viewTarget.texture;
      renderer.setRenderTarget(viewTarget);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(target);
      renderer.clear();
      screenPass(width, height, () => renderer.render(postScene, postCam));
    });
  } finally {
    camera.aspect = aspect; camera.updateProjectionMatrix();
  }
}
const renderView = (width, time, nowMs) => (state.pano ? renderStrip(width, time, nowMs) : renderLook(width, time, nowMs));
const stem = () => `sky_${state.build.split(".").slice(0, 3).join(".")}_p${state.paramId}${state.screen ? `_se${state.screen.id}` : ""}`;
const toPng = (f) => {
  const c = document.createElement("canvas"); c.width = f.width; c.height = f.height;
  c.getContext("2d").putImageData(new ImageData(f.rgba, f.width, f.height), 0, 0);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
};
/** Every wall-clock period in the picture, in ms, with a name for the report. */
function loopClocks() {
  const clocks = [];
  const param = state.light?.params[state.paramId];
  const sb = param && state.light.skyboxes[param.skybox];
  const procedural = !state.skybox || !!(sb && sb.flags & 2);
  const drawn = (layer) => state.layers[layer] && !state.layers.neutral;
  for (const [name, layer, model] of [["skybox", "model", state.skybox], ["celestial", "celestialModel", state.celestial]]) {
    if (!model || !drawn(layer)) continue;
    const m = model.model;
    if (!(model.flags & 1) && m.sequences[0]?.duration > 0) clocks.push({ name: `${name} animation`, ms: m.sequences[0].duration });
    (m.globalLoops || []).forEach((len, i) => { if (len > 0) clocks.push({ name: `${name} loop ${i}`, ms: len }); });
  }
  const row = drawn("celestials") && procedural ? bodyLayer.row : null;
  if (row) {
    for (const r of [...row.scrollU, ...row.scrollV]) if (r) clocks.push({ name: "celestial body scroll", ms: 1000 / Math.abs(r) });
    if (row.rotateRate) clocks.push({ name: "celestial body spin", ms: (2000 * Math.PI) / Math.abs(row.rotateRate) });
  }
  const ffx = currentFfx();
  if (ffx) for (const r of [...ffx.bs.scrollU, ...ffx.bs.scrollV]) if (r) clocks.push({ name: "screen effect scroll", ms: 1000 / (Math.abs(r) * FFX_SCROLL_SPEED) });
  // the fog swirl and the spectral veil scroll a noise field that never repeats, so no length loops them
  const type = state.screen?.row.effect;
  if (type === 3 || type === 7) clocks.push({ name: type === 3 ? "fog swirl" : "spectral veil", ms: Infinity, aperiodic: true });
  return clocks;
}
/**
 * What a snap over `ms` does to each clock, worst first: a clock that runs is changed in speed by `change`, and one
 * that is held loses `lost` of a cycle of motion. `cost` is the one number compared against the limit.
 */
function snapChanges(ms, clocks) {
  return clocks.map((c) => {
    if (c.aperiodic) return { ...c, cost: Infinity };
    const x = ms / c.ms, cycles = loopCycles(x);
    return cycles ? { ...c, change: cycles / x - 1, cost: Math.abs(cycles / x - 1) } : { ...c, lost: x, cost: x };
  }).toSorted((a, b) => b.cost - a.cost);
}
const SNAP_LIMIT = 0.12; // a speed change, or a fraction of a cycle held still, nobody notices; above it the seam is cross-faded
const worstCost = (ms, clocks) => snapChanges(ms, clocks)[0]?.cost ?? 0;
/**
 * The frame count nearest `count`, between half and twice it, whose snap is within the limit; `count` itself when
 * it is, and null when none is.
 */
function bestCount(count, fps, clocks) {
  const within = (n) => worstCost((n / fps) * 1000, clocks) <= SNAP_LIMIT;
  if (within(count)) return count;
  for (let step = 1; step <= count; step++) {
    if (count + step <= count * 2 && within(count + step)) return count + step;
    if (count - step >= Math.round(count * 0.5) && within(count - step)) return count - step;
  }
  return null;
}
const describeSnap = (c) => (c.aperiodic ? `${c.name} (never repeats)` : c.lost !== undefined ? `${c.name} held (it moves ${(c.lost * 100).toFixed(1)}% of a cycle in the loop)` : `${c.name} ${c.change >= 0 ? "+" : ""}${(c.change * 100).toFixed(0)}%`);

/** Give the page a turn between frames, so a long render keeps its progress line moving and the tab responsive. */
const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Render a seamless loop of about `seconds` of wall time at `fps`, the day either held at the current time or
 * walked once round, and hand each finished frame to `onFrame` in order. Every periodic clock is snapped to whole
 * cycles over the loop; "auto" first moves the length, between half and twice the request, to where that snap
 * costs least, and cross-fades the tail into the head only when no length nearby snaps cleanly. `onStart` hears the
 * frame count and size before the first frame is drawn. Returns a note saying what was done.
 */
async function renderLoop({ width, seconds, fps, day, seam }, { onStart, onFrame, onProgress }) {
  const clocks = loopClocks();
  let count = Math.max(2, Math.round(seconds * fps));
  if (seam === "auto") count = bestCount(count, fps, clocks) ?? count; // the nearest length that snaps, or the asked one faded
  const ms = (count / fps) * 1000;
  const worst = snapChanges(ms, clocks)[0];
  const snap = seam === "snap" || (seam === "auto" && (!worst || worst.cost <= SNAP_LIMIT));
  const fadeFrames = snap ? 0 : Math.min(count - 1, Math.max(2, Math.round(fps * 1.5)));
  const total = count + fadeFrames;
  const ffx = currentFfx();
  const base = state.screen ? state.screen.since + (ffx?.f.EffectFadeInMs || 0) : performance.now(); // past the fade-in
  const start = state.time; // the live clock may run on while the frames render
  await onStart?.({ count, width, height: viewHeight(width) });
  let drawn = 0;
  const draw = async (i) => {
    onProgress?.(++drawn, total);
    await yieldToPage();
    const phase = i / count;
    LOOP = { ms, phase, snap };
    const time = day === "cycle" ? (start + phase * DAY) % DAY : start;
    return renderView(width, time, base + phase * ms);
  };
  try {
    // the frames past the loop's end are drawn first, because the head fades into them and each head frame is handed
    // on as soon as it is drawn; a frame is a function of its index alone, so the order changes nothing in the picture
    const tails = [];
    for (let i = count; i < total; i++) tails.push(await draw(i));
    for (let i = 0; i < count; i++) {
      const picture = await draw(i);
      if (i < fadeFrames) {
        const w = i / fadeFrames, head = picture.rgba, tail = tails[i].rgba;
        for (let k = 0; k < head.length; k++) head[k] = tail[k] * (1 - w) + head[k] * w;
      }
      await onFrame(picture, i);
    }
  } finally {
    LOOP = null;
  }
  return snap
    ? `${(ms / 1000).toFixed(1)} s, ${count} frames, every clock snapped to whole cycles` + (worst ? `; worst: ${describeSnap(worst)}` : "")
    : `${(ms / 1000).toFixed(1)} s, ${count} frames, seam cross-faded over ${(fadeFrames / fps).toFixed(1)} s (${worst.aperiodic ? `the ${worst.name} never repeats` : `no length nearby snaps cleanly; closest would leave ${describeSnap(worst)}`})`;
}

const GIF_MEMORY = 2 ** 30; // gifski holds every frame at once, twice over while it encodes; past this a tab can run out

/**
 * Render a loop and encode it in the page, a GIF through gifski or an mp4 or webm through the browser's video
 * encoder (`encode.js`). `onProgress` hears the render, then the encode. Returns the file, its name and what the
 * seam did.
 */
async function exportLoop(options, onProgress = () => {}) {
  const format = options.format ?? "gif";
  const quality = options.quality ?? 80;
  const name = `${stem()}_loop_${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.${format}`;
  let encoder = null;
  try {
    const note = await renderLoop(options, {
      onStart: async ({ count, width, height }) => {
        const bytes = count * width * height * 4;
        if (format === "gif" && bytes > GIF_MEMORY) {
          throw new Error(`a gif of ${count} frames at ${width} by ${height} needs ${(bytes / 2 ** 30).toFixed(1)} GB while it encodes; lower the width or the seconds, or save a video`);
        }
        encoder = format === "gif"
          ? gifEncoder({ count, width, height, fps: options.fps, quality })
          : await videoEncoder({ format, width, height, fps: options.fps, quality });
      },
      onFrame: (picture, i) => encoder.add(picture, i),
      onProgress: (i, n) => onProgress(`drawing frame ${i} of ${n}`),
    });
    onProgress(`encoding the ${format}`);
    const blob = await encoder.finish();
    return { blob, name, note, size: blob.size };
  } catch (error) {
    await encoder?.cancel();
    throw error;
  }
}

// frame
let lastL = null, lastSun = null, lastMoon = null;
/** Push the light state, the celestial positions and every model track for the current time. */
function updateScene(nowMs, time = state.time) {
  const param = state.light.params[state.paramId];
  const L = evalLight(param, time);
  const sunDir = sunDirection(param, time);
  const moonDir = skyVector(MOON_PHI, MOON_THETA, time);
  lastL = L; lastSun = sunDir; lastMoon = moonDir;
  for (const m of [cone.material, fogCone.material]) {
    const u = m.uniforms;
    [L.top, L.middle, L.band1, L.band2, L.smog, L.fog].forEach((c, i) => u.skyColor.value[i].set(c[0], c[1], c[2]));
    u.sunDir.value.copy(sunDir); u.sunFogColor.value.set(...L.sunFogColor); u.sunAngle.value = L.sunAngle; u.sunStrength.value = L.sunStrength;
  }
  const sb = state.light.skyboxes[param.skybox];
  if (sb && sb.flags & 16) { cone.material.uniforms.sunStrength.value = 0; fogCone.material.uniforms.sunStrength.value = 0; }
  // a skybox row draws the procedural clouds, stars, sun and moon only when flag 2 says to combine them;
  // a preset with no model at all is nothing but the procedural sky
  const procedural = !(sb && sb.fid) || !!(sb.flags & 2);
  const cloudsOn = state.layers.clouds && procedural && updateClouds(L, sunDir, time);
  cone.material.uniforms.cloudMap.value = cloudTexture;
  cone.material.uniforms.cloudOn.value = cloudsOn ? 1 : 0;
  fogCone.material.uniforms.cloudOn.value = 0;
  fogCone.material.uniforms.skyColor.value.forEach((v) => v.set(...L.endFog));
  fogCone.visible = state.layers.fogcone && !!(sb && sb.flags & 4);
  cone.visible = state.layers.cone;
  const daylight = clamp(sunDir.z * 4 + 0.3, 0, 1);
  const cel = state.layers.celestials && procedural;
  sunSprite.visible = cel && !(param.flags & 4) && sunDir.z > -0.15;
  sunSprite.position.copy(sunDir).multiplyScalar(1500);
  sunSprite.lookAt(0, 0, 0);
  sunSprite.material.color.setRGB(...L.sun);
  sunSprite.material.opacity = clamp((sunDir.z + 0.15) * 6, 0, 1);
  moonSprite.visible = cel && !(param.flags & 8) && moonDir.z > -0.1;
  moonSprite.position.copy(moonDir).multiplyScalar(1500);
  moonSprite.lookAt(0, 0, 0);
  moonSprite.material.opacity = clamp((moonDir.z + 0.1) * 5, 0, 1) * (1 - daylight * 0.6);
  stars.visible = cel && !(param.flags & 16) && daylight < 0.98;
  stars.material.opacity = (1 - daylight) * 0.9;
  bodyLayer.mesh.visible = cel && !!bodyLayer.row;
  bodyLayer.update(nowMs, daylight);
  ground.visible = state.layers.ground;
  ground.material.color.setRGB(L.endFog[0] * 0.55, L.endFog[1] * 0.55, L.endFog[2] * 0.55);
  if (state.skybox) {
    state.skybox.root.visible = state.layers.model;
    if (state.layers.model) state.skybox.update(time / DAY, nowMs);
  }
  if (state.celestial) {
    state.celestial.root.visible = state.layers.celestialModel;
    if (state.layers.celestialModel) state.celestial.update(time / DAY, nowMs);
  }
  // the colour-grading LUTs of the two stops around the time, blended by the same k as the colours
  if (state.layers.neutral) {
    for (const o of [cone, fogCone, sunSprite, moonSprite, stars, ground, bodyLayer.mesh]) o.visible = false;
    if (state.skybox) state.skybox.root.visible = false;
    if (state.celestial) state.celestial.root.visible = false;
  }
  backdrop.visible = state.layers.neutral;
  const on = state.layers.lut && !state.layers.neutral;
  for (const u of [postQuad.material.uniforms, panoQuad.material.uniforms]) {
    u.lutA.value = L.lutA ? lutTexture(L.lutA) : null; u.lutOnA.value = on && L.lutA ? 1 : 0;
    u.lutB.value = L.lutB ? lutTexture(L.lutB) : null; u.lutOnB.value = on && L.lutB ? 1 : 0;
    u.lutK.value = L.k;
  }
  panoQuad.material.uniforms.yaw0.value = LOOK.yaw;
}

let lastMs = performance.now();
let paused = false; // a batch render holds the loop still while it draws its own frames
function frame(nowMs) {
  const dt = Math.min(0.25, (nowMs - lastMs) / 1000); lastMs = nowMs;
  if (paused) { requestAnimationFrame(frame); return; }
  if (state.playing) state.time = (state.time + dt * state.speed * 2) % DAY;
  const param = state.light?.params[state.paramId];
  if (!param) {
    // nothing to draw yet, but the tables may be on their way, and the page should say so
    emit("waiting", { loading: state.loading, error: state.error });
    requestAnimationFrame(frame);
    return;
  }
  try {
    updateScene(nowMs);
  } catch (e) {
    // keep the loop alive: a preset or effect that fails to update must not freeze the clock for every later one
    state.error = `the scene could not be updated: ${e.message}`;
    if (!frame.failed) console.error(e);
    frame.failed = true;
    requestAnimationFrame(frame);
    return;
  }
  frame.failed = false;
  const L = lastL, sunDir = lastSun, moonDir = lastMoon;
  const sb = state.light.skyboxes[param.skybox];

  aimCamera();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  // a dense screen gets its own pixels, up to two to a CSS pixel, or a phone draws the sky soft
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) renderer.setSize(w, h, false);
  const dw = Math.round(w * ratio), dh = Math.round(h * ratio);
  viewTarget = sized(viewTarget, dw, dh); postQuad.material.uniforms.view.value = viewTarget.texture;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setRenderTarget(null);
  renderer.clear();
  updateScreenUniforms(nowMs, dw, dh);
  if (state.pano) {
    if (!LOOP) sizeCube(0); // back to the page's own cube once an export is done, and not between a loop's frames
    cubeCam.position.set(0, 0, 0);
    cubeCam.update(renderer, scene);
    renderer.setRenderTarget(null);
    // a canvas narrower than the strip shows a window of the turn, exactly as much of it as keeps the map conformal
    // at that shape; a wider one letterboxes the sides, since a strip wider than the turn would repeat it
    const span = Math.min(1, w / h / PANO_ASPECT);
    panoQuad.material.uniforms.span.value = span;
    const pw = span < 1 ? w : Math.round(h * PANO_ASPECT);
    renderer.setViewport((w - pw) / 2, 0, pw, h);
    renderer.render(panoScene, panoCam);
    renderer.setViewport(0, 0, w, h);
  } else {
    renderer.setRenderTarget(viewTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    screenPass(dw, dh, () => renderer.render(postScene, postCam));
  }
  const loading = state.loading || (texPending ? `${texTotal - texPending} of ${texTotal} textures` : "");
  emit("frame", { time: state.time, playing: state.playing, loading, error: state.error, light: L, sun: sunDir, moon: moonDir, param, skybox: sb });
  requestAnimationFrame(frame);
}

// the surface the interface uses; nothing above this line knows the interface exists
const listeners = new Map();
const failures = new Map();
/**
 * Tell every listener of an event. A listener that keeps throwing is dropped after a few tries: a frame listener
 * is called sixty times a second, and one that fails would otherwise fill the console faster than it can be read.
 */
function emit(event, detail) {
  for (const fn of listeners.get(event) ?? []) {
    if ((failures.get(fn) ?? 0) > 4) continue;
    try {
      fn(detail);
      failures.delete(fn);
    } catch (e) {
      const count = (failures.get(fn) ?? 0) + 1;
      failures.set(fn, count);
      if (count <= 4) console.error(`a ${event} listener failed`, e);
      else console.error(`a ${event} listener failed five times and will not be called again`, e);
    }
  }
}

/**
 * Start the engine: read the roster, load a build's tables and a preset, and run the frame loop. `want` may name
 * a build, a preset, a time in half-minutes, a screen effect, a yaw in degrees and whether to open in perspective.
 */
async function boot(want = {}) {
  requestAnimationFrame(frame); // running before anything has loaded, so the wait is shown rather than a blank page
  if (want.time !== undefined) state.time = want.time;
  if (want.yaw !== undefined) LOOK.yaw = (want.yaw * Math.PI) / 180;
  if (want.view === "look") state.pano = false;
  try {
    state.loading = "loading the list of builds";
    const res = await fetch("./data/versions/index.json");
    if (!res.ok) throw new Error(`the list of builds did not load (${res.status})`);
    state.builds = await res.json();
    const build = want.build && state.builds.some((b) => b.build === want.build) ? want.build : DEFAULT_BUILD;
    await loadBuild(build, want.param ?? 1952);
    if (want.screen) {
      const spells = state.light.screenSpells || {};
      await applyScreen(want.screen, Number(Object.keys(spells).find((sp) => spells[sp] === want.screen)) || null);
    }
  } catch (e) {
    state.loading = "";
    state.error = e.message;
  }
  return state;
}

/** The engine, as the interface sees it. */
export const Sky = {
  state, LOOK, camera, canvas, DAY, DEFAULT_BUILD, PANO_ASPECT,
  boot, loadBuild, loadParam, applyScreen, clearScreen, chooseBody, swapSkybox,
  evalLight, sunDirection, moonDirection: (time) => skyVector(MOON_PHI, MOON_THETA, time),
  hex, rgb,
  renderView, renderStrip, renderLook, renderLoop, exportLoop, toPng, stem, loopClocks,
  setFov: (deg) => { camera.fov = clamp(deg, 20, 120); },
  fov: () => camera.fov,
  panoSpan: () => panoQuad.material.uniforms.span.value,
  pause: (on) => { paused = on; },
  pending: () => ({ texPending, texTotal, loading: state.loading }),
  on(event, fn) {
    listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    return () => listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
  },
};
