import { CorePanel } from "./ui/core-panel.js";
import { makeReconstructionDemo } from "./demo/reconstruction.js";
import { reconstructionSnapshot } from "./core/diagnostics.js";
import { cvatBridge } from "./cvat/bridge.js";
import { validateTrack, clone, sampleFrames } from "./core/geometry.js";
import { settings } from "./core/config.js";
import { buildDraft } from "./core/draft.js";
import { analysisReport, diagnosticBundle } from "./core/diagnostics.js";
import { holdsGeometry } from "./fitting/validation.js";
import { drawPreview } from "./ui/preview.js";
import { makeDemo } from "./demo/generate.js";
import { makeClutteredTrack } from "./demo/clutter.js";
import { applyProposal } from "./cvat/transaction.js";

const $ = (id) => document.getElementById(id),
  tabId = Number(new URL(location.href).searchParams.get("tab"));
let session = null,
  result = null,
  baseline = null,
  busy = false,
  demo = null,
  worker = null,
  pending = new Map(),
  requestID = 0,
  generation = 0,
  consumed = true,
  backup = null,
  canUndo = false;
const canvases = [...document.querySelectorAll(".canvases canvas")];
const corePanel = new CorePanel($, canvases, {
  changed: () => {
    consumed = true;
    renderDraft();
    controls();
  },
  ready: () => {
    consumed = false;
    renderDraft();
    controls();
  },
  error: (message) => show(message, "error"),
  rebuild: (options) => run(() => rebuildCore(options)),
});
const isCore = () => result?.kind === "reconstruction";
const activeProposal = () => (isCore() ? corePanel.proposal : result);
function modeUI() {
  const core = $("mode").value === "core";
  $("legacyOptions").hidden = core;
  $("legendLegacy").hidden = core;
  $("coreView").hidden = !isCore();
  $("coreEditor").hidden = !isCore();
  $("rejectedText").textContent = core
    ? "Hiện điểm ngữ cảnh (xám)"
    : "Hiện điểm bị loại (xám)";
}
function show(text, type = "") {
  $("summary").textContent = text;
  $("summary").className = "summary " + type;
}
function controls() {
  for (const id of [
    "mode",
    "read",
    "demo",
    "demoGhost",
    "track",
    "start",
    "end",
    "maxFrames",
    "margin",
    "shift",
    "yaw",
    "api",
    "useSize",
    "usePose",
  ])
    $(id).disabled = busy;
  $("analyze").disabled = busy || !session;
  $("cancel").disabled = !busy || !worker;
  $("apply").disabled =
    busy ||
    !!demo ||
    !activeProposal()?.applicable ||
    consumed ||
    (!isCore() && !($("useSize").checked || $("usePose").checked));
  $("undo").disabled = busy || !!demo || !canUndo;
  $("backup").disabled = !backup;
  $("report").disabled = !result;
  $("diagnostic").disabled = !result;
  for (const id of [
    "snapshot",
    "useCommonBox",
    "commonX",
    "commonY",
    "commonZ",
    "commonYaw",
    "commonL",
    "commonW",
    "commonH",
    "showCommonBox",
  ])
    $(id).disabled = busy || !isCore();
  for (const id of ["excludeFrame", "anchorFrame", "referenceFrame"])
    $(id).disabled = busy || !isCore() || $("view").value === "fused";
  modeUI();
}
async function run(action) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await action();
  } catch (e) {
    show(e.message, "error");
    $("status").textContent = "Dừng. Đọc thông báo trước khi tiếp tục.";
  } finally {
    busy = false;
    $("progress").hidden = true;
    controls();
  }
}
async function bridge(request, context = session?.context) {
  if (!globalThis.chrome?.scripting || !Number.isInteger(tabId) || !tabId)
    throw Error(
      "Cài extension trên Brave/Chrome và mở từ biểu tượng tại tab CVAT, hoặc chọn dữ liệu mẫu.",
    );
  const response = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: cvatBridge,
    args: [{ ...request, context }],
  });
  const reply = response[0]?.result;
  if (!reply?.ok)
    throw Error(
      reply?.error || "Không nhận được phản hồi. Mở lại extension từ tab CVAT.",
    );
  return reply;
}
function stopWorker() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values())
    p.reject(Error("Đã dừng phân tích. Chưa Apply."));
  pending.clear();
}
function newWorker() {
  stopWorker();
  worker = new Worker(new URL("./workers/fit-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (data.progress) {
      if (
        ["normals", "bootstrap", "registration"].includes(data.progress.stage)
      ) {
        $("status").textContent =
          data.progress.stage === "normals"
            ? `Ước lượng bề mặt ${data.progress.current}/${data.progress.total}…`
            : data.progress.stage === "bootstrap"
              ? `Nối frame ${data.progress.current} về mốc…`
              : `Căn bề mặt vòng ${data.progress.round} · ${data.progress.current}/${data.progress.total}…`;
        return;
      }
      $("status").textContent =
        data.progress.stage === "consensus"
          ? "Đang kiểm tra điểm được nhiều frame hỗ trợ…"
          : `Tinh chỉnh vòng ${data.progress.round}/${data.progress.total}…`;
      return;
    }
    const p = pending.get(data.id);
    if (p) {
      pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values())
      p.reject(Error(e.message || "Không khởi động được worker."));
    pending.clear();
  };
}
function work(op, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++requestID;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, ...payload }, transfer);
  });
}
function invalidate() {
  result = null;
  corePanel.core = null;
  corePanel.proposal = null;
  consumed = true;
  $("rows").replaceChildren();
  $("view").replaceChildren(new Option("Ghép nhiều frame", "fused"));
  $("draft").textContent = "Phân tích lại với lựa chọn hiện tại.";
  for (const canvas of canvases)
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  show("Lựa chọn đã đổi. Bấm Phân tích để tạo đề xuất mới.");
  controls();
}
function selected() {
  return session?.annotations.tracks.find(
    (t) => t.clientID === Number($("track").value),
  );
}
function pickTrack() {
  invalidate();
  const t = selected();
  if (!t) return;
  $("start").value = Math.max(
    session.start,
    Math.min(...t.shapes.map((s) => s.frame)),
  );
  $("end").value = session.end;
}
function renderSession() {
  $("track").replaceChildren();
  for (const t of session.annotations.tracks.filter(
    (t) => t.shapes?.length && t.shapes.every((s) => s.type === "cuboid"),
  )) {
    const label =
      session.labels.find((l) => l.id === t.label_id)?.name ||
      `label ${t.label_id}`;
    $("track").append(
      new Option(
        `CVAT #${t.clientID} · ${label} · ${t.shapes.length} key`,
        String(t.clientID),
      ),
    );
  }
  if ([...$("track").options].some((o) => o.value === String(session.activeID)))
    $("track").value = String(session.activeID);
  $("context").textContent = demo
    ? "DỮ LIỆU MẪU · không kết nối CVAT"
    : `Job ${session.context.jobId} · frame ${session.start}–${session.end}`;
  $("autosave").textContent = demo
    ? "Dữ liệu tổng hợp; Apply bị khóa."
    : `Auto save: ${session.autoSave === true ? "BẬT — sau Apply, CVAT có thể tự lưu trước khi bạn kiểm tra" : session.autoSave === false ? "TẮT — bạn tự Save sau khi kiểm tra" : "chưa xác định — CVAT có thể tự lưu nếu được cấu hình"}. Native Commit có thể đổi ID; Undo/Redo qua CVAT.`;
  pickTrack();
  $("status").textContent = "Đã đọc dữ liệu. Phân tích chưa sửa annotation.";
}
async function read() {
  demo = null;
  session = await bridge({ op: "snapshot" }, null);
  canUndo = false;
  renderSession();
  show(
    "Chọn track và khoảng frame rồi Phân tích. Các sửa chưa Save được đọc từ phiên CVAT.",
  );
}
function config() {
  return settings({
    maxFrames: Number($("maxFrames").value),
    cropMargin: Number($("margin").value),
    maxShift: Number($("shift").value),
    maxYaw: (Number($("yaw").value) * Math.PI) / 180,
  });
}
function range() {
  const a = Number($("start").value),
    b = Number($("end").value);
  if (
    !$("start").value ||
    !$("end").value ||
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < session.start ||
    b > session.end ||
    b < a ||
    b - a >= 1200
  )
    throw Error("Chọn khoảng hợp lệ trong job, tối đa 1200 frame.");
  return [a, b];
}
function draft() {
  return buildDraft(baseline, activeProposal(), range(), {
    size: isCore() || $("useSize").checked,
    pose: isCore() || $("usePose").checked,
    jobStart: session.start,
    jobEnd: session.end,
  });
}
function renderDraft() {
  if (isCore() && !corePanel.proposal) {
    $("draft").textContent =
      "Lõi chưa tạo box. Có thể chỉnh box chung rồi bấm tạo đề xuất; frame chưa căn được sẽ giữ nguyên.";
    controls();
    return;
  }
  if (!activeProposal()?.applicable) {
    $("draft").textContent = "Chưa có đề xuất đủ bằng chứng.";
    return;
  }
  try {
    const d = draft();
    $("draft").textContent =
      `${d.changed} frame thay đổi · thêm ${d.newKeys} keyframe · ${d.inferred} frame có tâm/góc nội suy giữa mẫu.`;
  } catch (e) {
    $("draft").textContent = e.message;
  }
  controls();
}
function renderResult() {
  if (isCore()) {
    corePanel.set(result);
    modeUI();
    renderDraft();
    return;
  }
  const head = document.createElement("tr");
  for (const label of [
    "Frame",
    "Điểm giữ/tổng",
    "Dịch (m)",
    "Góc (°)",
    "Kết quả",
  ]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  $("columns").replaceChildren(head);
  $("view").replaceChildren(new Option("Ghép nhiều frame", "fused"));
  $("rows").replaceChildren();
  for (const f of result.frames) {
    $("view").append(new Option(`Frame ${f.frame}`, String(f.frame)));
    const tr = document.createElement("tr");
    for (const v of [
      f.frame,
      `${f.xyz.length / 3}/${(f.rawXYZ || f.xyz).length / 3}`,
      (f.shift || 0).toFixed(3),
      (((f.yaw || 0) * 180) / Math.PI).toFixed(2),
      f.accepted ? "Qua kiểm tra box cuối" : "Giữ nguyên box pre-label",
    ]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    tr.title = f.reason || "";
    tr.onclick = () => {
      $("view").value = String(f.frame);
      renderPreview();
    };
    $("rows").append(tr);
  }
  const good = result.frames.filter((f) => f.accepted).length;
  show(
    result.applicable
      ? `ĐỀ XUẤT — CHƯA APPLY\nL / W / H: ${result.size.map((v) => v.toFixed(3)).join(" / ")} m\nChiều có đủ bằng chứng: ${["L", "W", "H"].filter((_, j) => result.measuredAxes[j]).join(", ")}. Chiều còn lại giữ pre-label từng frame.\n${good}/${result.frames.length} frame mẫu qua kiểm tra; các frame khác giữ nguyên box. Frame chưa lấy mẫu vẫn cần kiểm tra.\n${result.warnings.join("\n")}`
      : result.reason,
    result.applicable ? "success" : "error",
  );
  renderDraft();
  renderPreview();
}
function renderPreview() {
  if (isCore()) {
    corePanel.render();
    return;
  }
  if (result) {
    drawPreview(canvases, result, $("view").value, {
      size: $("useSize").checked,
      pose: $("usePose").checked,
      showRejected: $("showRejected").checked,
    });
    const selectedFrame = result.frames.find(
      (f) => String(f.frame) === $("view").value,
    );
    $("viewHint").textContent =
      $("view").value === "fused"
        ? `Chỉ ghép điểm được chấp nhận, màu theo frame. Hai box lấy từ frame ${result.referenceFrame ?? "tham chiếu"}, giữ chênh lệch tâm/góc thực. Điểm bị loại: xám khi bật.`
        : "Điểm và hai box trong trục pre-label của frame này. Cam: gốc; xanh: đề xuất. Điểm bị loại: xám khi bật; màu khác là điểm giữ lại.";
    if (
      selectedFrame &&
      holdsGeometry(selectedFrame, {
        size: $("useSize").checked,
        pose: $("usePose").checked,
      })
    )
      $("viewHint").textContent +=
        " Giữ nguyên box ở lựa chọn hiện tại: " + selectedFrame.reason;
  }
}
async function analyze() {
  invalidate();
  const c = config(),
    r = range(),
    t = selected();
  validateTrack(t);
  baseline = clone(t);
  result = null;
  consumed = true;
  const frames = sampleFrames(t, ...r, c.maxFrames);
  if (frames.length < 3)
    throw Error("Cần ít nhất 3 frame visible trong khoảng.");
  const gen = ++generation;
  newWorker();
  controls();
  try {
    await work("init", {
      mode: $("mode").value,
      track: baseline,
      others: session.annotations.tracks.filter(
        (x) =>
          x.clientID !== t.clientID &&
          x.shapes?.every((s) => s.type === "cuboid"),
      ),
      config: c,
    });
    $("progress").hidden = false;
    $("progress").max = frames.length;
    $("progress").value = 0;
    if (demo) {
      await work("demoFrames", {
        frames: demo.frames.filter((f) => frames.includes(f.frame)),
      });
    } else
      for (let i = 0; i < frames.length; i++) {
        $("status").textContent =
          `Đọc và lọc point cloud ${i + 1}/${frames.length} · frame ${frames[i]}…`;
        const cloud = await bridge({
          op: "cloud",
          frame: frames[i],
          apiBase: $("api").value.trim(),
        });
        if (gen !== generation) throw Error("Đã dừng phân tích.");
        const bytes = Uint8Array.from(atob(cloud.base64), (ch) =>
          ch.charCodeAt(0),
        );
        const stats = await work(
          "ingest",
          { frame: frames[i], buffer: bytes.buffer },
          [bytes.buffer],
        );
        $("progress").value = i + 1;
        $("status").textContent =
          `Frame ${frames[i]}: giữ ${stats.kept}/${stats.raw} điểm.`;
      }
    $("status").textContent = "Đang ghép và tinh chỉnh…";
    $("progress").removeAttribute("value");
    result = await work("analyze", {
      options:
        $("mode").value === "core"
          ? { referenceFrame: demo?.referenceFrame }
          : undefined,
    });
    if (gen !== generation) throw Error("Đã dừng phân tích.");
    result.range = r;
    result.config = isCore() ? result.config : c;
    consumed = isCore();
    renderResult();
    $("status").textContent = demo
      ? "Phân tích mẫu xong. Không có annotation thật nào bị sửa."
      : "Phân tích xong. Xem từng frame trước khi Apply.";
  } finally {
    stopWorker();
  }
}
function download(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("read").onclick = () => run(read);
function loadDemo(clutter = false) {
  return run(async () => {
    demo = clutter
      ? makeClutteredTrack()
      : $("mode").value === "core"
        ? makeReconstructionDemo()
        : makeDemo();
    session = {
      annotations: { tracks: [demo.track], shapes: [], tags: [] },
      labels: [{ id: 1, name: "Xe mẫu" }],
      activeID: 1,
      start: 0,
      end: demo.frames.length - 1,
    };
    canUndo = false;
    renderSession();
    show(
      $("mode").value === "core"
        ? "MẪU DỰNG HÌNH\nBấm Phân tích để căn bề mặt. Không có box đo từ rìa điểm; box chung chỉ xuất hiện khi bạn bật chỉnh tay. Apply bị khóa trong mẫu."
        : clutter
          ? "MẪU CÓ ĐIỂM NGOÀI\nPre-label gần đúng; frame 8 có cụm ngoài và dải nối thấp. Bấm Phân tích, chọn frame 8 rồi bật điểm bị loại để kiểm tra. Apply bị khóa."
          : "DỮ LIỆU MẪU\nBox ban đầu nhỏ, lệch tâm và góc. Bấm Phân tích để xem thuật toán đề xuất. Apply bị khóa.",
    );
  });
}
$("demo").onclick = () => loadDemo();
$("demoGhost").onclick = () => loadDemo(true);
$("mode").onchange = () => {
  invalidate();
  modeUI();
};
$("track").onchange = pickTrack;
for (const id of ["start", "end", "maxFrames", "margin", "shift", "yaw", "api"])
  $(id).oninput = invalidate;
for (const id of ["useSize", "usePose"])
  $(id).onchange = () => {
    renderDraft();
    renderPreview();
  };
$("view").onchange = renderPreview;
$("showRejected").onchange = renderPreview;
$("analyze").onclick = () => run(analyze);
$("cancel").onclick = () => {
  generation++;
  stopWorker();
  if (!demo) bridge({ op: "abort" }).catch(() => {});
  $("status").textContent = "Đã yêu cầu dừng; chưa Apply.";
};
$("apply").onclick = () =>
  run(async () => {
    if (demo || consumed || !activeProposal()?.applicable)
      throw Error("Cần phân tích mới.");
    const proposal = draft();
    if (!proposal.changed) throw Error("Không có thay đổi để Apply.");
    // Invalidate BEFORE sending: even a transport error must not replay a commit.
    consumed = true;
    canUndo = false;
    controls();
    const { reply } = await applyProposal({
      call: bridge,
      storage: chrome.storage.local,
      baseline,
      proposal,
      onBackup: (value) => {
        backup = value;
      },
    });
    canUndo = reply.canUndo;
    if (reply.applied !== true) {
      show("CHƯA XÁC ĐỊNH KẾT QUẢ APPLY\n" + reply.warning, "error");
      $("status").textContent =
        "Đề xuất đã khóa để tránh gửi lặp. Kiểm tra CVAT và backup.";
      return;
    }
    show(
      `ĐÃ APPLY VÀO PHIÊN CVAT\nCVAT ID mới: ${reply.clientID ?? "xem sidebar"}\n${reply.audited ? `Đã đối chiếu ${reply.otherTracks} track khác cùng shapes/tags.` : "Chưa xác nhận được dữ liệu sau Apply; kiểm tra cảnh báo."}\n${reply.autoSave === false ? "Tool không gọi Save server. Kiểm tra bằng Next và tự Save khi muốn." : "Auto save đang bật hoặc chưa xác định: CVAT có thể tự lưu."}\n${reply.warning || "Dùng Undo/Redo của CVAT hoặc nút hoàn tác khi chưa sửa tiếp."}`,
      reply.warning ? "error" : "success",
    );
    $("status").textContent =
      "Đề xuất đã dùng; đọc lại job trước lần phân tích mới.";
  });
$("undo").onclick = () =>
  run(async () => {
    const r = await bridge({ op: "undo" });
    canUndo = false;
    show(
      r.warning ||
        "Đã Undo Apply gần nhất trong phiên CVAT. Auto save/Save vẫn thuộc CVAT.",
      r.warning ? "error" : "success",
    );
  });
$("backup").onclick = () =>
  backup &&
  download(
    `cvat-track-refiner-job-${backup.context.jobId}-before.json`,
    backup,
  );
async function rebuildCore(options) {
  if (!isCore()) return;
  const observations = result.observations,
    c = result.config,
    r = result.range,
    gen = ++generation;
  consumed = true;
  newWorker();
  controls();
  try {
    await work("init", {
      mode: "core",
      track: baseline,
      config: c,
      others: [],
    });
    await work("demoFrames", { frames: observations });
    const next = await work("analyze", { options: { ...c, ...options } });
    if (gen !== generation) throw Error("Đã dừng dựng hình.");
    result = next;
    result.range = r;
    renderResult();
    $("status").textContent =
      "Đã dựng lại bằng crop đang giữ; chưa sửa annotation.";
  } finally {
    stopWorker();
  }
}
$("snapshot").onclick = () =>
  isCore() &&
  download(
    "cvat-reconstruction-snapshot.json",
    reconstructionSnapshot(result, {
      hiddenFrames: [...corePanel.hidden],
      commonBox: corePanel.proposal?.commonBox || corePanel.readBox(),
      showCommonBox: $("showCommonBox").checked,
      manualProposalReady: !!corePanel.proposal,
    }),
  );
$("report").onclick = () =>
  result && download("track-refiner-analysis.json", analysisReport(result));
$("diagnostic").onclick = () =>
  result &&
  download("track-refiner-crop-diagnostic.json", diagnosticBundle(result));
new ResizeObserver(renderPreview).observe(document.querySelector(".results"));
window.addEventListener("pagehide", () => {
  stopWorker();
  if (busy && !demo) bridge({ op: "abort" }).catch(() => {});
});
controls();
