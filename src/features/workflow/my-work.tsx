import { useMemo, useState, type Dispatch } from "react";
import {
  ArrowRight,
  CheckCircle,
  ClockCountdown,
  Eye,
  Package
} from "@phosphor-icons/react";
import type { Brand } from "../../domain/brand";
import type { ApprovalRole } from "../../domain/creative-run";
import { BrandLogo } from "../../shared/components/brand-logo";
import { useBrands } from "../../app/providers/brand-provider";
import { useOptionalRunCollaboration } from "../../app/providers/run-collaboration-provider";
import { stages } from "./config";
import type {
  WorkspaceAction,
  WorkspaceState,
  WorkflowState
} from "./model";

type WorkQueue = "review" | "waiting" | "ready";
type WorkFilter = "all" | WorkQueue;
const REVIEW_PAGE_SIZE = 5;

interface MyWorkItem {
  run: WorkflowState;
  brand: Brand;
  queue: WorkQueue;
  title: string;
  stageLabel: string;
  detail: string;
  updatedLabel: string;
  assetCount: number;
}

const taskCopy: Record<
  WorkflowState["stage"],
  { title: string; detail: string }
> = {
  start: {
    title: "Complete project setup",
    detail: "Choose the brand and confirm the source material."
  },
  brief: {
    title: "Review brief and offer",
    detail: "Confirm the inputs Creative Compass should use."
  },
  directions: {
    title: "Choose creative hooks",
    detail: "Select the ideas that should move into production."
  },
  studio: {
    title: "Review creative build",
    detail: "Check the generated artwork and copy before QC."
  },
  approval: {
    title: "Internal QC review",
    detail: "Review artwork quality and route the next decision."
  },
  client: {
    title: "Client review",
    detail: "Review feedback, approvals, and requested changes."
  },
  summary: {
    title: "Deliver approved creative set",
    detail: "Export the final package and complete delivery."
  }
};

function internalApprovedCount(run: WorkflowState): number {
  return run.outputs.filter(
    ({ approval }) =>
      approval.graphicDesign === "approved" &&
      approval.clientService === "approved" &&
      approval.projectManager === "approved"
  ).length;
}

function clientApprovedCount(run: WorkflowState): number {
  return run.outputs.filter(({ clientStatus }) => clientStatus === "approved")
    .length;
}

const fixingRoleLabels: Record<ApprovalRole, string> = {
  graphicDesign: "GD",
  clientService: "CS",
  projectManager: "PM"
};

function fixingRoles(run: WorkflowState): readonly ApprovalRole[] {
  const roles: readonly ApprovalRole[] = [
    "graphicDesign",
    "clientService",
    "projectManager"
  ];
  return roles.filter((role) =>
    run.outputs.some(
      (output) =>
        output.status === "needs-revision" &&
        output.approval[role] === "rejected"
    )
  );
}

function fixingLabel(run: WorkflowState): string {
  const labels = fixingRoles(run).map((role) => fixingRoleLabels[role]);
  return labels.length ? `${labels.join(" + ")} fixing` : "Fixing";
}

function fixingDetail(run: WorkflowState): string {
  for (const role of [...fixingRoles(run)].reverse()) {
    const comment = run.outputs
      .map((output) => output.approvalComments[role])
      .find((value) => value.trim());
    if (comment) return comment;
  }
  return "A routed change is being fixed before review continues.";
}

function queueForRun(
  run: WorkflowState,
  currentUserId: string | null,
  ownerUserId: string | null
): WorkQueue | null {
  const clientApproved = clientApprovedCount(run);
  const allClientApproved =
    run.outputs.length > 0 && clientApproved === run.outputs.length;

  if (
    run.stage === "summary" ||
    (run.stage === "client" && run.clientSent && allClientApproved)
  ) {
    return "ready";
  }

  if (fixingRoles(run).length) return "waiting";

  if (
    run.stage === "start" ||
    run.ideaGenerationStatus === "running" ||
    run.artworkGenerationStatus === "running" ||
    (currentUserId && ownerUserId && ownerUserId !== currentUserId) ||
    (run.stage === "client" && run.clientSent && !allClientApproved)
  ) {
    return null;
  }

  return "review";
}

function relativeUpdatedLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Recently";
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000)
  );
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(timestamp);
}

