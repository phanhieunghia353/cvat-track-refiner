// Run files directly so individual assertions remain visible even on Node
// runtimes that configure a nonstandard --test subprocess reporter.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const file of readdirSync(new URL("../tests/", import.meta.url))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()) {
  const result = spawnSync(process.execPath, ["tests/" + file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
