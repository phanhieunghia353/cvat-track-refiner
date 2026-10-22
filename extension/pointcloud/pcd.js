/** Bounded PCD reader: ASCII, binary AoS, binary_compressed SoA (LZF).
 * Coordinates must be float32/64. Never invent zero points for truncated data.
 * All parsing runs in a worker; no third-party decoder or remote code is used. */
export function decodeLZF(input, length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > 128 * 1024 * 1024)
    throw Error("PCD giải nén vượt giới hạn 128 MB.");
  const output = new Uint8Array(length);
  let i = 0,
    o = 0;
  while (i < input.length) {
    const ctrl = input[i++];
    if (ctrl < 32) {
      const n = ctrl + 1;
      if (i + n > input.length || o + n > length)
        throw Error("LZF thiếu dữ liệu literal.");
      output.set(input.subarray(i, i + n), o);
      i += n;
      o += n;
    } else {
      let n = ctrl >> 5,
        back = (ctrl & 31) << 8;
      if (n === 7) {
        if (i >= input.length) throw Error("LZF thiếu độ dài.");
        n += input[i++];
      }
      if (i >= input.length) throw Error("LZF thiếu offset.");
      back += input[i++] + 1;
      n += 2;
      if (back > o || o + n > length)
        throw Error("LZF offset/độ dài không hợp lệ.");
      // The source can overlap the destination; a bulk copy is incorrect here.
      for (let j = 0; j < n; j++) {
        output[o] = output[o - back];
        o++;
      }
    }
  }
  if (o !== length) throw Error("PCD LZF không đủ dữ liệu giải nén.");
  return output;
}
export function parsePCD(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > 32 * 1024 * 1024)
    throw Error(
      "Frame PCD vượt 32 MB; giảm chất lượng dữ liệu hoặc dùng công cụ ngoài trình duyệt.",
    );
  let pos = 0;
  const h = {};
  while (!h.DATA) {
    const end = bytes.indexOf(10, pos);
    if (end < 0 || end > 65536)
      throw Error("Không tìm thấy header PCD (có thể server trả HTML/ZIP).");
    const line = new TextDecoder().decode(bytes.subarray(pos, end)).trim();
    pos = end + 1;
    if (!line || line.startsWith("#")) continue;
    const [key, ...value] = line.split(/\s+/);
    h[key.toUpperCase()] = value;
  }
  const fields = h.FIELDS || h.FIELD,
    types = h.TYPE,
    sizes = h.SIZE?.map(Number);
  if (!fields || !types || !sizes) throw Error("PCD thiếu FIELDS/TYPE/SIZE.");
  const counts = (h.COUNT || fields.map(() => 1)).map(Number);
  const n = Number(
    h.POINTS?.[0] ?? Number(h.WIDTH?.[0]) * Number(h.HEIGHT?.[0] ?? 1),
  );
  if (
    !Number.isSafeInteger(n) ||
    n < 0 ||
    n > 2000000 ||
    [types, sizes, counts].some((a) => a.length !== fields.length) ||
    sizes.some((v) => ![1, 2, 4, 8].includes(v)) ||
    counts.some((v) => !Number.isInteger(v) || v < 1 || v > 1024)
  )
    throw Error("Header PCD không hợp lệ hoặc trên 2 triệu điểm.");
  const indices = ["x", "y", "z"].map((name) => fields.indexOf(name));
  if (
    indices.some(
      (i) =>
        i < 0 ||
        types[i] !== "F" ||
        ![4, 8].includes(sizes[i]) ||
        counts[i] !== 1,
    )
  )
    throw Error("PCD cần x/y/z kiểu float32 hoặc float64 đơn.");
  const rowBytes = sizes.reduce((sum, s, i) => sum + s * counts[i], 0);
  if (rowBytes * n > 128 * 1024 * 1024)
    throw Error("PCD sau giải nén quá lớn.");
  const xyz = new Float32Array(n * 3);
  let kept = 0;
  function append(values) {
    if (values.every((v) => Number.isFinite(v) && Math.abs(v) < 1e8))
      for (const v of values) xyz[kept++] = v;
  }
  const mode = h.DATA[0].toLowerCase();
  if (mode === "ascii") {
    const cols = indices.map((i) =>
        counts.slice(0, i).reduce((s, v) => s + v, 0),
      ),
      total = counts.reduce((s, v) => s + v, 0);
    const body = new TextDecoder().decode(bytes.subarray(pos));
    let start = 0,
      rows = 0;
    while (start < body.length && rows < n) {
      let end = body.indexOf("\n", start);
      if (end < 0) end = body.length;
      const line = body.slice(start, end).trim();
      start = end + 1;
      if (!line || line.startsWith("#")) continue;
      const values = line.split(/\s+/);
      if (values.length < total) throw Error("PCD ASCII thiếu cột.");
      append(cols.map((i) => Number(values[i])));
      rows++;
    }
    if (rows !== n) throw Error("PCD ASCII thiếu dòng.");
  } else {
    let data = bytes.subarray(pos),
      soa = false;
    if (mode === "binary_compressed") {
      if (data.length < 8) throw Error("PCD compressed thiếu header.");
      const sizesView = new DataView(data.buffer, data.byteOffset, 8),
        compressed = sizesView.getUint32(0, true),
        raw = sizesView.getUint32(4, true);
      if (raw !== n * rowBytes || compressed !== data.length - 8)
        throw Error("PCD compressed sai kích thước.");
      data = decodeLZF(data.subarray(8), raw);
      soa = true;
    } else if (mode !== "binary") throw Error(`PCD DATA ${mode} chưa hỗ trợ.`);
    if (data.length < n * rowBytes) throw Error("PCD binary thiếu dữ liệu.");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const offsets = indices.map((i) =>
      sizes.slice(0, i).reduce((s, v, j) => s + v * counts[j], 0),
    );
    for (let k = 0; k < n; k++)
      append(
        indices.map((i, j) => {
          const offset = soa
            ? offsets[j] * n + k * sizes[i]
            : k * rowBytes + offsets[j];
          return sizes[i] === 4
            ? view.getFloat32(offset, true)
            : view.getFloat64(offset, true);
        }),
      );
  }
  return xyz.slice(0, kept);
}
