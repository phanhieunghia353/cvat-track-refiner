import { parsePCD } from "../pointcloud/pcd.js";
import { cropObject } from "../pointcloud/crop.js";
import { refineTrack } from "../fitting/refine.js";
import { stateAt } from "../core/geometry.js";
import { settings } from "../core/config.js";

let config,
  track,
  others,
  frames = [];
// The controller transfers each downloaded ArrayBuffer here, then releases it.
// Only bounded crops survive ingestion. Cancellation terminates the worker.
self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    let result;
    if (op === "init") {
      config = settings(data.config);
      track = data.track;
      others = data.others || [];
      frames = [];
      result = { ready: true };
    } else if (op === "ingest") {
      const state = stateAt(track, data.frame);
      if (!state || state.outside)
        throw Error("Frame mẫu không có object hiện.");
      const xyz = parsePCD(data.buffer),
        masks = others
          .map((t) => stateAt(t, data.frame))
          .filter((s) => s && !s.outside && s.type === "cuboid")
          .map((s) => s.points);
      const crop = cropObject(xyz, state.points, masks, config);
      if (frames.length >= config.maxFrames)
        throw Error("Vượt số frame được phép giữ.");
      frames.push({ frame: data.frame, points: state.points, ...crop });
      result = crop.stats;
    } else if (op === "demoFrames") {
      frames = data.frames;
      result = { ready: true };
    } else if (op === "analyze") {
      result = await refineTrack(frames, config, (progress) =>
        self.postMessage({ progress }),
      );
    } else throw Error("Worker operation không hợp lệ.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
