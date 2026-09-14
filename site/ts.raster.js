// ts/light.ts
var DAY = 2880;
function rgb(n) {
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
var mix3 = (a, b, k) => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k
];
function around(ramp, t) {
  if (ramp.length === 1) return [ramp[0], ramp[0], 0];
  const i = ramp.findIndex((s) => s.time > t);
  let a, b, ta, tb;
  if (i === 0) {
    [a, b] = [ramp[ramp.length - 1], ramp[0]];
    [ta, tb] = [a.time - DAY, b.time];
  } else if (i === -1) {
    [a, b] = [ramp[ramp.length - 1], ramp[0]];
    [ta, tb] = [a.time, b.time + DAY];
  } else {
    [a, b] = [ramp[i - 1], ramp[i]];
    [ta, tb] = [a.time, b.time];
  }
  const k = tb === ta ? 0 : Math.min(Math.max((t - ta) / (tb - ta), 0), 1);
  return [a, b, k];
}
var BLACK_STOP = {
  time: 0,
  SkyTopColor: 0,
  SkyMiddleColor: 0,
  SkyBand1Color: 0,
  SkyBand2Color: 0,
  SkySmogColor: 0,
  SkyFogColor: 0,
  EndFogColor: 0,
  SunColor: 0,
  SunFogColor: 0,
  SunFogAngle: 1,
  SunFogStrength: 0,
  CloudDensity: 0,
  CloudSunColor: 0,
  CloudEmissiveColor: 0,
  CloudLayer1AmbientColor: 0,
  CloudLayer2AmbientColor: 0
};
function lightAt(param, t) {
  const ramp = param.ramp.length ? [...param.ramp].sort((x, y) => x.time - y.time) : [BLACK_STOP];
  const [a, b, k] = around(ramp, t);
  const col = (f) => mix3(rgb(a[f]), rgb(b[f]), k);
  const endFog = (s) => rgb(s.EndFogColor || s.SkyFogColor);
  const angle2 = (s) => s.SunFogColor ? s.SunFogAngle : 1;
  const [aa, ab] = [angle2(a), angle2(b)];
  let sunAngle, sunStrength;
  if (aa >= 1 && ab >= 1) [sunAngle, sunStrength] = [1, 0];
  else if (aa >= 1) [sunAngle, sunStrength] = [ab, b.SunFogStrength * k];
  else if (ab >= 1) [sunAngle, sunStrength] = [aa, a.SunFogStrength * (1 - k)];
  else [sunAngle, sunStrength] = [aa + (ab - aa) * k, a.SunFogStrength + (b.SunFogStrength - a.SunFogStrength) * k];
  return {
    cone: [col("SkyTopColor"), col("SkyMiddleColor"), col("SkyBand1Color"), col("SkyBand2Color"), col("SkySmogColor"), col("SkyFogColor")],
    endFog: mix3(endFog(a), endFog(b), k),
    sun: col("SunColor"),
    sunFog: col("SunFogColor"),
    sunAngle,
    sunStrength,
    clouds: {
      density: a.CloudDensity + (b.CloudDensity - a.CloudDensity) * k,
      sun: col("CloudSunColor"),
      layer1: col("CloudLayer1AmbientColor"),
      layer2: col("CloudLayer2AmbientColor"),
      emissive: col("CloudEmissiveColor")
    }
  };
}
var SUN_PHI = [[0.25, 1.7453293], [0.49652779, 0.08726646], [0.5, 0.08726646], [0.50347221, 0.08726646], [0.79166669, 1.7453293]];
var MOON_PHI = [[0, 0.61086524], [0.0034722222, 0.61086524], [0.16666667, 1.7453293], [0.89583331, 1.7453293], [0.99652779, 0.61086524]];
var THETA = 0.78539819;
function interp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return tab[tab.length - 1][1];
}
function vector(tab, t) {
  const phi = interp(tab, t / DAY);
  return [Math.sin(phi) * Math.cos(THETA), Math.sin(phi) * Math.sin(THETA), Math.cos(phi)];
}
var sunDirection = (t) => vector(SUN_PHI, t);
var moonDirection = (t) => vector(MOON_PHI, t);

