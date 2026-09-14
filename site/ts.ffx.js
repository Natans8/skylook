// ts/ffx.ts
var FFX_SCROLL_SPEED = 0.25;
var NO_BLEND_SET = { textures: [0, 0, 0], swizzle: [0, 1, 2, 3], flags: 0, scrollU: [0, 0, 0], scrollV: [0, 0, 0], scaleU: [1, 1, 1], scaleV: [1, 1, 1], modX: [1, 1, 1, 1] };
function stageMode(flags, on, a, b) {
  if (!(flags & on)) return 0;
  if (!(flags & a)) return 1;
  return flags & b ? 3 : 2;
}
function ffxConstants(f, bs, elapsed, screen, radialSize, scroll = (rate) => rate * elapsed * FFX_SCROLL_SPEED % 1) {
  const F = f.Flags;
  const fade = f.EffectFadeInMs > 0 ? Math.min(1, elapsed * 1e3 / f.EffectFadeInMs) : 1;
  const kx = screen[0] / radialSize[0] * (1600 / screen[1]), ky = 1600 / radialSize[1];
  const anim = (i, sx, sy, w) => [scroll(bs.scrollU[i]), scroll(bs.scrollV[i]), bs.scaleU[i] * sx, w ?? bs.scaleV[i] * sy];
  return {
    gamma: [f.GammaRed, f.GammaGreen, f.GammaBlue, stageMode(F, 1, 2, 4)],
    multiply: [f.ColorMultiplyRed, f.ColorMultiplyGreen, f.ColorMultiplyBlue, stageMode(F, 8, 16, 32)],
    add: [f.ColorAdditionRed, f.ColorAdditionGreen, f.ColorAdditionBlue, stageMode(F, 64, 128, 256)],
    radialAnim: anim(0, 1, 1, fade),
    texAnim0: anim(1, kx, ky),
    texAnim1: anim(2, kx, ky),
    gammaParams: [f.MaskOffsetY, f.MaskSizeMultiplier, f.MaskPower, 0],
    multiplyParams: [f.ColorMultiplyOffsetY, f.ColorMultiplyMultiplier, f.ColorMultiplyPower, 0],
    addParams: [f.ColorAdditionOffsetY, f.ColorAdditionMultiplier, f.ColorAdditionPower, 0],
    blurParams: [f.BlurOffsetY, F & 512 ? f.BlurMultiplier : 0, f.BlurPower, 1 - f.Saturation],
    colorMod: [bs.modX[1], bs.modX[2], bs.modX[3], bs.modX[0]],
    swizzle: bs.swizzle
  };
}
function ffxTextures(f, bs) {
  return [bs.textures[0], bs.textures[1], bs.textures[2], f.OverlayTextureFileDataID];
}
function texelOffset(t, xi, yi, wrap) {
  xi = wrap ? (xi % t.width + t.width) % t.width : Math.min(Math.max(xi, 0), t.width - 1);
  yi = wrap ? (yi % t.height + t.height) % t.height : Math.min(Math.max(yi, 0), t.height - 1);
  return (yi * t.width + xi) * 4;
}
function sample(t, u, v, wrap, out) {
  const x = u * t.width - 0.5, y = v * t.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = texelOffset(t, x0, y0, wrap), b = texelOffset(t, x0 + 1, y0, wrap), c = texelOffset(t, x0, y0 + 1, wrap), d = texelOffset(t, x0 + 1, y0 + 1, wrap);
  for (let ch = 0; ch < 4; ch++) {
    const top = t.rgba[a + ch] * (1 - fx) + t.rgba[b + ch] * fx;
    const bottom = t.rgba[c + ch] * (1 - fx) + t.rgba[d + ch] * fx;
    out[ch] = top * (1 - fy) + bottom * fy;
  }
}
function stageMask(u, v, p, mode) {
  if (mode < 2) return 1;
  const dx = u - 0.5, dy = v - (0.5 + p[0]);
  let k = Math.min((dx * dx + dy * dy) * p[1], 1);
  if (mode === 3) k = 1 - k;
  return Math.pow(Math.max(k, 1e-6), p[2]);
}
var radial = new Float32Array(4);
var overlay = new Float32Array(4);
var composed = new Float32Array(4);
var texelPx = new Float32Array(4);
function applyFfx(view, k, textures) {
  const { width, height, rgba } = view;
  const [mask, radialTex, overlay0, overlay1] = textures;
  const fade = k.radialAnim[3];
  const scene = new Float32Array(3), r = new Float32Array(3);
  if (!radialTex) radial.fill(1);
  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const o = (py * width + px) * 4;
      for (let ch = 0; ch < 3; ch++) scene[ch] = rgba[o + ch] / 255;
      if (k.gamma[3] > 0) {
        const m = stageMask(u, v, k.gammaParams, k.gamma[3]) * fade;
        const g = Math.max(scene[1], 1e-6);
        for (let ch = 0; ch < 3; ch++) r[ch] = scene[ch] + (Math.pow(g, k.gamma[ch]) - scene[ch]) * m;
      } else {
        const luma = scene[0] * 0.3 + scene[1] * 0.6 + scene[2] * 0.1;
        for (let ch = 0; ch < 3; ch++) r[ch] = scene[ch] + (luma - scene[ch]) * k.blurParams[3];
      }
      if (k.multiply[3] > 0) {
        const m = stageMask(u, v, k.multiplyParams, k.multiply[3]) * fade;
        for (let ch = 0; ch < 3; ch++) r[ch] *= 1 + m * (k.multiply[ch] - 1);
      }
      if (k.add[3] > 0) {
        const m = Math.min(stageMask(u, v, k.addParams, k.add[3]) * fade, 1);
        for (let ch = 0; ch < 3; ch++) r[ch] += k.add[ch] * m;
      }
      if (radialTex) {
        const dx = u - 0.5, dy = v - 0.5;
        const fold = Math.atan2(Math.abs(dx), Math.abs(dy));
        const angle = dy >= 0 ? fold : Math.PI - fold;
        sample(radialTex, angle / Math.PI * k.radialAnim[2] + k.radialAnim[0], Math.sqrt(dx * dx + dy * dy) * k.radialAnim[2] + k.radialAnim[1], true, radial);
      }
      overlay.set(k.colorMod);
      if (overlay0) {
        sample(overlay0, u * k.texAnim0[2] + k.texAnim0[0], v * k.texAnim0[3] + k.texAnim0[1], true, texelPx);
        for (let ch = 0; ch < 4; ch++) overlay[ch] *= texelPx[ch];
      }
      if (overlay1) {
        sample(overlay1, u * k.texAnim1[2] + k.texAnim1[0], v * k.texAnim1[3] + k.texAnim1[1], true, texelPx);
        for (let ch = 0; ch < 4; ch++) overlay[ch] *= texelPx[ch];
      }
      const layerA = radial[3] * overlay[3];
      for (let ch = 0; ch < 3; ch++) composed[ch] = scene[ch] * (1 - layerA) + radial[ch] * overlay[ch];
      composed[3] = layerA;
      let maskA = 1;
      if (mask) {
        sample(mask, u, v, false, texelPx);
        maskA = texelPx[3];
      }
      const blend = Math.min(Math.max(maskA * composed[k.swizzle[3]] * fade, 0), 1);
      for (let ch = 0; ch < 3; ch++) {
        const picked = composed[k.swizzle[ch]];
        rgba[o + ch] = Math.min(Math.max(r[ch] + (picked - r[ch]) * blend, 0), 1) * 255;
      }
    }
  }
  return view;
}
export {
  FFX_SCROLL_SPEED,
  NO_BLEND_SET,
  applyFfx,
  ffxConstants,
  ffxTextures
};
