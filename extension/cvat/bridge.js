/** Serialized by chrome.scripting into MAIN world: keep every dependency inside
 * this function. Geometry/PCD fitting lives elsewhere; this adapter only reads
 * the open session, downloads same-origin PCDs and performs explicit commits.
 * Never call annotations.save(), import(), clear(), PATCH or a remote service.
 * Native Commit approach informed by MIT prelabelcheck_CVAT (see NOTICE). */
export async function cvatBridge(request) {
  let memory,
    ownsLock = false;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const canonical = (v) =>
    Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : v && typeof v === "object"
        ? "{" +
          Object.keys(v)
            .filter((k) => v[k] !== undefined)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v);
  const equal = (a, b) => canonical(a) === canonical(b);
  const noIDs = (v) =>
    Array.isArray(v)
      ? v.map(noIDs)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([k]) => !["id", "clientID", "uiId"].includes(k))
              .map(([k, x]) => [k, noIDs(x)]),
          )
        : v;
  try {
    const match = location.pathname.match(
      /^(.*?)\/tasks\/(\d+)\/jobs\/(\d+)\/?$/,
    );
    if (!match) throw Error("Mở extension từ tab job CVAT LiDAR.");
    const slot = Symbol.for("cvat.trackRefiner.v1");
    memory = globalThis[slot] || (globalThis[slot] = {});
    if (request.op === "abort") {
      memory.abort?.abort();
      return { ok: true };
    }
    let store = memory.store;
    if (!store && typeof globalThis.cvatUI?.registerComponent === "function") {
      globalThis.cvatUI.registerComponent(({ store: s }) => {
        memory.store = s;
        return {
          name: "Track Refiner",
          destructor: () => {
            memory.store = null;
          },
        };
      });
      store = memory.store;
    }
    if (!store) {
      // Compatibility fallback for hosts which do not expose registerComponent.
      // Find a unique real store, never infer client IDs from sidebar ordering.
      const queue = [],
        seen = new Set(),
        stores = new Set();
      for (const el of [
        ...document.querySelectorAll(".cvat-objects-sidebar-state-item"),
        document.getElementById("root"),
      ].filter(Boolean))
        for (const key of Object.keys(el))
          if (/^__react(Fiber\$|InternalInstance\$|Container\$)/.test(key))
            queue.push(el[key]);
      for (let i = 0; i < queue.length && i < 18000; i++) {
        const node = queue[i];
        if (!node || typeof node !== "object" || seen.has(node)) continue;
        seen.add(node);
        for (const props of [node.memoizedProps, node.pendingProps])
          for (const candidate of [props?.store, props?.value?.store])
            if (
              typeof candidate?.getState === "function" &&
              typeof candidate?.dispatch === "function"
            ) {
              try {
                if (
                  candidate.getState()?.annotation?.job?.instance?.id ===
                  Number(match[3])
                )
                  stores.add(candidate);
              } catch {}
            }
        queue.push(node.return, node.child, node.sibling);
      }
      if (stores.size !== 1)
        throw Error(
          "Không tìm được duy nhất phiên CVAT. Mở bảng Objects; host có thể chưa tương thích.",
        );
      store = [...stores][0];
      memory.store = store;
    }
    const job = store.getState()?.annotation?.job?.instance;
    if (
      !job ||
      job.id !== Number(match[3]) ||
      job.taskId !== Number(match[2]) ||
      job.dimension !== "3d"
    )
      throw Error("Phiên không khớp job LiDAR 3D.");
    if (memory.job !== job) {
      memory.abort?.abort();
      Object.assign(memory, {
        job,
        epoch: crypto.randomUUID(),
        busy: false,
        used: new Set(),
        latest: null,
        route: null,
        metadataBase: null,
      });
    }
    const context = {
      origin: location.origin,
      prefix: match[1],
      taskId: job.taskId,
      jobId: job.id,
      documentID: performance.timeOrigin,
      epoch: memory.epoch,
    };
    if (request.context && !equal(request.context, context))
      throw Error("Tab đã đổi job hoặc tải lại. Đọc phiên mới.");
    function ready(edit = false) {
      const s = store.getState(),
        a = s.annotation;
      if (
        a.job.instance !== job ||
        !a.annotations.initialized ||
        a.job.fetching
      )
        throw Error("CVAT đang đổi job hoặc chưa tải xong annotation.");
      if (
        edit &&
        (a.job.saving ||
          a.annotations.saving?.uploading ||
          a.player.playing ||
          a.player.frame.fetching ||
          String(a.workspace).toLowerCase() === "review" ||
          a.canvas?.ready === false ||
          (a.canvas?.activeControl && a.canvas.activeControl !== "cursor"))
      )
        throw Error(
          "Chờ Save/tải frame xong, dừng phát và dùng công cụ chọn; không hỗ trợ Review.",
        );
      return s;
    }
    ready();
    async function exported() {
      const d = clone(await job.annotations.export());
      if (!["tracks", "shapes", "tags"].every((k) => Array.isArray(d[k])))
        throw Error("Không xuất được đầy đủ annotation trong phiên.");
      ready();
      return d;
    }
    const without = (d, id) => ({
      ...d,
      tracks: d.tracks.filter((t) => t.clientID !== id),
    });
    async function refresh() {
      const s = ready(),
        f = s.annotation.player.frame.number;
      const states = await job.annotations.get(
        f,
        s.settings?.workspace?.showAllInterpolationTracks ?? true,
        s.annotation.annotations.filters || [],
      );
      const history = await job.actions.get();
      if (ready().annotation.player.frame.number !== f) return;
      states.push(
        ...s.annotation.annotations.states.filter((x) => x.isGroundTruth),
      );
      store.dispatch({
        type: "FETCH_ANNOTATIONS_SUCCESS",
        payload: { states, history },
      });
    }
    if (request.op === "snapshot") {
      const annotations = await exported(),
        s = ready(),
        a = s.annotation;
      return {
        ok: true,
        context,
        annotations,
        labels: (job.labels || a.job.labels || []).map((l) => ({
          id: l.id,
          name: l.name,
        })),
        frame: a.player.frame.number,
        start: job.startFrame,
        end: job.stopFrame,
        autoSave: s.settings?.workspace?.autoSave,
        activeID: Number.isInteger(a.annotations.activatedStateID)
          ? a.annotations.activatedStateID
          : a.annotations.selectedStatesID?.length === 1
            ? a.annotations.selectedStatesID[0]
            : null,
      };
    }
    if (request.op === "cloud") {
      const f = request.frame;
      if (!Number.isInteger(f) || f < job.startFrame || f > job.stopFrame)
        throw Error("Frame ngoài job.");
      if (memory.abort) throw Error("Một lượt tải point cloud đang chạy.");
      let override = request.apiBase || "";
      if (
        override &&
        (!/^\/[a-zA-Z0-9_./-]+$/.test(override) ||
          override.startsWith("//") ||
          override.includes(".."))
      )
        throw Error("API base phải là đường dẫn cùng server, ví dụ /api.");
      const bases = override
        ? [override.replace(/\/$/, "")]
        : [
            ...new Set(
              [memory.route, context.prefix + "/api", "/api"].filter(Boolean),
            ),
          ];
      const controller = new AbortController();
      memory.abort = controller;
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        for (const base of bases)
          for (const slash of ["", "/"]) {
            if (memory.metadataBase !== base) {
              const metaResponse = await fetch(
                `${base}/jobs/${job.id}/data/meta${slash}`,
                {
                  credentials: "same-origin",
                  signal: controller.signal,
                  redirect: "manual",
                },
              );
              if (
                metaResponse.status === 404 ||
                metaResponse.type === "opaqueredirect"
              )
                continue;
              if (!metaResponse.ok)
                throw Error(
                  `Không đọc được metadata frame: HTTP ${metaResponse.status}.`,
                );
              const meta = await metaResponse.json(),
                filter = String(meta.frame_filter || "").trim();
              if (!Number.isInteger(meta.size) || meta.size < 1)
                throw Error("Metadata không phải dữ liệu CVAT hợp lệ.");
              if (
                (filter && !/^step\s*=\s*1$/.test(filter)) ||
                meta.included_frames?.length
              )
                throw Error(
                  "Bản đầu chưa hỗ trợ frame_filter/step khác 1. Dừng để tránh ghép nhầm số frame.",
                );
              ready();
              memory.metadataBase = base;
            }
            const response = await fetch(
              `${base}/jobs/${job.id}/data${slash}?type=frame&number=${f}&quality=original`,
              {
                credentials: "same-origin",
                signal: controller.signal,
                redirect: "manual",
              },
            );
            // Some proxies require a trailing slash. Do not follow arbitrary
            // redirects (including SSO); try our other same-origin spelling.
            if (response.status === 404 || response.type === "opaqueredirect")
              continue;
            if (!response.ok)
              throw Error(`Không tải được PCD: HTTP ${response.status}.`);
            const reader = response.body?.getReader();
            if (!reader) throw Error("Server không trả luồng dữ liệu.");
            const chunks = [];
            let length = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.length;
              if (length > 32 * 1024 * 1024) {
                await reader.cancel();
                throw Error("PCD vượt giới hạn 32 MB/frame.");
              }
              chunks.push(value);
            }
            ready();
            const data = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
              data.set(chunk, offset);
              offset += chunk.length;
            }
            // chrome.scripting transports JSON, not transferable ArrayBuffers.
            // Encode in small pieces to avoid argument-stack overflow.
            let binary = "";
            for (let i = 0; i < data.length; i += 16384)
              binary += String.fromCharCode(...data.subarray(i, i + 16384));
            memory.route = base;
            return { ok: true, base64: btoa(binary), bytes: length };
          }
        throw Error(
          "Không tìm được API frame. Điền đường dẫn API trong Tùy chọn (ví dụ /api hoặc /cvat/api).",
        );
      } finally {
        clearTimeout(timer);
        if (memory.abort === controller) memory.abort = null;
      }
    }
    if (!["preflight", "apply", "undo"].includes(request.op))
      throw Error("Operation không hỗ trợ.");
    ready(true);
    if (memory.busy) throw Error("Một panel khác đang áp dụng.");
    memory.busy = true;
    ownsLock = true;
    const before = await exported();
    if (request.op === "undo") {
      const last = memory.latest;
      if (!last || typeof job.actions?.undo !== "function")
        throw Error("Chưa có Apply để hoàn tác trong tab này.");
      const history = await job.actions.get();
      if (
        !equal(history, last.history) ||
        !equal(noIDs(before), noIDs(last.after))
      )
        throw Error(
          "CVAT có chỉnh sửa/Undo mới. Dùng Undo/Redo gốc của CVAT để chọn đúng thao tác.",
        );
      ready(true);
      await job.actions.undo(1);
      memory.latest = null;
      let warning = "";
      try {
        const after = await exported();
        if (!equal(noIDs(after), noIDs(last.before)))
          warning =
            "Undo đã chạy nhưng dữ liệu không khớp snapshot; kiểm tra CVAT.";
        await refresh();
      } catch (e) {
        warning = "Undo đã chạy; " + e.message;
      }
      return { ok: true, undone: true, warning };
    }
    const original = before.tracks.find(
      (t) => t.clientID === request.baseline?.clientID,
    );
    if (!original || !equal(noIDs(original), noIDs(request.baseline)))
      throw Error("Track đã đổi sau khi phân tích. Đọc và phân tích lại.");
    const locks = await job.annotations.get(
      Math.max(job.startFrame, original.shapes[0].frame),
      true,
      [],
    );
    if (locks.find((x) => x.clientID === original.clientID)?.lock)
      throw Error("Track đang khóa. Mở khóa trong CVAT trước.");
    if (request.op === "preflight") return { ok: true, before, context };
    if (!request.backupStored || !equal(before, request.backup))
      throw Error(
        "Thiếu backup hoặc dữ liệu vừa đổi sau backup. Thử Apply lại để chụp bản mới.",
      );
    if (typeof job.annotations.commit !== "function")
      throw Error(
        "Host thiếu annotations.commit; không chuyển sang API server.",
      );
    if (typeof request.token !== "string" || memory.used.has(request.token))
      throw Error("Lượt Apply đã được gửi; đọc lại trước khi thử tiếp.");
    const replacement = clone(request.track),
      range = request.range;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every(Number.isInteger) ||
      range[0] < job.startFrame ||
      range[1] > job.stopFrame ||
      range[1] < range[0] ||
      range[1] - range[0] > 1199
    )
      throw Error("Khoảng Apply không hợp lệ.");
    const metadata = (t) => {
      const x = noIDs(t);
      delete x.shapes;
      return x;
    };
    if (!equal(metadata(original), metadata(replacement)))
      throw Error("Đề xuất đổi metadata track; không áp dụng.");
    if (
      !replacement.shapes?.length ||
      replacement.shapes.length > original.shapes.length + 1202
    )
      throw Error("Số keyframe không hợp lệ.");
    const keys = [...original.shapes].sort((a, b) => a.frame - b.frame),
      seen = new Set();
    const at = (f) => {
      let i = -1;
      while (i + 1 < keys.length && keys[i + 1].frame <= f) i++;
      if (i < 0) return null;
      const a = clone(keys[i]),
        b = keys[i + 1];
      if (a.frame !== f) {
        delete a.id;
        a.attributes = [];
        if (b) {
          const t = (f - a.frame) / (b.frame - a.frame);
          a.points = a.points.map((v, j) =>
            j >= 3 && j <= 5
              ? Math.atan2(
                  Math.sin(
                    v +
                      t *
                        Math.atan2(
                          Math.sin(b.points[j] - v),
                          Math.cos(b.points[j] - v),
                        ),
                  ),
                  Math.cos(
                    v +
                      t *
                        Math.atan2(
                          Math.sin(b.points[j] - v),
                          Math.cos(b.points[j] - v),
                        ),
                  ),
                )
              : v + t * (b.points[j] - v),
          );
        }
      }
      a.frame = f;
      return a;
    };
    for (const shape of replacement.shapes) {
      const f = shape.frame,
        old = keys.find((s) => s.frame === f) || at(f);
      if (
        !Number.isInteger(f) ||
        seen.has(f) ||
        !old ||
        (!keys.some((k) => k.frame === f) &&
          (f < job.startFrame || f > job.stopFrame)) ||
        shape.type !== "cuboid" ||
        shape.points?.length !== 16 ||
        !shape.points.every(Number.isFinite) ||
        !shape.points.slice(6, 9).every((v) => v > 0)
      )
        throw Error("Keyframe đề xuất không hợp lệ.");
      seen.add(f);
      const s = noIDs(shape),
        o = noIDs(old),
        p = s.points,
        q = o.points;
      delete s.points;
      delete o.points;
      if (!equal(s, o))
        throw Error("Đề xuất đổi thuộc tính/visibility/metadata keyframe.");
      if (p.some((v, j) => ![0, 1, 2, 5, 6, 7, 8].includes(j) && v !== q[j]))
        throw Error("Đề xuất đổi roll/pitch hoặc padding.");
      if ((f < range[0] || f > range[1] || old.outside) && !equal(p, q))
        throw Error("Đề xuất đổi hình học ngoài khoảng hoặc frame outside.");
      if (
        Math.hypot(...p.slice(0, 3).map((v, j) => v - q[j])) > 1.51 ||
        Math.abs(Math.atan2(Math.sin(p[5] - q[5]), Math.cos(p[5] - q[5]))) >
          Math.PI / 6 + 1e-6 ||
        p.slice(6, 9).some((v, j) => v / q[6 + j] < 0.5 || v / q[6 + j] > 2)
      )
        throw Error("Đề xuất vượt giới hạn an toàn hình học.");
      if (old.id === undefined) delete shape.id;
      else shape.id = old.id;
    }
    if (keys.some((k) => !seen.has(k.frame)))
      throw Error("Đề xuất đã xóa keyframe gốc.");
    delete replacement.clientID;
    delete replacement.uiId;
    if (original.id === undefined) delete replacement.id;
    else replacement.id = original.id;
    // Recheck after awaited reads; neither concurrent edits nor Save may slip
    // between the baseline/backup check and the single native Commit.
    if (!equal(await exported(), before))
      throw Error("Annotation vừa thay đổi; chưa Apply.");
    ready(true);
    memory.used.add(request.token);
    const autoSave = ready().settings?.workspace?.autoSave;
    try {
      await job.annotations.commit(
        { tracks: [replacement] },
        { tracks: [original] },
        ready().annotation.player.frame.number,
      );
    } catch (error) {
      memory.latest = null;
      return {
        ok: true,
        applied: null,
        audited: false,
        canUndo: false,
        autoSave,
        warning:
          "Commit trả lỗi, chưa xác định đã thay đổi bao nhiêu: " +
          error.message +
          ". Không thử Apply lại; kiểm tra CVAT và backup trước.",
      };
    }
    // Past the commit boundary, return applied=true even if refresh/audit fails.
    // A UI error must NEVER encourage replaying a possibly successful mutation.
    let warning = "",
      audited = false,
      after,
      newTarget;
    try {
      after = await exported();
      const oldIDs = new Set(before.tracks.map((t) => t.clientID));
      const candidates = after.tracks.filter((t) => !oldIDs.has(t.clientID));
      newTarget =
        candidates.length === 1
          ? candidates[0]
          : after.tracks.find((t) => t.clientID === original.clientID);
      if (
        !newTarget ||
        !equal(
          without(before, original.clientID),
          without(after, newTarget.clientID),
        ) ||
        !equal(noIDs(newTarget), noIDs(replacement))
      )
        throw Error(
          "Audit không khớp: kiểm tra target và annotation khác; không tự ghi/rollback tiếp.",
        );
      audited = true;
      const history = clone(await job.actions.get());
      memory.latest = { before, after, history };
      await refresh();
    } catch (e) {
      warning = e.message;
      memory.latest = null;
    }
    return {
      ok: true,
      applied: true,
      clientID: newTarget?.clientID,
      warning,
      canUndo: !!memory.latest,
      otherTracks: before.tracks.length - 1,
      autoSave,
      audited,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (ownsLock && memory) memory.busy = false;
  }
}