// ts/m2.ts
var identity = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a, b) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return out;
}
var chain = (...ms) => ms.reduce(multiply);
function translation(v) {
  const m = identity();
  [m[3], m[7], m[11]] = [v[0], v[1], v[2]];
  return m;
}
function scaling(v) {
  const m = identity();
  [m[0], m[5], m[10]] = [v[0], v[1], v[2]];
  return m;
}
function rotation([x, y, z, w]) {
  return new Float64Array([
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    0,
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    0,
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1
  ]);
}
function sample(track, animMs, nowMs, loops, blend2, dflt) {
  if (!track) return dflt;
  const seq = track.seqs[0];
  let t;
  if (track.gseq >= 0) {
    const len = loops[track.gseq] ?? 0;
    t = len > 0 ? nowMs % len : 0;
  } else t = animMs;
  if (!seq || seq.t.length === 0) return dflt;
  const { t: ts, v: vs } = seq;
  if (t <= ts[0] || ts.length === 1) return vs[0];
  if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const k = track.interp === 0 ? 0 : (t - ts[lo]) / (ts[hi] - ts[lo]);
  return blend2(vs[lo], vs[hi], k);
}
var lerp = (a, b, k) => a + (b - a) * k;
var lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
function nlerp(a, b, k) {
  const dot2 = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot2 < 0 ? -1 : 1;
  const q = [lerp(a[0], s * b[0], k), lerp(a[1], s * b[1], k), lerp(a[2], s * b[2], k), lerp(a[3], s * b[3], k)];
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
var SHADER_TABLE = [[12, 3], [13, 3], [14, 3], [15, 6], [16, 3], [13, 7], [16, 7], [17, 3], [18, 3], [19, 6], [20, 7], [21, 3], [22, 3], [23, 3], [23, 7], [20, 2], [24, 3], [25, 6], [26, 0], [33, 9], [27, 11], [6, 12], [28, 2], [29, 7], [25, 11], [33, 13], [30, 14], [31, 2], [32, 14], [34, 7], [35, 15], [35, 16], [0, 0], [7, 12], [1, 9], [36, 12]];
function pixelShader(shader, n) {
  if (shader & 32768) return SHADER_TABLE[shader & 32767]?.[0] ?? 1;
  if (n === 1) return shader & 112 ? 1 : 0;
  const low = shader & 7;
  return shader & 112 ? [11, 6, 6, 8, 7, 6, 9, 10][low] : [5, 2, 2, 13, 3, 2, 4, 14][low];
}
function vertexShader(shader, n) {
  if (shader & 32768) return SHADER_TABLE[shader & 32767]?.[1] ?? 0;
  if (n === 1) return shader & 128 ? 1 : shader & 16384 ? 10 : 0;
  if (!(shader & 128)) return shader & 8 ? 3 : shader & 16384 ? 2 : 7;
  return shader & 8 ? 5 : 4;
}
function evaluate(m, skyboxFlags, time, nowMs) {
  const dur = m.sequences[0]?.duration ?? 1;
  const animMs = skyboxFlags & 1 ? time / DAY * dur : dur > 0 ? nowMs % dur : 0;
  const loops = m.globalLoops;
  const bones = [];
  for (const bone of m.bones) {
    const tr = sample(bone.translation, animMs, nowMs, loops, lerp3, [0, 0, 0]);
    const q = sample(bone.rotation, animMs, nowMs, loops, nlerp, [0, 0, 0, 1]);
    const sc = sample(bone.scale, animMs, nowMs, loops, lerp3, [1, 1, 1]);
    const local = chain(translation(bone.pivot), translation(tr), rotation(q), scaling(sc), translation(bone.pivot.map((p) => -p)));
    bones.push(bone.parent >= 0 ? multiply(bones[bone.parent], local) : local);
  }
  const texMats = m.textureTransforms.map((x) => {
    const tr = sample(x.translation, animMs, nowMs, loops, lerp3, [0, 0, 0]);
    const q = sample(x.rotation, animMs, nowMs, loops, nlerp, [0, 0, 0, 1]);
    const sc = sample(x.scale, animMs, nowMs, loops, lerp3, [1, 1, 1]);
    const p = translation([0.5, 0.5, 0]), np = translation([-0.5, -0.5, 0]);
    return chain(translation(tr), p, rotation(q), np, p, scaling(sc), np);
  });
  const colors = m.colors.map((c) => ({
    rgb: sample(c.color, animMs, nowMs, loops, lerp3, [1, 1, 1]),
    a: sample(c.alpha, animMs, nowMs, loops, lerp, 1)
  }));
  const weights = m.textureWeights.map((w) => sample(w, animMs, nowMs, loops, lerp, 1));
  const n = m.positions.length / 3;
  const positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    for (let k = 0; k < 4; k++) {
      const w = m.boneWeights[i * 4 + k];
      if (w === 0) continue;
      const b = bones[Math.min(m.boneIndices[i * 4 + k], bones.length - 1)];
      positions[i * 3] += w * (b[0] * x + b[1] * y + b[2] * z + b[3]);
      positions[i * 3 + 1] += w * (b[4] * x + b[5] * y + b[6] * z + b[7]);
      positions[i * 3 + 2] += w * (b[8] * x + b[9] * y + b[10] * z + b[11]);
    }
  }
  const transformed = (uv, matIndex) => {
    const out = new Float64Array(uv);
    if (matIndex < 0 || matIndex >= texMats.length) return out;
    const t = texMats[matIndex];
    for (let i = 0; i < n; i++) {
      const [u, v] = [uv[i * 2], uv[i * 2 + 1]];
      out[i * 2] = t[0] * u + t[1] * v + t[3];
      out[i * 2 + 1] = t[4] * u + t[5] * v + t[7];
    }
    return out;
  };
  const batches = [];
  for (const b of m.skin.batches) {
    const sub = m.skin.submeshes[b.submesh];
    const mat = m.materials[b.material];
    const textureIds = [];
    for (let k = 0; k < b.textureCount; k++) textureIds.push(m.textureLookup[b.textureCombo + k]);
    if (textureIds.length === 0 || m.textures[textureIds[0]].fid === 0) continue;
    const xf = [0, 1].map((k) => m.textureTransformLookup[b.transformCombo + k] ?? -1);
    const w = [0, 1, 2].map((k) => {
      const i = m.transparencyLookup[b.weightCombo + k] ?? -1;
      return i >= 0 && i < weights.length ? weights[i] : 1;
    });
    const col = b.color !== 65535 && b.color < colors.length ? colors[b.color] : { rgb: [1, 1, 1], a: 1 };
    const opacity = col.a * (b.textureCount && !(b.flags & 64) ? w[0] : 1);
    if (opacity <= 1e-3) continue;
    const vs = vertexShader(b.shader, b.textureCount);
    const ta = transformed(m.uv0, xf[0]), tb = transformed(m.uv1, xf[1]);
    const sc = sub.sortCenter ?? [0, 0, 0];
    batches.push({
      index: batches.length,
      sortDistance: Math.hypot(sc[0], sc[1], sc[2]),
      batch: b,
      pixel: pixelShader(b.shader, b.textureCount),
      blend: mat.blend,
      alphaTest: mat.blend === 1 ? 0.5 : mat.blend === 0 ? 0 : 1 / 255,
      textureIds,
      weights: w,
      color: col.rgb,
      opacity,
      tris: Uint32Array.from(m.skin.indices.slice(sub.indexStart, sub.indexStart + sub.indexCount)),
      uvA: vs === 10 ? tb : ta,
      uvB: vs === 2 || vs === 14 || vs === 15 ? tb : ta
    });
  }
  batches.sort((a, b) => a.batch.priority - b.batch.priority || b.sortDistance - a.sortDistance || a.index - b.index);
  return { positions, batches };
}

