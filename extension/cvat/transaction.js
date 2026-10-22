/** Persistent write boundary. A write-once pre-image and a PREPARED journal
 * must survive a storage read-back before any native edit is requested.
 * Unresolved attempts block another Apply. Never retry an ambiguous write. */
const stable = (v) =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + stable(v[k]))
          .join(",")}}`
      : JSON.stringify(v);
export const recoveryPrefix = (context) =>
  `track-refiner-recovery-v2:${context.origin}${context.prefix}:${context.jobId}:`;
/** Enforce the last known saved identity across panel closure/page reload.
 * Added/deleted objects require explicit review, never an implicit new baseline. */
export function checkPreviousIdentity(entries, prefix, identity) {
  const last = Object.entries(entries)
    .filter(
      ([key, v]) =>
        key.startsWith(prefix + "journal:") &&
        ["complete", "restored"].includes(v.status),
    )
    .map(([, v]) => v)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  if (!last) return;
  if (stable(last.identity.serverOrder) !== stable(identity.serverOrder))
    throw Error(
      "ID/thứ tự server đổi kể từ lần Apply đã lưu log. Chỉ xem trước; cần đối chiếu trước khi sửa tiếp.",
    );
  const nativeOrder = identity.nativeOrder || identity.order;
  if (
    last.identity.nativeOrder &&
    nativeOrder &&
    stable(last.identity.nativeOrder) !== stable(nativeOrder)
  )
    throw Error(
      "Client ID/thứ tự trong phiên đã đổi kể từ lần Apply. Chỉ xem trước; cần đối chiếu.",
    );
  const keys = new Map(
    (identity.serverKeyIDs || []).map(([track, frame, id]) => [
      track + ":" + frame,
      id,
    ]),
  );
  if (
    (last.identity.serverKeyIDs || []).some(
      ([track, frame, id]) => keys.get(track + ":" + frame) !== id,
    )
  )
    throw Error(
      "ID keyframe cũ đã đổi/mất kể từ lần Apply. Chỉ xem trước; cần đối chiếu.",
    );
}
export async function applyProposal({
  call,
  storage,
  baseline,
  proposal,
  onBackup = () => {},
  token = crypto.randomUUID(),
  apiBase = "",
}) {
  const pre = await call({ op: "preflight", baseline, apiBase });
  const prefix = recoveryPrefix(pre.context),
    entries = await storage.get(null);
  checkPreviousIdentity(entries, prefix, pre.identity);
  const unresolved = Object.entries(entries).filter(
    ([key, value]) =>
      key.startsWith(prefix + "journal:") &&
      !["complete", "restored"].includes(value.status),
  );
  if (unresolved.length)
    throw Error(
      "Có lần Apply chưa được xác minh/đã bị khóa. Chỉ xem trước và lấy log; không sửa tiếp.",
    );
  const backupKey = prefix + "before:" + token,
    journalKey = prefix + "journal:" + token;
  if (entries[backupKey] || entries[journalKey])
    throw Error("Token đã có dữ liệu; không gửi lại Apply.");
  const backup = {
    format: "cvat-track-refiner-backup/v1",
    context: pre.context,
    savedAt: new Date().toISOString(),
    data: pre.before,
  };
  onBackup(backup);
  const legacy = `track-refiner-backup:${pre.context.origin}${pre.context.prefix}:${pre.context.jobId}`;
  const journal = {
    format: "cvat-track-refiner-journal/v2",
    token,
    status: "prepared",
    context: pre.context,
    savedAt: backup.savedAt,
    backupKey,
    clientID: baseline.clientID,
    serverID: baseline.id,
    range: proposal.range,
    identity: pre.identity,
  };
  const writes = { [backupKey]: backup, [journalKey]: journal };
  // Preserve the earlier recovery copy forever. Never rotate/delete snapshots
  // automatically to work around a storage quota failure.
  if (!entries[legacy]) writes[legacy] = backup;
  await storage.set(writes);
  const stored = await storage.get(Object.keys(writes));
  if (
    Object.keys(writes).some(
      (key) => stable(stored[key]) !== stable(writes[key]),
    )
  )
    throw Error("Không xác minh được backup/log đã lưu; chưa sửa.");
  let reply;
  try {
    reply = await call({
      op: "apply",
      baseline,
      track: proposal.track,
      range: proposal.range,
      backup: pre.before,
      backupStored: true,
      token,
      receipt: pre.receipt,
    });
  } catch (error) {
    // PREPARED remains persistent, so reopening the panel cannot silently
    // repeat a request whose result was lost in transit.
    throw Error(
      "Chưa xác định kết quả Apply. Không thử lại; backup/log đã giữ. " +
        error.message,
    );
  }
  const status = reply.quarantined
    ? "quarantined"
    : reply.applied === true && reply.audited
      ? "complete"
      : "partial";
  const result = {
    ...journal,
    status,
    finishedAt: new Date().toISOString(),
    result: reply,
  };
  try {
    await storage.set({ [journalKey]: result });
  } catch (error) {
    reply = {
      ...reply,
      warning: [
        reply.warning,
        "Không ghi được log kết quả; bản trước Apply vẫn giữ. " + error.message,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return { reply, backup, journalKey };
}
export async function markRestored(storage, journalKey, reply) {
  if (!journalKey || !reply.undone || !reply.audited) return;
  const record = (await storage.get(journalKey))[journalKey];
  if (record)
    await storage.set({
      [journalKey]: {
        ...record,
        status: "restored",
        restoredAt: new Date().toISOString(),
        restoreResult: reply,
      },
    });
}
