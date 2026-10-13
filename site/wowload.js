// The browser's own readers for the client's files, on @wowserhq/format (MIT): M2 models with their skin, and
// BLP textures. The library parses the MD20 body and the skin profile; this file walks the chunk table around
// them (MD21, TXID, SFID), reads the skin's 24-byte batch records for the raw shader id the library folds into
// its own enum, and turns the result into the shape the renderers already draw.
import * as THREE from "./lib/three.module.js?v=6570bde9c2";
import { M2Model, M2SkinProfile, Blp, BLP_IMAGE_FORMAT } from "./lib/wowser-format.js?v=6570bde9c2";
import { RAW_URL } from "./assets.js?v=6570bde9c2";

const rawUrl = (build, fid) => RAW_URL.replace("{build}", build).replace("{fid}", String(fid));

async function fetchRaw(build, fid) {
  const res = await fetch(rawUrl(build, fid));
  if (!res.ok) throw new Error(`file ${fid} for ${build}: ${res.status}`);
  return res.arrayBuffer();
}

/** The chunk table of a chunked client file: magic to payload. */
function chunks(buffer) {
  const view = new DataView(buffer);
  const out = new Map();
  let i = 0;
  while (i + 8 <= buffer.byteLength) {
    const magic = String.fromCharCode(view.getUint8(i), view.getUint8(i + 1), view.getUint8(i + 2), view.getUint8(i + 3));
    const size = view.getUint32(i + 4, true);
    out.set(magic, buffer.slice(i + 8, i + 8 + size));
    i += 8 + size;
  }
  return out;
}

/** An M2Track from the library into the per-sequence keyframe lists the renderers sample. */
function track(t, kind) {
  if (!t) return null;
  const seqs = [];
  const n = Math.max(t.sequenceTimes.length, t.sequenceKeys.length);
  for (let s = 0; s < n; s++) {
    const times = t.sequenceTimes[s], keys = t.sequenceKeys[s];
    if (!times || !keys || times.length === 0 || keys.length === 0) { seqs.push(null); continue; }
    const per = Math.max(1, Math.round(keys.length / times.length));
    const v = [];
    for (let k = 0; k < times.length; k++) {
      if (kind === "cquat") {
        const q = [];
        for (let c = 0; c < 4; c++) { const raw = keys[k * 4 + c]; q.push((raw < 0 ? raw + 32768 : raw - 32767) / 32767); }
        v.push(q);
      } else if (kind === "fixed16") {
        v.push(keys[k] / 32767);
      } else if (per === 1) {
        v.push(keys[k]);
      } else {
        v.push(Array.from(keys.subarray(k * per, k * per + per)));
      }
    }
    seqs.push({ t: Array.from(times), v });
  }
  // 65535 is the file's own marker for a track on no global loop; the renderers read that as -1
  return { interp: t.trackType, gseq: t.loopIndex === 65535 ? -1 : t.loopIndex, seqs };
}

/** The batch records of skin 0, read from the SKIN header's fifth array: the raw shader id lives only here. */
function batchRecords(buffer) {
  const view = new DataView(buffer);
  const n = view.getUint32(36, true), ofs = view.getUint32(40, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = ofs + 24 * i;
    out.push({
      flags: view.getUint8(o), priority: view.getInt8(o + 1), shader: view.getUint16(o + 2, true), submesh: view.getUint16(o + 4, true),
      geoset: view.getUint16(o + 6, true), color: view.getUint16(o + 8, true), material: view.getUint16(o + 10, true), layer: view.getUint16(o + 12, true),
      textureCount: view.getUint16(o + 14, true), textureCombo: view.getUint16(o + 16, true), texCoordCombo: view.getUint16(o + 18, true),
      weightCombo: view.getUint16(o + 20, true), transformCombo: view.getUint16(o + 22, true),
    });
  }
  return out;
}

