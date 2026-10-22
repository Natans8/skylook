/**
 * A rendered loop, encoded in the page: a GIF through gifski, which builds a palette per frame with temporal
 * dithering, and an mp4 or a webm through the browser's own video encoder, written out by mediabunny.
 *
 * An encoder takes the frames in order through `add`, hands back the file from `finish`, and drops its work on
 * `cancel`. The heavy parts load on first use, since most visits export nothing.
 */

const VIDEO = {
  mp4: { codec: "avc", type: "video/mp4" },
  webm: { codec: "vp9", type: "video/webm" },
};

/** A frame that is not the size the encoder was opened at means the view was resized mid-render. */
function sameSize(picture, width, height) {
  if (picture.width !== width || picture.height !== height) throw new Error("the view changed size while the loop rendered");
}

/**
 * The GIF encoder. gifski takes every frame at once, so the frames are laid into one buffer as they arrive, and the
 * whole of it goes to a worker, where the encode cannot freeze the page.
 */
export function gifEncoder({ count, width, height, fps, quality }) {
  const size = width * height * 4;
  let frames = new Uint8Array(count * size);
  return {
    add(picture, i) {
      sameSize(picture, width, height);
      frames.set(picture.rgba, i * size);
    },
    finish() {
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./gifworker.js?v=e40291d6ff", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }) => {
          worker.terminate();
          if (data.error) reject(new Error(`the GIF encoder failed: ${data.error}`));
          else resolve(new Blob([data.gif], { type: "image/gif" }));
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message || "the GIF encoder could not start"));
        };
        worker.postMessage({ frames, count, width, height, fps, quality }, [frames.buffer]);
        frames = null;
      });
    },
    cancel() {
      frames = null;
    },
  };
}

/** Quality from 1 to 100, as the video writer's own levels. */
function videoQuality(mediabunny, quality) {
  if (quality >= 95) return mediabunny.QUALITY_VERY_HIGH;
  if (quality >= 75) return mediabunny.QUALITY_HIGH;
  if (quality >= 45) return mediabunny.QUALITY_MEDIUM;
  if (quality >= 20) return mediabunny.QUALITY_LOW;
  return mediabunny.QUALITY_VERY_LOW;
}

/**
 * The video encoder, for `mp4` or `webm`. Each frame is encoded as it arrives, so a long loop never holds more than
 * one frame. The codecs want even dimensions, so an odd last row or column is dropped.
 */
export async function videoEncoder({ format, width, height, fps, quality }) {
  const kind = VIDEO[format];
  if (!kind) throw new Error(`unknown format ${format}`);
  const mediabunny = await import("./lib/mediabunny.min.js?v=e40291d6ff");
  const evenWidth = width & ~1, evenHeight = height & ~1;
  const level = videoQuality(mediabunny, quality);
  if (!(await mediabunny.canEncodeVideo(kind.codec, { width: evenWidth, height: evenHeight, bitrate: level }))) {
    throw new Error(`this browser cannot encode ${format} at ${evenWidth} by ${evenHeight}; try ${format === "mp4" ? "webm" : "mp4"} or a gif`);
  }
  const canvas = new OffscreenCanvas(evenWidth, evenHeight);
  const context = canvas.getContext("2d");
  const output = new mediabunny.Output({
    format: format === "mp4" ? new mediabunny.Mp4OutputFormat({ fastStart: "in-memory" }) : new mediabunny.WebMOutputFormat(),
    target: new mediabunny.BufferTarget(),
  });
  const source = new mediabunny.CanvasSource(canvas, { codec: kind.codec, quality: level });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  return {
    async add(picture, i) {
      sameSize(picture, width, height);
      context.putImageData(new ImageData(picture.rgba, width, height), 0, 0);
      await source.add(i / fps, 1 / fps);
    },
    async finish() {
      await output.finalize();
      return new Blob([output.target.buffer], { type: kind.type });
    },
    async cancel() {
      await output.cancel();
    },
  };
}
