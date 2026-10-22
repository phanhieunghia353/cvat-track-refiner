import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { makeDemo } from "../extension/demo/generate.js";
import { makeClutteredTrack } from "../extension/demo/clutter.js";
async function start() {
  const w = new Worker(new URL("./worker-harness.mjs", import.meta.url));
  await once(w, "message");
  let id = 0;
  return {
    w,
    call(op, payload = {}, transfer = []) {
      const n = ++id;
      return new Promise((resolve, reject) => {
        const handler = (message) => {
          if (message.id === n) {
            w.off("message", handler);
            message.error
              ? reject(Error(message.error))
              : resolve(message.result);
          }
        };
        w.on("message", handler);
        w.postMessage({ id: n, op, ...payload }, transfer);
      });
    },
  };
}
function pcd(xyz) {
  const header = `FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nWIDTH ${xyz.length / 3}\nHEIGHT 1\nPOINTS ${xyz.length / 3}\nDATA binary\n`,
    h = new TextEncoder().encode(header),
    b = new Uint8Array(h.length + xyz.byteLength);
  b.set(h);
  b.set(new Uint8Array(xyz.buffer, xyz.byteOffset, xyz.byteLength), h.length);
  return b.buffer;
}
test("worker integrates PCD decode, expanded crop and multi-frame fitting with transferable buffers", async () => {
  const { w, call } = await start();
  try {
    const demo = makeDemo(8);
    await call("init", { track: demo.track, config: {}, others: [] });
    for (const f of demo.frames) {
      const buffer = pcd(f.xyz),
        pending = call("ingest", { frame: f.frame, buffer }, [buffer]);
      assert.equal(buffer.byteLength, 0);
      const stats = await pending;
      assert.ok(stats.kept >= 35);
    }
    const r = await call("analyze");
    assert.equal(r.applicable, true);
    assert.equal(r.frames.length, 8);
    assert.ok(r.template.length > 0);
  } finally {
    await w.terminate();
  }
});
test("worker returns decode errors without publishing a plan and cancellation terminates computation", async () => {
  const { w, call } = await start();
  try {
    const demo = makeDemo();
    await call("init", { track: demo.track, config: {}, others: [] });
    await assert.rejects(
      call("ingest", { frame: 0, buffer: new ArrayBuffer(2) }),
      /PCD/,
    );
    await call("demoFrames", { frames: demo.frames });
    const progress = new Promise((resolve) =>
      w.on("message", (m) => m.progress && resolve(m.progress)),
    );
    w.postMessage({ id: 999, op: "analyze" });
    await progress;
    await w.terminate();
  } finally {
    await w.terminate();
  }
});

test("PCD/crop/worker pipeline keeps a near-correct vehicle size despite exterior clutter", async () => {
  const { w, call } = await start();
  try {
    const demo = makeClutteredTrack();
    await call("init", { track: demo.track, config: {}, others: [] });
    for (const f of demo.frames) {
      const buffer = pcd(f.xyz);
      await call("ingest", { frame: f.frame, buffer }, [buffer]);
    }
    const r = await call("analyze");
    assert.equal(r.applicable, true);
    r.size.forEach((v, j) =>
      assert.ok(Math.abs(v - demo.truth[0][6 + j]) < 0.06),
    );
    assert.ok(r.frames.every((f) => Math.abs(f.yaw) < Math.PI / 180));
    assert.ok(r.frames[8].rejectedXYZ.length > 0);
  } finally {
    await w.terminate();
  }
});
test("worker runs core PCD/crop/surface pipeline without invoking the box estimator", async () => {
  const { makeReconstructionDemo } = await import(
    "../extension/demo/reconstruction.js"
  );
  const { w, call } = await start();
  try {
    const d = makeReconstructionDemo(4);
    await call("init", {
      mode: "core",
      track: d.track,
      config: {},
      others: [],
    });
    for (const f of d.frames) {
      const buffer = pcd(f.xyz);
      await call("ingest", { frame: f.frame, buffer }, [buffer]);
    }
    const r = await call("analyze", { options: { referenceFrame: 0 } });
    assert.equal(r.kind, "reconstruction");
    assert.ok(!("size" in r));
    assert.ok(r.diagnostics.trusted >= 3);
    assert.ok(r.surfaces.length > 0);
    for (const f of r.observations) {
      assert.equal(f.stats.coreCrop, true);
      assert.ok(f.xyz.length / 3 <= 1800);
      assert.equal(f.masks.length, f.xyz.length / 3);
    }
  } finally {
    await w.terminate();
  }
});