function itemForRun(
  run: WorkflowState,
  queue: WorkQueue,
  brand: Brand
): MyWorkItem {
  const stage = stages.find(({ id }) => id === run.stage);
  const baseCopy = taskCopy[run.stage];
  const waitingForFix = queue === "waiting";

  return {
    run,
    brand,
    queue,
    title: waitingForFix ? fixingLabel(run) : baseCopy.title,
    stageLabel: stage?.name ?? "Creative work",
    detail: waitingForFix ? fixingDetail(run) : baseCopy.detail,
    updatedLabel: relativeUpdatedLabel(run.updatedAt),
    assetCount: run.outputs.length || run.directions.length
  };
}

function queueMeta(queue: WorkQueue) {
  if (queue === "ready") {
    return {
      title: "Ready to deliver",
      action: "Deliver",
      icon: <CheckCircle size={21} weight="fill" aria-hidden="true" />
    };
  }
  if (queue === "waiting") {
    return {
      title: "Waiting on team",
      action: "Waiting",
      icon: <ClockCountdown size={21} weight="duotone" aria-hidden="true" />
    };
  }
  return {
    title: "Needs your review",
    action: "Review",
    icon: <Eye size={21} weight="duotone" aria-hidden="true" />
  };
}

function progressForRun(run: WorkflowState): {
  approved: number;
  total: number;
  label: string;
} {
  if (run.outputs.length) {
    const approved =
      run.stage === "client" || run.stage === "summary"
        ? clientApprovedCount(run)
        : internalApprovedCount(run);
    return {
      approved,
      total: run.outputs.length,
      label: "creatives approved"
    };
  }

  const stageIndex = Math.max(
    0,
    stages.findIndex(({ id }) => id === run.stage)
  );
  return {
    approved: Math.min(stageIndex, 6),
    total: 6,
    label: "workflow steps"
  };
}

