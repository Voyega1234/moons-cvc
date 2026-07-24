import { useMemo, useState, type FormEvent } from "react";
import { ArrowRight, LockKey, UserSwitch, X } from "@phosphor-icons/react";
import {
  canEditRun,
  departmentLabel
} from "../../domain/run-collaboration";
import { useRunCollaboration } from "../../app/providers/run-collaboration-provider";
import { useWorkspace } from "../../app/providers/workspace-provider";

export function RunOwnershipBar({
  runId,
  busy = false,
  completed = false
}: {
  runId: string;
  busy?: boolean;
  completed?: boolean;
}) {
  const {
    enabled,
    currentUserId,
    members,
    ownershipByRunId,
    ownershipReady,
    loading,
    error,
    handoff,
    refresh
  } = useRunCollaboration();
  const { flush } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const ownership = ownershipByRunId[runId] ?? null;
  const editable = ownershipReady && canEditRun(ownership, currentUserId);
  const owner = members.find(
    (member) => member.userId === ownership?.currentOwnerUserId
  );
  const currentMember = members.find(
    (member) => member.userId === currentUserId
  );
  const canHandoff =
    ownershipReady && (editable || Boolean(currentMember?.isAdmin));
  const availableMembers = useMemo(
    () =>
      members.filter(
        (member) => member.userId !== ownership?.currentOwnerUserId
      ),
    [members, ownership?.currentOwnerUserId]
  );
  const selectedMember = availableMembers.find(
    (member) => member.userId === toUserId
  );

  if (!enabled) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownership || !toUserId || pending) return;
    setPending(true);
    setHandoffError(null);
    setSuccess(null);
    try {
      await flush();
      const latestOwnerships = await refresh();
      const latestOwnership =
        latestOwnerships.find((item) => item.workspaceRunId === runId) ??
        ownership;
      await handoff({
        workspaceRunId: runId,
        toUserId,
        expectedVersion: latestOwnership.version,
        note
      });
      setSuccess(
        `Project sent to ${selectedMember?.displayName ?? "the new owner"}.`
      );
      setOpen(false);
      setToUserId("");
      setNote("");
    } catch (caught) {
      setHandoffError(
        caught instanceof Error ? caught.message : "Could not hand off project."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section className={`compass-ownership-bar ${editable ? "owner" : "viewer"}`}>
        <span className="compass-ownership-icon" aria-hidden="true">
          {editable ? <UserSwitch size={18} /> : <LockKey size={18} />}
        </span>
        <span className="compass-ownership-copy">
          <small>{editable ? "You can edit" : "View only"}</small>
          <b>
            {!ownershipReady
              ? loading
                ? "Loading project owner"
                : "Project ownership unavailable"
              : loading && !ownership
              ? "Loading project owner"
              : owner
                ? `${owner.displayName} · ${departmentLabel(owner.department)}`
                : ownership
                  ? "Assigned team member"
                  : "You own this new project"}
          </b>
        </span>
        {ownership ? (
          <span className="compass-ownership-version">Version {ownership.version}</span>
        ) : null}
        {canHandoff && ownership && !completed ? (
          <button
            className="btn small"
            type="button"
            disabled={!availableMembers.length || busy}
            title={busy ? "Wait for generation to finish before handing off." : undefined}
            onClick={() => {
              setOpen(true);
              setSuccess(null);
              setHandoffError(null);
            }}
          >
            {busy
              ? "Work in progress"
              : editable
                ? "Send work"
                : "Reassign owner"}
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
        {error ? <small className="compass-ownership-error">Handoff unavailable</small> : null}
        {success ? <small className="compass-ownership-success">{success}</small> : null}
      </section>

      {open ? (
        <div className="output-modal-backdrop compass-handoff-backdrop" role="presentation">
          <form
            className="output-modal compass-handoff-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="handoff-title"
            onSubmit={submit}
          >
            <div className="output-modal-head">
              <div>
                <small>Single-owner handoff</small>
                <h3 id="handoff-title">Send this project</h3>
              </div>
              <button
                type="button"
                aria-label="Close handoff"
                onClick={() => setOpen(false)}
              >
                <X size={18} weight="bold" aria-hidden="true" />
              </button>
            </div>
            <label>
              New owner
              <select
                required
                value={toUserId}
                onChange={(event) => setToUserId(event.target.value)}
              >
                <option value="">Choose a team member</option>
                {availableMembers.map((member) => (
                  <option value={member.userId} key={member.userId}>
                    {member.displayName} · {departmentLabel(member.department)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Handoff note <small>Optional</small>
              <textarea
                value={note}
                maxLength={1000}
                placeholder="What should the next owner know?"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <p>
              After sending, you can still view this project, but only the new
              owner can edit it.
            </p>
            {handoffError ? <p className="repository-message error">{handoffError}</p> : null}
            <div className="output-modal-actions">
              <button className="btn ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={!toUserId || pending}>
                {pending
                  ? "Sending..."
                  : selectedMember
                    ? `Send to ${departmentLabel(selectedMember.department)}`
                    : "Send project"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
