// Browser-worker shim for integration tests. Not shipped inside the extension.
import { parentPort } from "node:worker_threads";
globalThis.self = { postMessage: (message) => parentPort.postMessage(message) };
await import("../extension/workers/fit-worker.js");
parentPort.on("message", (data) => self.onmessage({ data }));
parentPort.postMessage({ ready: true });