export function MyWork({
  workspace,
  workspaceDispatch
}: {
  workspace: WorkspaceState;
  workspaceDispatch: Dispatch<WorkspaceAction>;
}) {
  const { brands } = useBrands();
  const collaboration = useOptionalRunCollaboration();
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [visibleReviewCount, setVisibleReviewCount] =
    useState(REVIEW_PAGE_SIZE);

  const items = useMemo(() => {
    return workspace.runOrder
      .map((id) => workspace.runsById[id])
      .filter(
        (run): run is WorkflowState =>
          Boolean(run && run.brand && !run.done)
      )
      .map((run) => {
        const savedBrand = run.brand;
        if (!savedBrand) return null;
        const currentBrand =
          brands.find((brand) => brand.id === savedBrand.id) ?? savedBrand;
        const ownerUserId =
          collaboration?.ownershipByRunId[run.id]?.currentOwnerUserId ?? null;
        const queue = queueForRun(
          run,
          collaboration?.currentUserId ?? null,
          ownerUserId
        );
        return queue ? itemForRun(run, queue, currentBrand) : null;
      })
      .filter((item): item is MyWorkItem => Boolean(item))
      .sort(
        (left, right) =>
          Date.parse(right.run.updatedAt) - Date.parse(left.run.updatedAt)
      );
  }, [
    brands,
    collaboration?.currentUserId,
    collaboration?.ownershipByRunId,
    workspace.runOrder,
    workspace.runsById
  ]);

  const grouped = {
    review: items.filter(({ queue }) => queue === "review"),
    waiting: items.filter(({ queue }) => queue === "waiting"),
    ready: items.filter(({ queue }) => queue === "ready")
  };
  const nextItem = grouped.review[0] ?? grouped.ready[0] ?? grouped.waiting[0];
  const visibleQueues: readonly WorkQueue[] =
    filter === "all" ? ["review", "waiting", "ready"] : [filter];

  const openRun = (run: WorkflowState) => {
    workspaceDispatch({ type: "switch-run", id: run.id });
  };

  return (
    <section className="my-work-view" aria-labelledby="my-work-title">
      <section className="my-work-hero">
        <div className="my-work-focus">
          <span className="my-work-kicker" id="my-work-title">My Work</span>
          <div className="my-work-focus-number">
            <strong>{grouped.review.length}</strong>
            <span>need you</span>
          </div>
          <div className="my-work-focus-meta">
            <span className="waiting">
              <i aria-hidden="true" />
              {grouped.waiting.length} waiting
            </span>
            <span className="ready">
              <i aria-hidden="true" />
              {grouped.ready.length} ready
            </span>
          </div>
        </div>

        {nextItem ? (
          <article className="my-work-next-card">
            <div className="my-work-next-top">
              <span>Next action</span>
              <span className={`my-work-status-badge ${nextItem.queue}`}>
                {queueMeta(nextItem.queue).action}
              </span>
            </div>
            <div className="my-work-next-main">
              {(() => {
                const progress = progressForRun(nextItem.run);
                return (
                  <div className="my-work-progress-summary">
                    <b>{progress.approved} of {progress.total}</b>
                    <span>{progress.label}</span>
                  </div>
                );
              })()}
              <div className="my-work-next-project">
                <small>{nextItem.run.brand?.name}</small>
                <h2>{nextItem.title}</h2>
              </div>
            </div>
            <div className="my-work-stage-track" aria-label="Workflow progress">
              {Array.from({ length: 6 }, (_, index) => {
                const current = Math.min(
                  5,
                  Math.max(
                    0,
                    stages.findIndex(({ id }) => id === nextItem.run.stage) - 1
                  )
                );
                return (
                  <i
                    className={
                      index < current
                        ? "done"
                        : index === current
                          ? "current"
                          : ""
                    }
                    key={index}
                  />
                );
              })}
            </div>
            <div className="my-work-next-actions">
              <small>{nextItem.updatedLabel}</small>
              <button
                className="btn primary small"
                type="button"
                onClick={() => openRun(nextItem.run)}
              >
                {queueMeta(nextItem.queue).action}
                <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </article>
        ) : (
          <article className="my-work-next-card empty">
            <CheckCircle size={34} weight="duotone" aria-hidden="true" />
            <div>
              <h2>Nothing needs you right now.</h2>
              <p>New review work will appear here automatically.</p>
            </div>
          </article>
        )}
      </section>

      <section className="my-work-section">
        <header className="my-work-section-head">
          <h2>Work queue</h2>
          <div className="my-work-filters" aria-label="Filter work queue">
            {(
              [
                ["all", "All", items.length],
                ["review", "Needs me", grouped.review.length],
                ["waiting", "Waiting", grouped.waiting.length],
                ["ready", "Ready", grouped.ready.length]
              ] as const
            ).map(([value, label, count]) => (
              <button
                className={filter === value ? "active" : ""}
                type="button"
                aria-pressed={filter === value}
                key={value}
                onClick={() => setFilter(value)}
              >
                {label} <b>{count}</b>
              </button>
            ))}
          </div>
        </header>

        <div
          className={`my-work-queue ${filter === "all" ? "" : "single"}`}
        >
          {visibleQueues.map((queue) => {
            const meta = queueMeta(queue);
            const queueItems =
              queue === "review"
                ? grouped.review.slice(0, visibleReviewCount)
                : grouped[queue];
            return (
              <section
                className={`my-work-column ${queue}`}
                aria-label={meta.title}
                key={queue}
              >
                <div className="my-work-column-title">
                  <i aria-hidden="true" />
                  <b>{meta.title}</b>
                  <span>{grouped[queue].length}</span>
                </div>
                <div className="my-work-items">
                  {queueItems.map((item) => (
                    <button
                      className="my-work-task"
                      type="button"
                      key={item.run.id}
                      onClick={() => openRun(item.run)}
                    >
                      <div className="my-work-task-top">
                        <span className="my-work-task-brand">
                          <i>
                            <BrandLogo brand={item.brand} />
                          </i>
                          <b>{item.brand.name}</b>
                        </span>
                        <span>{item.updatedLabel}</span>
                      </div>
                      <div className="my-work-task-main">
                        <span className={`my-work-task-signal ${queue}`}>
                          {meta.icon}
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                      </div>
                      <div className="my-work-task-foot">
                        <span className={`my-work-stage-pill ${queue}`}>
                          {item.stageLabel}
                        </span>
                        <span className="my-work-task-count">
                          <Package size={14} aria-hidden="true" />
                          {item.assetCount
                            ? `${item.assetCount} ${
                                item.run.outputs.length ? "assets" : "ideas"
                              }`
                            : "Open project"}
                          <ArrowRight size={13} weight="bold" aria-hidden="true" />
                        </span>
                      </div>
                    </button>
                  ))}
                  {!grouped[queue].length ? (
                    <div className="my-work-column-empty">
                      <CheckCircle size={24} weight="duotone" aria-hidden="true" />
                      <span>No {meta.title.toLocaleLowerCase()}.</span>
                    </div>
                  ) : null}
                  {queue === "review" &&
                  visibleReviewCount < grouped.review.length ? (
                    <button
                      className="my-work-see-more"
                      type="button"
                      onClick={() =>
                        setVisibleReviewCount((current) =>
                          Math.min(
                            current + REVIEW_PAGE_SIZE,
                            grouped.review.length
                          )
                        )
                      }
                    >
                      See more
                      <span>
                        {grouped.review.length - visibleReviewCount} remaining
                      </span>
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </section>
  );
}