/** Load an M2 by file id with its first skin, in the shape m2.py writes, so the renderer is unchanged. */
export async function loadM2(build, fid) {
  const raw = await fetchRaw(build, fid);
  const ch = chunks(raw);
  const body = ch.get("MD21");
  if (!body) throw new Error(`file ${fid} is not a chunked M2`);
  const model = new M2Model().load(body);
  const txid = ch.has("TXID") ? Array.from(new Uint32Array(ch.get("TXID"))) : [];
  const sfid = ch.has("SFID") ? Array.from(new Uint32Array(ch.get("SFID"))) : [];
  if (!sfid.length) throw new Error(`model ${fid} names no skin`);
  const skinRaw = await fetchRaw(build, sfid[0]);
  const skin = new M2SkinProfile(model).load(skinRaw);
  const records = batchRecords(skinRaw);

  const vb = new DataView(model.vertices);
  const count = model.vertices.byteLength / 48;
  const positions = [], normals = [], uv0 = [], uv1 = [], boneIndices = [], boneWeights = [];
  for (let i = 0; i < count; i++) {
    const o = i * 48;
    positions.push(vb.getFloat32(o, true), vb.getFloat32(o + 4, true), vb.getFloat32(o + 8, true));
    for (let k = 0; k < 4; k++) boneWeights.push(vb.getUint8(o + 12 + k) / 255);
    for (let k = 0; k < 4; k++) boneIndices.push(vb.getUint8(o + 16 + k));
    normals.push(vb.getFloat32(o + 20, true), vb.getFloat32(o + 24, true), vb.getFloat32(o + 28, true));
    uv0.push(vb.getFloat32(o + 32, true), vb.getFloat32(o + 36, true));
    uv1.push(vb.getFloat32(o + 40, true), vb.getFloat32(o + 44, true));
  }
  const local = skin.vertices;
  const indices = Array.from(skin.indices, (i) => local[i]);
  return {
    fid,
    name: model.name,
    flags: model.flags,
    globalLoops: Array.from(model.loops),
    sequences: model.sequences.map((s) => ({ id: s.id, variation: s.variationIndex, duration: s.duration, flags: s.flags })),
    bones: model.bones.map((b) => ({
      keyBone: b.boneId, flags: b.flags, parent: b.parentIndex, pivot: Array.from(b.pivot),
      translation: track(b.translationTrack, "vec3"), rotation: track(b.rotationTrack, "cquat"), scale: track(b.scaleTrack, "vec3"),
    })),
    vertexCount: count, positions, normals, uv0, uv1, boneIndices, boneWeights,
    colors: model.colors.map((c) => ({ color: track(c.colorTrack, "vec3"), alpha: track(c.alphaTrack, "fixed16") })),
    textures: model.textures.map((t, i) => ({ type: t.component, flags: t.flags, fid: txid[i] ?? 0, filename: t.filename })),
    textureWeights: model.textureWeights.map((w) => track(w.weightTrack, "fixed16")),
    textureTransforms: model.textureTransforms.map((x) => ({ translation: track(x.translationTrack, "vec3"), rotation: track(x.rotationTrack, "quat4"), scale: track(x.scalingTrack, "vec3") })),
    materials: model.materials.map((m) => ({ flags: m.flags, blend: m.blend })),
    textureLookup: Array.from(model.textureCombos),
    transparencyLookup: Array.from(model.textureWeightCombos),
    textureTransformLookup: Array.from(model.textureTransformCombos),
    skinFids: sfid,
    skin: {
      indices,
      submeshes: skin.skinSections.map((s) => ({ id: s.id, vertexStart: s.vertexStart, vertexCount: s.vertexCount, indexStart: s.indexStart, indexCount: s.indexCount, centerBone: s.centerBoneIndex, sortCenter: Array.from(s.sortCenterPosition), sortRadius: s.sortRadius })),
      batches: records,
    },
    hasAnimFiles: ch.has("AFID"),
  };
}

/** Fill a texture from a BLP by file id; the placeholder returned by the caller draws until the pixels arrive. */
export async function loadBlpInto(texture, build, fid) {
  const raw = await fetchRaw(build, fid);
  const blp = new Blp().load(raw);
  const image = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888); // bytes R, G, B, A per pixel
  // three.js gives a data texture immutable storage on its first upload, so the 1x1 stand-in must drop its GL
  // texture before it grows, or the pixels never reach the GPU
  texture.dispose();
  texture.image = { data: image.data, width: image.width, height: image.height };
  texture.needsUpdate = true;
  return texture;
}

/** A one-pixel grey stand-in with the sampling the model asks for. */
export function placeholderTexture(flags) {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = flags & 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = flags & 2 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
