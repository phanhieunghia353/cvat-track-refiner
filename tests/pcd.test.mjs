import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePCD, decodeLZF } from "../extension/pointcloud/pcd.js";
const header = (mode, n = 2) =>
  `VERSION .7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH ${n}\nHEIGHT 1\nPOINTS ${n}\nDATA ${mode}\n`;
const bytes = (s) => new TextEncoder().encode(s);
function join(a, b) {
  const r = new Uint8Array(a.length + b.length);
  r.set(a);
  r.set(b, a.length);
  return r.buffer;
}
test("ASCII reads reordered/scalar fields and removes nonfinite returns", () => {
  const data = parsePCD(
    bytes(header("ascii", 3) + "1 2 3 4\n5 6 7 8\nnan 0 0 0\n").buffer,
  );
  assert.deepEqual([...data], [1, 2, 3, 5, 6, 7]);
});
test("ASCII truncation, missing columns and HTML are rejected", () => {
  assert.throws(
    () => parsePCD(bytes(header("ascii") + "1 2 3 4\n").buffer),
    /thiếu dòng/,
  );
  assert.throws(
    () => parsePCD(bytes(header("ascii") + "1 2\n5 6\n").buffer),
    /thiếu cột/,
  );
  assert.throws(() => parsePCD(bytes("<html>login</html>").buffer), /PCD/);
});
test("binary AoS and compressed SoA produce identical XYZ", () => {
  const aos = new Float32Array([1, 2, 3, 9, 5, 6, 7, 10]);
  const expected = [1, 2, 3, 5, 6, 7];
  assert.deepEqual(
    [...parsePCD(join(bytes(header("binary")), new Uint8Array(aos.buffer)))],
    expected,
  );
  const soa = new Uint8Array(
      new Float32Array([1, 5, 2, 6, 3, 7, 9, 10]).buffer,
    ),
    literal = Uint8Array.from([31, ...soa]);
  const body = new Uint8Array(8 + literal.length),
    view = new DataView(body.buffer);
  view.setUint32(0, literal.length, true);
  view.setUint32(4, soa.length, true);
  body.set(literal, 8);
  assert.deepEqual(
    [...parsePCD(join(bytes(header("binary_compressed")), body))],
    expected,
  );
});
test("LZF overlapping copy is decoded and invalid backreferences are refused", () => {
  assert.equal(
    new TextDecoder().decode(
      decodeLZF(Uint8Array.from([2, 97, 98, 99, 32, 2]), 6),
    ),
    "abcabc",
  );
  assert.throws(() => decodeLZF(Uint8Array.from([32, 4]), 3), /offset/);
  assert.throws(() => decodeLZF(new Uint8Array(), 200e6), /128 MB/);
});
test("binary truncation and malicious PCD allocation requests fail before reading", () => {
  assert.throws(
    () => parsePCD(join(bytes(header("binary")), new Uint8Array(10))),
    /thiếu dữ liệu/,
  );
  assert.throws(() => parsePCD(bytes(header("ascii", 3e6)).buffer), /2 triệu/);
});
