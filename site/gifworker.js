/**
 * The GIF encode, off the page's thread: gifski over every frame of a loop, laid back to back in one buffer.
 *
 * This is gifski's single-threaded build. The threaded one needs the page to be cross-origin isolated, which takes
 * response headers a static host cannot send.
 */
import init, { encode } from "./lib/gifski/pkg/gifski_wasm.js?v=f2df4334b3";

self.onmessage = async ({ data }) => {
  try {
    await init();
    const { frames, count, width, height, fps, quality } = data;
    const gif = encode(frames, count, width, height, fps, undefined, quality);
    self.postMessage({ gif }, [gif.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
