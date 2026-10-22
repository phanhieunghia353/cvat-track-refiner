/** Small symmetric eigensolver and spatial index, dependency-free in workers.
 * Eigenvalues are sorted ascending; each eigenvector is a column of vectors. */
export function eigenSymmetric(matrix) {
  const n = matrix.length,
    a = matrix.map((r) => [...r]),
    vectors = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => Number(i === j)),
    );
  for (let sweep = 0; sweep < 60; sweep++) {
    let p = 0,
      q = 1,
      largest = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (Math.abs(a[i][j]) > largest) {
          largest = Math.abs(a[i][j]);
          p = i;
          q = j;
        }
    if (largest < 1e-10) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]),
      c = Math.cos(theta),
      s = Math.sin(theta);
    const pp = a[p][p],
      qq = a[q][q],
      pq = a[p][q];
    for (let k = 0; k < n; k++)
      if (k !== p && k !== q) {
        const x = a[k][p],
          y = a[k][q];
        a[k][p] = a[p][k] = c * x - s * y;
        a[k][q] = a[q][k] = s * x + c * y;
      }
    a[p][p] = c * c * pp - 2 * c * s * pq + s * s * qq;
    a[q][q] = s * s * pp + 2 * c * s * pq + c * c * qq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < n; k++) {
      const x = vectors[k][p],
        y = vectors[k][q];
      vectors[k][p] = c * x - s * y;
      vectors[k][q] = s * x + c * y;
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => a[i][i] - a[j][j],
  );
  return {
    values: order.map((i) => Math.max(0, a[i][i])),
    vectors: vectors.map((row) => order.map((i) => row[i])),
  };
}
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const key = (q, size) => q.map((v) => Math.floor(v / size)).join(",");
export function spatialIndex(records, size) {
  const grid = new Map();
  for (const r of records) {
    const k = key(r.q, size);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  }
  return (q) => {
    const k = q.map((v) => Math.floor(v / size)),
      out = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          out.push(
            ...(grid.get([k[0] + x, k[1] + y, k[2] + z].join(",")) || []),
          );
    return out;
  };
}
/** Solve only directions supported by data; damping never creates evidence. */
export function solveNormal(h, g, ratio = 0.01) {
  const eig = eigenSymmetric(h),
    largest = eig.values.at(-1),
    cut = Math.max(1e-7, largest * ratio),
    step = Array(h.length).fill(0);
  const rank = eig.values.filter((v) => v > cut).length;
  for (let j = 0; j < h.length; j++)
    if (eig.values[j] > cut) {
      const v = eig.vectors.map((r) => r[j]),
        amount = -dot(v, g) / (eig.values[j] + 0.001);
      v.forEach((x, k) => (step[k] += amount * x));
    }
  return { step, rank, eigenvalues: eig.values };
}
