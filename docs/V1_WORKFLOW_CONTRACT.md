# Moons v1 workflow contract

The prototype is the source of truth for visible behavior.

## Workspace ownership

- A workspace can contain multiple runs.
- `activeRunId` identifies the run shown in Studio.
- Every run owns its brief, service, quantity, attachments, directions,
  outputs, QA state, approvals, client state, and delivery state.
- Overview/Studio selection and transient toast messages belong to the
  workspace, not to an individual run.
- Switching runs must not copy or merge run data.

## Step completion

| Step | Complete when | Primary action |
| --- | --- | --- |
| Start | A brand is selected | Continue to brief |
| Brief | Hooks have been generated | Generate hooks |
| Hook | Selected hooks have created outputs | Create selected hooks |
| Create | QA has completed successfully | Send to internal QC |
| Internal QC | Required internal approval is complete | Open client review |
| Client review | Every output is client-approved | Mark delivered |
| Delivered | The delivered run is marked sent | Mark sent |

## Navigation

- Users may navigate backward to any unlocked step.
- A step is unlocked when every required preceding step is complete.
- Workflow actions go through the same central guard as visible navigation.
- Blocked actions must not mutate run data or `updatedAt`; they return a
  short user-facing reason through the workspace toast.
- Navigating backward preserves later data until an upstream change explicitly
  invalidates it.
- Changing service invalidates directions, outputs, QA, approval, client
  review, and delivery because those artifacts belong to another service.
- The UI must not allow direct navigation to a locked step.

## Guarded actions

| Action | Required first |
| --- | --- |
| Generate hooks | Brand selected and brief is not empty |
| Select hooks / Let Moons pick | Hooks generated |
| Create outputs | Exactly the requested quantity of hooks selected |
| Run QA | Outputs created |
| Internal approval | QA complete |
| Client review | Internal approval complete |
| Client approve output | Review packet sent |
| Mark delivered | Every output client-approved |
| Mark sent | Run is on the Delivered step |

## Multiple runs

- New creative creates a separate run and keeps the current brand.
- Refresh studio creates a separate blank run.
- Switching run changes only `activeRunId`.
- Closing the active run selects the nearest remaining run.
- The final remaining run cannot be closed.
- Run tabs show brand, service, current step, and semantic status.

## v1 status vocabulary

Run: active, ready, warning, delivered.

Output: draft, needs-revision, fixed, ready.

Client review: queued, sent, revision, approved.

The async job status vocabulary is defined in milestone A5.
