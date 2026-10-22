/** Controller-side write boundary, dependency-injected for tests and adapters.
 * Backup persistence MUST succeed before a mutation is sent. Do not retry on a
 * transport error: CVAT may already have edited one or more frames before the response failed. */
export async function applyProposal({
  call,
  storage,
  baseline,
  proposal,
  onBackup = () => {},
  token = crypto.randomUUID(),
}) {
  const pre = await call({ op: "preflight", baseline });
  const backup = {
    format: "cvat-track-refiner-backup/v1",
    context: pre.context,
    savedAt: new Date().toISOString(),
    data: pre.before,
  };
  onBackup(backup);
  const key = `track-refiner-backup:${pre.context.origin}${pre.context.prefix}:${pre.context.jobId}`;
  await storage.set({ [key]: backup });
  const reply = await call({
    op: "apply",
    baseline,
    track: proposal.track,
    range: proposal.range,
    backup: pre.before,
    backupStored: true,
    token,
  });
  return { reply, backup };
}