// ts/raster.ts
var PROJECTIONS = ["mercator", "stereo", "equirect", "look"];
var FACES = [
  [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],
  [[0, 0, -1], [0, -1, 0], [1, 0, 0]]
];
var CONE_ELEV = [Math.PI / 2, Math.atan2(0.1391, 0.4903), Math.atan2(0.0849, 0.568), Math.atan2(0.0242, 0.6413), Math.atan2(0.0135, 0.6531), Math.atan2(-5e-3, 0.6875), -Math.PI / 2];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function memoTextures(load) {
  const cache = /* @__PURE__ */ new Map();
  return (fid, flags) => {
    const key = `${fid}:${flags}`;
    let p = cache.get(key);
    if (!p) {
      p = load(fid).then((t) => ({ ...t, wrapX: (flags & 1) !== 0, wrapY: (flags & 2) !== 0 }));
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  };
}
function sceneOf(tables, paramId) {
  const param = tables.params[String(paramId)];
  if (!param) throw new Error(`no LightParams ${paramId}`);
  return { param, skybox: tables.skyboxes[String(param.skybox)] };
}
function coneFace(size, face, light, sun) {
  const [fwd, right, up] = FACES[face];
  const out = new Float32Array(size * size * 3);
  const cols = [...light.cone, light.cone[5]];
  for (let py = 0; py < size; py++) {
    const sy = -((py + 0.5) / size * 2 - 1);
    for (let px2 = 0; px2 < size; px2++) {
      const sx = (px2 + 0.5) / size * 2 - 1;
      let dx = fwd[0] + sx * right[0] + sy * up[0], dy = fwd[1] + sx * right[1] + sy * up[1], dz = fwd[2] + sx * right[2] + sy * up[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= len;
      dy /= len;
      dz /= len;
      const elev = Math.asin(Math.max(-1, Math.min(1, dz)));
      let i = 0;
      while (i < 5 && elev <= CONE_ELEV[i + 1]) i++;
      const k = Math.min(Math.max((CONE_ELEV[i] - elev) / (CONE_ELEV[i] - CONE_ELEV[i + 1]), 0), 1);
      let r = cols[i][0] * (1 - k) + cols[i + 1][0] * k;
      let g = cols[i][1] * (1 - k) + cols[i + 1][1] * k;
      let b = cols[i][2] * (1 - k) + cols[i + 1][2] * k;
      if (light.sunAngle < 1) {
        let nd = Math.max(0, Math.min(1, dx * sun[0] + dy * sun[1] + dz * sun[2] - light.sunAngle)) / (1 - light.sunAngle);
        nd = Math.min(1, nd * nd * nd * light.sunStrength);
        r += (light.sunFog[0] - r) * nd;
        g += (light.sunFog[1] - g) * nd;
        b += (light.sunFog[2] - b) * nd;
      }
      const o = (py * size + px2) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}
function texel(t, u, v, out) {
  let x = Math.floor(u * t.width), y = Math.floor(v * t.height);
  x = t.wrapX ? (x % t.width + t.width) % t.width : Math.min(Math.max(x, 0), t.width - 1);
  y = t.wrapY ? (y % t.height + t.height) % t.height : Math.min(Math.max(y, 0), t.height - 1);
  const o = (y * t.width + x) * 4;
  out[0] = t.rgba[o];
  out[1] = t.rgba[o + 1];
  out[2] = t.rgba[o + 2];
  out[3] = t.rgba[o + 3];
}
var t1 = new Float32Array(4);
var t2 = new Float32Array(4);
var t3 = new Float32Array(4);
var t4 = new Float32Array(4);
var px = new Float32Array(4);
var set = (r, g, b, a) => {
  px[0] = r;
  px[1] = g;
  px[2] = b;
  px[3] = a;
};
function combine(ps, w) {
  switch (ps) {
    case 0:
      return set(t1[0], t1[1], t1[2], 1);
    case 2:
      return set(t1[0] * t2[0], t1[1] * t2[1], t1[2] * t2[2], t2[3]);
    case 3:
      return set(t1[0] * t2[0] * 2, t1[1] * t2[1] * 2, t1[2] * t2[2] * 2, t2[3]);
    case 4:
      return set(t1[0] * t2[0] * 2, t1[1] * t2[1] * 2, t1[2] * t2[2] * 2, 1);
    case 5:
      return set(t1[0] * t2[0], t1[1] * t2[1], t1[2] * t2[2], 1);
    case 6:
      return set(t1[0] * t2[0], t1[1] * t2[1], t1[2] * t2[2], t1[3] * t2[3]);
    case 7:
      return set(t1[0] * t2[0] * 2, t1[1] * t2[1] * 2, t1[2] * t2[2] * 2, t1[3] * t2[3] * 2);
    case 8:
      return set(t1[0] + t2[0], t1[1] + t2[1], t1[2] + t2[2], t1[3] + t2[3]);
    case 9:
      return set(t1[0] * t2[0] * 2, t1[1] * t2[1] * 2, t1[2] * t2[2] * 2, t1[3]);
    case 10:
      return set(t1[0] + t2[0], t1[1] + t2[1], t1[2] + t2[2], t1[3]);
    case 11:
      return set(t1[0] * t2[0], t1[1] * t2[1], t1[2] * t2[2], t1[3]);
    case 12: {
      const a = t1[3];
      return set(t1[0] * t2[0] * 2 * (1 - a) + t1[0] * a, t1[1] * t2[1] * 2 * (1 - a) + t1[1] * a, t1[2] * t2[2] * 2 * (1 - a) + t1[2] * a, 1);
    }
    case 13:
      return set(t1[0] + t2[0] * t2[3], t1[1] + t2[1] * t2[3], t1[2] + t2[2] * t2[3], 1);
    case 18: {
      const a2 = t2[3], a1 = t1[3];
      const m = (i) => (t1[i] * (1 - a2) + t2[i] * a2) * (1 - a1) + t1[i] * a1;
      return set(m(0), m(1), m(2), 1);
    }
    case 22: {
      const a = t1[3];
      return set(t1[0] * t2[0] * (1 - a) + t1[0] * a, t1[1] * t2[1] * (1 - a) + t1[1] * a, t1[2] * t2[2] * (1 - a) + t1[2] * a, 1);
    }
    case 26:
    case 28: {
      const g = Math.min(Math.max(w[1], 0), 1), b = Math.min(Math.max(w[2], 0), 1);
      const m = (i) => (t1[i] * (1 - g) + t2[i] * g) * (1 - b) + t3[i] * b;
      return set(m(0), m(1), m(2), m(3) * (ps === 28 ? t4[3] : 1));
    }
    case 29: {
      const a2 = t2[3];
      return set(t1[0] * (1 - a2) + t2[0] * a2, t1[1] * (1 - a2) + t2[1] * a2, t1[2] * (1 - a2) + t2[2] * a2, 1);
    }
    default:
      return set(t1[0], t1[1], t1[2], t1[3]);
  }
}
function blend(mode, dst, src, a) {
  switch (mode) {
    case 2:
      return src * a + dst * (1 - a);
    case 3:
      return src + dst;
    case 4:
      return src * a + dst;
    case 5:
      return src * dst;
    case 6:
      return src * dst * 2;
    case 7:
      return src + dst * (1 - a);
    default:
      return src;
  }
}
function clipNear(poly, near) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.z >= near) out.push(a);
    if (a.z >= near !== b.z >= near) {
      const k = (near - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: near, u1: a.u1 + (b.u1 - a.u1) * k, v1: a.v1 + (b.v1 - a.v1) * k, u2: a.u2 + (b.u2 - a.u2) * k, v2: a.v2 + (b.v2 - a.v2) * k });
    }
  }
  return out;
}
function drawTriangle(canvas, size, a, b, c, d, tex) {
  const iza = 1 / a.z, izb = 1 / b.z, izc = 1 / c.z;
  const ax = (a.x * iza * 0.5 + 0.5) * size, ay = (0.5 - a.y * iza * 0.5) * size;
  const bx = (b.x * izb * 0.5 + 0.5) * size, by = (0.5 - b.y * izb * 0.5) * size;
  const cx = (c.x * izc * 0.5 + 0.5) * size, cy = (0.5 - c.y * izc * 0.5) * size;
  const x0 = Math.max(Math.floor(Math.min(ax, bx, cx)), 0), x1 = Math.min(Math.ceil(Math.max(ax, bx, cx)), size);
  const y0 = Math.max(Math.floor(Math.min(ay, by, cy)), 0), y1 = Math.min(Math.ceil(Math.max(ay, by, cy)), size);
  if (x1 <= x0 || y1 <= y0) return;
  const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(det) < 1e-9) return;
  const sharedUv = d.pixel === 26 || d.pixel === 28;
  for (let py = y0; py < y1; py++) {
    const yy = py + 0.5;
    for (let pxl = x0; pxl < x1; pxl++) {
      const xx = pxl + 0.5;
      const l1 = ((bx - xx) * (cy - yy) - (cx - xx) * (by - yy)) / det;
      const l2 = ((cx - xx) * (ay - yy) - (ax - xx) * (cy - yy)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const w = l1 * iza + l2 * izb + l3 * izc;
      const uA = (l1 * a.u1 * iza + l2 * b.u1 * izb + l3 * c.u1 * izc) / w;
      const vA = (l1 * a.v1 * iza + l2 * b.v1 * izb + l3 * c.v1 * izc) / w;
      const uB = (l1 * a.u2 * iza + l2 * b.u2 * izb + l3 * c.u2 * izc) / w;
      const vB = (l1 * a.v2 * iza + l2 * b.v2 * izb + l3 * c.v2 * izc) / w;
      texel(tex[0], uA, vA, t1);
      if (tex.length > 1) texel(tex[1], sharedUv ? uA : uB, sharedUv ? vA : vB, t2);
      else t2.set(t1);
      if (tex.length > 2) texel(tex[2], uA, vA, t3);
      else t3.set(t1);
      if (tex.length > 3) texel(tex[3], uB, vB, t4);
      else t4.set(t1);
      combine(d.pixel, d.weights);
      const alpha = px[3] * d.opacity;
      if (alpha < d.alphaTest) continue;
      const o = (py * size + pxl) * 3;
      for (let ch = 0; ch < 3; ch++) {
        canvas[o + ch] = Math.min(4, Math.max(0, blend(d.blend, canvas[o + ch], px[ch] * d.color[ch], alpha)));
      }
    }
  }
}
function drawModel(faces, size, positions, batches, textures) {
  const batchTextures = batches.map((d) => d.textureIds.map((i) => textures[i]));
  for (let f = 0; f < 6; f++) {
    const [fwd, right, up] = FACES[f];
    const canvas = faces[f];
    batches.forEach((d, bi) => {
      const tex = batchTextures[bi];
      for (let i = 0; i < d.tris.length; i += 3) {
        const poly = [];
        let behind = false;
        for (let k = 0; k < 3; k++) {
          const vi = d.tris[i + k];
          const p = [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];
          const v = { x: dot(p, right), y: dot(p, up), z: dot(p, fwd), u1: d.uvA[vi * 2], v1: d.uvA[vi * 2 + 1], u2: d.uvB[vi * 2], v2: d.uvB[vi * 2 + 1] };
          if (v.z < 0.05) behind = true;
          poly.push(v);
        }
        const clipped = behind ? clipNear(poly, 0.05) : poly;
        for (let j = 1; j + 1 < clipped.length; j++) drawTriangle(canvas, size, clipped[0], clipped[j], clipped[j + 1], d, tex);
      }
    });
  }
}
function sampleCube(faces, size, d, out) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  let f;
  if (ax >= ay && ax >= az) f = d[0] > 0 ? 0 : 1;
  else if (ay >= az) f = d[1] > 0 ? 2 : 3;
  else f = d[2] > 0 ? 4 : 5;
  const [fwd, right, up] = FACES[f];
  const depth = dot(d, fwd);
  const sx = dot(d, right) / depth, sy = dot(d, up) / depth;
  const pxl = Math.min(Math.max(Math.floor((sx * 0.5 + 0.5) * size), 0), size - 1);
  const py = Math.min(Math.max(Math.floor((0.5 - sy * 0.5) * size), 0), size - 1);
  const o = (py * size + pxl) * 3;
  out[0] = faces[f][o];
  out[1] = faces[f][o + 1];
  out[2] = faces[f][o + 2];
}
var MERC_LO = -4 * Math.PI / 180;
var MERC_HI = 64 * Math.PI / 180;
var LOOK_FOV = 73.74 * Math.PI / 180;
var LOOK_ASPECT = 16 / 9;
var mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat / 2));
var MERC_Y0 = mercY(MERC_LO);
var MERC_Y1 = mercY(MERC_HI);
function previewSize(projection, size) {
  if (projection === "mercator") {
    const w = size * 4;
    return [w, Math.round(w * (MERC_Y1 - MERC_Y0) / (2 * Math.PI))];
  }
  if (projection === "equirect") return [size * 2, size];
  if (projection === "look") return [size * 4, Math.round(size * 4 / LOOK_ASPECT)];
  return [size * 2, size * 2];
}
function directionOf(projection, yaw, pitch) {
  const spherical = (lon, lat, out) => {
    out[0] = Math.cos(lat) * Math.cos(lon);
    out[1] = Math.cos(lat) * Math.sin(lon);
    out[2] = Math.sin(lat);
  };
  switch (projection) {
    case "equirect":
      return (u, v, out) => spherical((u - 0.5) * 2 * Math.PI + yaw, (0.5 - v) * Math.PI, out);
    case "mercator":
      return (u, v, out) => spherical((u - 0.5) * 2 * Math.PI + yaw, 2 * Math.atan(Math.exp(MERC_Y1 + (MERC_Y0 - MERC_Y1) * v)) - Math.PI / 2, out);
    case "look": {
      const tanV = Math.tan(LOOK_FOV / 2), cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const fwd = [cy * cp, sy * cp, sp], right = [sy, -cy, 0], up = [-cy * sp, -sy * sp, cp];
      return (u, v, out) => {
        const x = (u - 0.5) * 2 * tanV * LOOK_ASPECT, y = (0.5 - v) * 2 * tanV;
        const dx = fwd[0] + x * right[0] + y * up[0], dy = fwd[1] + x * right[1] + y * up[1], dz = fwd[2] + x * right[2] + y * up[2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        out[0] = dx / len;
        out[1] = dy / len;
        out[2] = dz / len;
      };
    }
    case "stereo":
      return (u, v, out) => {
        const x = (u - 0.5) * 2, y = (0.5 - v) * 2;
        const r = Math.hypot(x, y) / 0.9 * 2;
        spherical(Math.atan2(x, y) + yaw, Math.PI / 2 - 2 * Math.atan(r / 2), out);
      };
  }
}
function lattice(x, y, period) {
  const xi = (x % period + period) % period, yi = (y % period + period) % period;
  let h = xi * 374761393 + yi * 668265263 + period * 1013904223 >>> 0;
  h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function cloudNoise(u, v) {
  let sum = 0, amp = 1, total = 0;
  for (let o = 0, period = 4; o < 5; o++, period *= 2, amp *= 0.5) {
    const fx = u * period, fy = v * period;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = lattice(x0, y0, period), b = lattice(x0 + 1, y0, period), c = lattice(x0, y0 + 1, period), d = lattice(x0 + 1, y0 + 1, period);
    sum += ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * amp;
    total += amp;
  }
  return sum / total;
}
function cloudFace(canvas, size, face, clouds, sunDir, time) {
  if (clouds.density <= 1e-3) return;
  const [fwd, right, up] = FACES[face];
  const layers = [[1, 0.055, 6e-5, clouds.layer2], [1.6, 0.03, 4e-5, clouds.layer1]];
  const cover = 0.72 - clouds.density * 0.3;
  for (let py = 0; py < size; py++) {
    const sy = -((py + 0.5) / size * 2 - 1);
    for (let px2 = 0; px2 < size; px2++) {
      const sx = (px2 + 0.5) / size * 2 - 1;
      const dx = fwd[0] + sx * right[0] + sy * up[0], dy = fwd[1] + sx * right[1] + sy * up[1], dz = fwd[2] + sx * right[2] + sy * up[2];
      const len = Math.hypot(dx, dy, dz);
      const z = dz / len;
      if (z <= 0.02) continue;
      const horizon = Math.min(1, (z - 0.02) / 0.18);
      const sunK = Math.pow(Math.max(0, (dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2]) / len), 4);
      const o = (py * size + px2) * 3;
      for (const [height, scale, speed, ambient] of layers) {
        const t = height / z;
        const u = dx / len * t * scale + time * speed, v = dy / len * t * scale + time * speed * 0.6;
        const nval = cloudNoise(u, v);
        let a = Math.min(1, Math.max(0, (nval - cover) / 0.15));
        a = a * a * (3 - 2 * a) * horizon;
        if (a <= 2e-3) continue;
        const lit = Math.min(1, Math.max(0, (nval - cover) / 0.25)) * (0.55 + 0.45 * sunK);
        for (let ch = 0; ch < 3; ch++) {
          const c = ambient[ch] * (1 - lit) + clouds.sun[ch] * lit + clouds.emissive[ch];
          canvas[o + ch] = canvas[o + ch] * (1 - a) + c * a;
        }
      }
    }
  }
}
async function renderPreview(input) {
  const { param, skybox, model, time, size, projection } = input;
  const light = lightAt(param, time);
  const sun = sunDirection(time), moon = moonDirection(time);
  const sflags = skybox?.flags ?? 0;
  const procedural = !model || (sflags & 2) !== 0;
  const yaw = (input.yaw ?? 0) * Math.PI / 180;
  const faces = FACES.map((_, f) => coneFace(size, f, light, sun));
  if (input.clouds !== false && procedural) faces.forEach((canvas, f) => cloudFace(canvas, size, f, light.clouds, sun, time));
  if (model && skybox) {
    const textures = await Promise.all(model.textures.map((t) => t.fid ? input.textures(t.fid, t.flags) : Promise.resolve(blank())));
    const ev = evaluate(model, sflags, time, 0);
    drawModel(faces, size, ev.positions, ev.batches, textures);
  }
  const [w, h] = previewSize(projection, size);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const c = new Float32Array(3);
  const d = [0, 0, 0];
  const direction = directionOf(projection, yaw, (input.pitch ?? 0) * Math.PI / 180);
  const celestials = procedural && input.celestials !== false;
  const hideSun = !celestials || (param.flags & 4) !== 0 || sun[2] <= -0.15;
  const hideMoon = !celestials || (param.flags & 8) !== 0 || moon[2] <= -0.1;
  for (let py = 0; py < h; py++) {
    for (let pxl = 0; pxl < w; pxl++) {
      direction((pxl + 0.5) / w, (py + 0.5) / h, d);
      sampleCube(faces, size, d, c);
      const elev = Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180 / Math.PI;
      if (sflags & 4) {
        let k = Math.min(Math.max((8.5 - elev) / 8.5, 0), 1);
        k = elev < -0.4 ? 1 : k * k;
        for (let ch = 0; ch < 3; ch++) c[ch] += (light.endFog[ch] - c[ch]) * k;
      }
      if (!hideSun && dot(d, sun) > COS_SUN) {
        const k = Math.pow(Math.min(Math.max(1 - angle(d, sun) / 9, 0), 1), 2.5);
        for (let ch = 0; ch < 3; ch++) c[ch] += k * light.sun[ch] * 1.2;
      }
      if (!hideMoon && dot(d, moon) > COS_MOON) {
        const k = Math.sqrt(Math.min(Math.max(1 - angle(d, moon) / 3.5, 0), 1));
        c[0] += k * 0.765;
        c[1] += k * 0.81;
        c[2] += k * 0.9;
      }
      const o = (py * w + pxl) * 4;
      rgba[o] = c[0] * 255;
      rgba[o + 1] = c[1] * 255;
      rgba[o + 2] = c[2] * 255;
      rgba[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}
var angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
var COS_SUN = Math.cos(9 * Math.PI / 180);
var COS_MOON = Math.cos(3.5 * Math.PI / 180);
var blank = () => ({ width: 1, height: 1, rgba: new Float32Array([0, 0, 0, 0]), wrapX: false, wrapY: false });
export {
  PROJECTIONS,
  cloudNoise,
  memoTextures,
  previewSize,
  renderPreview,
  sceneOf
};
