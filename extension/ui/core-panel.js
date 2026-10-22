import { ReconstructionViewer } from "./reconstruction-view.js";
import { manualBoxProposal } from "../reconstruction/box.js";

/** DOM controller for the reconstruction consumer. It has no CVAT, network or
 * storage access; callbacks return control to the existing transaction boundary. */
export class CorePanel {
  constructor($, canvases, callbacks) {
    this.$ = $;
    this.callbacks = callbacks;
    this.core = null;
    this.proposal = null;
    this.hidden = new Set();
    this.viewer = new ReconstructionViewer($("orbit"), canvases, (p) => {
      $("surfaceInfo").textContent =
        `Vùng ${p.id} · frame: ${p.frames.join(", ")} · ${p.frames.length} quan sát · phân tán ${p.spread.toFixed(3)} m · ${p.role === "context" ? "ngữ cảnh" : "chưa phân loại thân/phụ kiện"}`;
    });
    for (const id of [
      "commonX",
      "commonY",
      "commonZ",
      "commonYaw",
      "commonL",
      "commonW",
      "commonH",
    ])
      $(id).oninput = () => {
        this.proposal = null;
        $("showCommonBox").checked = true;
        callbacks.changed();
        this.summary();
        this.render();
      };
    $("useCommonBox").onclick = () => {
      try {
        this.proposal = manualBoxProposal(this.core, this.readBox());
        callbacks.ready();
        this.summary();
        this.render();
      } catch (e) {
        callbacks.error(e.message);
      }
    };
    $("showCommonBox").onchange = () => this.render();
    $("colorBy").onchange = () => this.render();
    $("orbitYaw").oninput = () => {
      this.viewer.yaw = (Number($("orbitYaw").value) * Math.PI) / 180;
      this.viewer.render();
    };
    $("orbitPitch").oninput = () => {
      this.viewer.pitch = (Number($("orbitPitch").value) * Math.PI) / 180;
      this.viewer.render();
    };
    $("resetOrbit").onclick = () => {
      this.viewer.yaw = -0.65;
      this.viewer.pitch = 0.5;
      this.viewer.zoom = 1;
      this.viewer.render();
    };
    $("excludeFrame").onclick = () => this.rebuild("exclude");
    $("anchorFrame").onclick = () => this.rebuild("pin");
    $("referenceFrame").onclick = () => this.rebuild("reference");
  }
  readBox() {
    return [
      Number(this.$("commonX").value),
      Number(this.$("commonY").value),
      Number(this.$("commonZ").value),
      0,
      0,
      (Number(this.$("commonYaw").value) * Math.PI) / 180,
      Number(this.$("commonL").value),
      Number(this.$("commonW").value),
      Number(this.$("commonH").value),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
  }
  set(core) {
    this.core = core;
    this.proposal = null;
    this.hidden.clear();
    const p = core.poses.find((p) => p.frame === core.reference.frame).original;
    for (const [id, value] of [
      ["commonX", 0],
      ["commonY", 0],
      ["commonZ", 0],
      ["commonYaw", 0],
      ["commonL", p[6]],
      ["commonW", p[7]],
      ["commonH", p[8]],
    ])
      this.$(id).value = value;
    this.$("showCommonBox").checked = false;
    this.$("surfaceInfo").textContent =
      "Bấm điểm trong hình 3D để xem frame đóng góp. Kéo để xoay, cuộn để phóng to.";
    this.$("view").replaceChildren(new Option("Bề mặt chung", "fused"));
    for (const p of core.poses)
      this.$("view").append(
        new Option(`Frame ${p.frame} · ${p.status}`, String(p.frame)),
      );
    this.table();
    this.summary();
    this.render();
  }
  table() {
    const $ = this.$,
      row = document.createElement("tr");
    for (const name of [
      "Hiện / Frame",
      "Điểm crop",
      "Dịch (m)",
      "Sai lệch kiểm tra (m)",
      "Ràng buộc tư thế",
      "Trạng thái",
    ]) {
      const th = document.createElement("th");
      th.textContent = name;
      row.append(th);
    }
    $("columns").replaceChildren(row);
    $("rows").replaceChildren();
    for (const p of this.core.poses) {
      const tr = document.createElement("tr"),
        first = document.createElement("td"),
        label = document.createElement("label"),
        check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      label.className = "check";
      label.append(check, document.createTextNode(String(p.frame)));
      first.append(label);
      tr.append(first);
      check.onchange = () => {
        check.checked ? this.hidden.delete(p.frame) : this.hidden.add(p.frame);
        this.render();
      };
      for (const value of [
        this.core.observations.find((f) => f.frame === p.frame).xyz.length / 3,
        p.shift.toFixed(3),
        p.holdout.rmse === null ? "—" : p.holdout.rmse.toFixed(3),
        p.pinned ? "mốc" : `${p.rank ?? 0}/4`,
        p.status === "anchor"
          ? "Mốc theo pre-label"
          : p.trusted
            ? "Căn được"
            : "Chưa xác định",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      tr.title = p.reason;
      tr.onclick = (e) => {
        if (e.target === check) return;
        $("view").value = String(p.frame);
        this.render();
      };
      $("rows").append(tr);
    }
  }
  render() {
    if (!this.core) return;
    const $ = this.$,
      view = $("view").value,
      p = this.core.poses.find((p) => String(p.frame) === view);
    let box = null;
    try {
      if ($("showCommonBox").checked) box = this.readBox();
    } catch {}
    this.viewer.set(this.core, view, {
      context: $("showRejected").checked,
      colorBy: $("colorBy").value,
      hiddenFrames: [...this.hidden],
      box,
    });
    $("viewHint").textContent =
      `Hệ vật thể chung theo mốc frame ${this.core.reference.frame}. ${p ? p.reason : "Bề mặt đo được từ các frame căn được; phần chỉ thấy một lần vẫn được giữ."} Không tự hoàn thiện phần khuất hoặc tự loại gương.`;
    $("excludeFrame").disabled = !p;
    $("anchorFrame").disabled = !p;
    $("referenceFrame").disabled = !p;
  }
  // Keep redraws separate from status updates: resizing/orbiting must never
  // overwrite an Apply outcome or an error raised by the transaction boundary.
  summary() {
    if (!this.core) return;
    const $ = this.$;
    $("summary").textContent =
      `LÕI DỰNG HÌNH — CHƯA APPLY\n${this.core.diagnostics.trusted}/${this.core.diagnostics.total} frame nối được về mốc · ${this.core.surfaces.length}/${this.core.diagnostics.totalCells} ô bề mặt đang giữ.\n${this.core.diagnostics.singleFrameCells} ô chỉ có một frame quan sát. Vai trò thân xe/phụ kiện còn chưa xác định.\n${this.proposal ? "Đã tạo đề xuất từ box bạn chỉnh; kiểm tra từng frame trước Apply." : "Chưa tạo box tự động. Có thể bật box chung chỉnh tay ở cột bên trái."}`;
    $("summary").className = "summary success";
  }
  rebuild(action) {
    const frame = Number(this.$("view").value);
    if (!Number.isInteger(frame)) return;
    const excluded = new Set(this.core.config.excludedFrames || []),
      pinned = new Set(this.core.config.pinnedFrames || []);
    let reference = this.core.reference.frame;
    if (action === "exclude") {
      excluded.has(frame) ? excluded.delete(frame) : excluded.add(frame);
      pinned.delete(frame);
      if (reference === frame) reference = undefined;
    }
    if (action === "pin") {
      pinned.has(frame) ? pinned.delete(frame) : pinned.add(frame);
      excluded.delete(frame);
    }
    if (action === "reference") {
      reference = frame;
      excluded.delete(frame);
    }
    this.callbacks.rebuild({
      referenceFrame: reference,
      excludedFrames: [...excluded],
      pinnedFrames: [...pinned],
    });
  }
}
