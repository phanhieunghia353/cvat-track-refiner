/** Serialized by chrome.scripting into MAIN world: keep every dependency inside
 * this function. Geometry/PCD fitting lives elsewhere; this adapter only reads
 * the open session, downloads same-origin PCDs and edits existing ObjectStates.
 * Never call annotations.commit/save/import/clear, PATCH or a remote service.
 * ObjectState.save() edits the local model and preserves the track identity. */
export async function cvatBridge(request) {
  let memory,
    ownsLock = false,
    releaseUI = () => {};
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
  try {
    const match = location.pathname.match(
      /^(.*?)\/tasks\/(\d+)\/jobs\/(\d+)\/?$/,
    );
    if (!match) throw Error("Mở extension từ tab job CVAT LiDAR.");
    // Do not reuse v1's replacement-Commit undo records after extension update.
    const slot = Symbol.for("cvat.trackRefiner.v2");
    memory = globalThis[slot] || (globalThis[slot] = {});
    if (request.op === "abort") {
      memory.abort?.abort();
      return { ok: true };
    }
    // Reuse only the old adapter's read-only store reference, never its
    // replacement-Commit history, tokens or context. Updating the extension
    // must not require reloading the user's CVAT job.
    let store =
      memory.store || globalThis[Symbol.for("cvat.trackRefiner.v1")]?.store;
    if (store) memory.store = store;
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
        type: "UPDATE_ANNOTATIONS_SUCCESS",
        payload: { states, history },
      });
    }
    // Read angles may be normalized by CVAT. Accept only equivalent rotations
    // and floating point read noise; metadata and existing IDs stay exact.
    const samePoints = (a, b) =>
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every(
        (v, j) =>
          Number.isFinite(v) &&
          Number.isFinite(b[j]) &&
          (j >= 3 && j <= 5
            ? Math.abs(Math.atan2(Math.sin(v - b[j]), Math.cos(v - b[j])))
            : Math.abs(v - b[j])) <=
            1e-10 +
              32 * Number.EPSILON * Math.max(1, Math.abs(v), Math.abs(b[j])),
      );
    const editedSource = (source) =>
      ["auto", "semi-auto"].includes(source)
        ? "semi-auto"
        : source === "consensus"
          ? source
          : "manual";
    function sameTarget(actual, desired, initialSource) {
      if (
        !actual ||
        ![initialSource, editedSource(initialSource)].includes(actual.source)
      )
        return false;
      const a = clone(actual),
        b = clone(desired);
      // The sole allowed metadata change is CVAT's native edited-source mark.
      b.source = a.source;
      a.shapes.sort((x, y) => x.frame - y.frame);
      b.shapes.sort((x, y) => x.frame - y.frame);
      if (a.shapes.length !== b.shapes.length) return false;
      for (let i = 0; i < a.shapes.length; i++) {
        if (!samePoints(a.shapes[i].points, b.shapes[i].points)) return false;
        a.shapes[i].points = b.shapes[i].points;
      }
      // In particular clientID, track.id and original keyframe.id are NOT masked.
      return equal(a, b);
    }
    function interpolated(track, frame) {
      const keys = [...track.shapes].sort((a, b) => a.frame - b.frame);
      const index = keys.findLastIndex((s) => s.frame <= frame);
      if (index < 0) return null;
      const a = clone(keys[index]),
        b = keys[index + 1];
      if (a.frame !== frame) {
        delete a.id;
        a.attributes = [];
        if (b) {
          const t = (frame - a.frame) / (b.frame - a.frame);
          a.points = a.points.map((v, j) =>
            j >= 3 && j <= 5
              ? v +
                t *
                  Math.atan2(
                    Math.sin(b.points[j] - v),
                    Math.cos(b.points[j] - v),
                  )
              : v + t * (b.points[j] - v),
          );
        }
      }
      a.frame = frame;
      return a;
    }
    async function nativeEdits(before, desired) {
      const original = before.tracks.find(
        (t) => t.clientID === desired.clientID,
      );
      if (!original || original.id !== desired.id)
        throw Error("ID track đã đổi; không sửa.");
      const edits = [];
      const wanted = new Map(desired.shapes.map((s) => [s.frame, s]));
      // Prepare EVERY native handle before the first mutation. Saving points
      // creates a key only when needed; no import/put/Commit is used as fallback.
      for (const frame of [
        ...new Set([...wanted.keys(), ...original.shapes.map((s) => s.frame)]),
      ].sort((a, b) => a - b)) {
        const old = original.shapes.find((s) => s.frame === frame),
          next = wanted.get(frame);
        if (old && next && equal(old.points, next.points)) continue;
        const states = await job.annotations.get(frame, true, []);
        ready(true);
        const state = states.find(
          (s) => s.clientID === desired.clientID && !s.isGroundTruth,
        );
        const expected = old || interpolated(original, frame);
        if (
          !state ||
          state.objectType !== "track" ||
          state.shapeType !== "cuboid" ||
          state.frame !== frame ||
          typeof state.save !== "function" ||
          (state.serverID ?? undefined) !== original.id ||
          state.lock ||
          !!state.keyframe !== !!old ||
          !expected ||
          !samePoints(state.points, expected.points)
        )
          throw Error(
            `Không xác minh được native cuboid ID ${desired.clientID}, frame ${frame}; chưa sửa.`,
          );
        edits.push({ frame, state, next, old });
      }
      return edits;
    }
    function blockUI() {
      if (typeof document.createElement !== "function" || !document.body)
        return;
      const overlay = document.createElement("div");
      overlay.textContent = "Đang cập nhật hình học trên track hiện có…";
      overlay.setAttribute("role", "status");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#0f172acc;color:white;display:grid;place-items:center;font:20px system-ui;cursor:wait";
      document.body.appendChild(overlay);
      const block = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const events = ["keydown", "pointerdown", "wheel", "touchstart"];
      events.forEach((type) =>
        globalThis.addEventListener(type, block, {
          capture: true,
          passive: false,
        }),
      );
      releaseUI = () => {
        overlay.remove();
        events.forEach((type) =>
          globalThis.removeEventListener(type, block, true),
        );
      };
    }
    // A separate helper also restores long batches after CVAT's bounded native
    // history has evicted early edits. It removes ONLY keys introduced by this
    // Apply, not the track. Source may remain marked edited in that fallback.
    async function writeNative(
      before,
      desired,
      edits,
      token,
      restoring = false,
    ) {
      const startHistory = clone(await job.actions.get());
      if (!equal(await exported(), before))
        throw Error("Annotation vừa thay đổi; chưa sửa.");
      ready(true);
      memory.used.add(token);
      memory.latest = null;
      const autoSave = ready().settings?.workspace?.autoSave;
      let completed = 0,
        attempted = 0,
        writeError;
      blockUI();
      for (const edit of edits) {
        try {
          ready(true);
          attempted++;
          if (!edit.next) edit.state.keyframe = false;
          else edit.state.points = [...edit.next.points];
          await edit.state.save(); // local ObjectState.save, never annotations.save
          completed++;
        } catch (error) {
          writeError = error;
          break;
        }
      }
      let after,
        history,
        audited = false,
        warning = writeError
          ? `Apply dừng sau ${completed}/${edits.length} frame: ${writeError.message}. Không Apply lặp.`
          : "";
      const expectedAfter = (count) => {
        const target = clone(
          before.tracks.find((t) => t.clientID === desired.clientID),
        );
        const shapes = new Map(target.shapes.map((s) => [s.frame, s]));
        for (const edit of edits.slice(0, count))
          if (edit.next) shapes.set(edit.frame, clone(edit.next));
          else shapes.delete(edit.frame);
        target.shapes = [...shapes.values()].sort((a, b) => a.frame - b.frame);
        return target;
      };
      try {
        after = await exported();
        const actual = after.tracks.find(
          (t) => t.clientID === desired.clientID,
        );
        const expected = writeError
          ? [expectedAfter(completed), expectedAfter(attempted)]
          : [desired];
        if (
          !equal(
            without(before, desired.clientID),
            without(after, desired.clientID),
          ) ||
          !expected.some((target) =>
            sameTarget(
              actual,
              target,
              before.tracks.find((t) => t.clientID === desired.clientID).source,
            ),
          )
        )
          throw Error(
            "Audit không khớp ID/hình học/metadata hoặc annotation khác. Dừng; kiểm tra CVAT và backup.",
          );
        audited = true;
        history = clone(await job.actions.get());
        if (!restoring && !equal(before, after)) {
          // Native history may be capped (32 in upstream). Use native Undo only
          // when ALL our actions are still present and the retained prefix fits.
          const n = edits.length,
            tail = history.undo.slice(-n);
          const dropped = startHistory.undo.length + n - history.undo.length;
          const nativeUndoCount =
            !writeError &&
            n > 0 &&
            history.undo.length >= n &&
            dropped >= 0 &&
            tail.every(
              (item, i) =>
                item[1] === edits[i].frame && /points|keyframe/i.test(item[0]),
            ) &&
            equal(history.undo.slice(0, -n), startHistory.undo.slice(dropped))
              ? n
              : 0;
          memory.latest = {
            before,
            after,
            history,
            nativeUndoCount,
            clientID: desired.clientID,
          };
        }
        await refresh();
      } catch (error) {
        warning = [warning, error.message].filter(Boolean).join("\n");
        // A render failure after a successful audit does not erase a valid undo.
        if (!audited) memory.latest = null;
      }
      const target = after?.tracks.find((t) => t.clientID === desired.clientID);
      return {
        ok: true,
        applied: writeError ? null : true,
        partial: !!writeError,
        audited,
        identityPreserved: audited,
        clientID: target?.clientID,
        serverID: target?.id,
        changedFrames: completed,
        warning,
        canUndo: !!memory.latest,
        otherTracks: before.tracks.length - 1,
        autoSave,
        sourceBefore: before.tracks.find((t) => t.clientID === desired.clientID)
          .source,
        sourceAfter: target?.source,
      };
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
      if (!equal(history, last.history) || !equal(before, last.after))
        throw Error(
          "CVAT có chỉnh sửa/Undo/Save mới. Không khôi phục đè lên dữ liệu mới; kiểm tra lịch sử CVAT.",
        );
      ready(true);
      memory.latest = null;
      if (last.nativeUndoCount) {
        // A short batch can be undone exactly, including CVAT's source marker.
        // Do not report a failed/partial native undo as an untouched operation.
        let warning = "",
          audited = false;
        try {
          blockUI();
          await job.actions.undo(last.nativeUndoCount);
          const after = await exported();
          if (!equal(after, last.before))
            throw Error(
              "Undo đã chạy nhưng dữ liệu/ID chưa khớp bản trước Apply; kiểm tra CVAT.",
            );
          audited = true;
          await refresh();
        } catch (error) {
          warning = error.message;
        }
        return {
          ok: true,
          undone: audited,
          audited,
          identityPreserved: audited,
          warning,
        };
      }
      const saved = last.before.tracks.find(
        (t) => t.clientID === last.clientID,
      );
      const desired = saved && clone(saved);
      if (!desired) throw Error("Không xác định được track để khôi phục.");
      const edits = await nativeEdits(before, desired);
      const reply = await writeNative(
        before,
        desired,
        edits,
        crypto.randomUUID(),
        true,
      );
      if (reply.applied !== true || !reply.audited)
        return {
          ...reply,
          undone: false,
          warning: "Khôi phục chưa được xác nhận đầy đủ. " + reply.warning,
        };
      return {
        ok: true,
        undone: true,
        audited: true,
        identityPreserved: true,
        warning:
          reply.sourceAfter !== desired.source
            ? "Đã khôi phục hình học/keyframe và giữ ID. CVAT vẫn đánh dấu nguồn annotation là " +
              reply.sourceAfter +
              "."
            : "",
      };
    }
    const original = before.tracks.find(
      (t) => t.clientID === request.baseline?.clientID,
    );
    if (!original || !equal(original, request.baseline))
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
      const x = clone(t);
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
      const s = clone(shape),
        o = clone(old),
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
    // Identity is part of the contract, not excluded from the audit.
    replacement.clientID = original.clientID;
    if (original.uiId !== undefined) replacement.uiId = original.uiId;
    else delete replacement.uiId;
    if (original.id === undefined) delete replacement.id;
    else replacement.id = original.id;
    const edits = await nativeEdits(before, replacement);
    if (!edits.length)
      throw Error("Không có hình học/keyframe nào cần thay đổi.");
    return await writeNative(before, replacement, edits, request.token);
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    releaseUI();
    if (ownsLock && memory) memory.busy = false;
  }
}
