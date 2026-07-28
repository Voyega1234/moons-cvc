# UX v51 implementation contract

## Source of truth

1. `neo-creative-compass-v51.html` is the visual and interaction reference.
2. The React reducer, workflow rules, repositories, and service APIs remain the
   behavioral source of truth.
3. When the HTML contains several historical versions of the same component,
   the final CSS and JavaScript override wins because that is what the browser
   actually renders.
4. Explicit product requirements override the prototype. In particular, the
   deliverable order is **Single → Album → UGC**.

## User outcome

A user must be able to understand what will be generated, correct the inputs
before spending generation time, recognize each output in its native format,
and always know who owns the next review action.

## Implementation order and acceptance criteria

### 1. Confirm Brief

- The Brief primary action opens a confirmation modal before generation.
- The modal matches the v51 hierarchy: deliverable mix, exact brief, selected
  products, and visual references.
- Products and references can be included or excluded in the modal.
- A new reference can be uploaded without leaving confirmation.
- Generation starts only after the explicit confirm action.
- Deliverables appear as Single, Album, UGC.
- Album format is not chosen in Brief. Selecting an Album hook opens its format
  chooser, and every selected Album hook keeps its own production layout.

### 2. Native UGC preview

- UGC outputs use the v51 TikTok-style 9:16 phone treatment.
- The shared preview is used consistently in Build, Internal QC, and Client
  Review.
- The preview communicates the hook, creator/caption context, engagement rail,
  and native bottom navigation without pretending to be a published post.

### 3. Internal QC board

- The stage starts with the compact v51 progress summary.
- The board uses the final two-column v51 proof-card layout rather than the
  earlier role-queue concept.
- Each creative card shows one current status, the GD → CS → PM gate track, the
  latest comment, and one next action.
- Current and completed gates are clickable; future gates are not.
- The comments/decision panel scrolls correctly and its input is never covered
  by the modal footer.
- Next-step behavior follows the workflow rules, not hard-coded visual state.

### 4. Automatic quality preflight

- Remove the manual “Quality check” action from Build.
- Sending work to Internal QC automatically runs the quality service before the
  stage transition.
- A failed service call keeps the user in Build and explains what failed.
- The internal automated result supplements human GD/CS/PM approval; it does not
  replace it.

## Verification

- Add interaction tests for Confirm Brief, Album format, type order, automatic
  preflight, and the absence of the manual QC button.
- Add preview tests for the native UGC structure.
- Add Internal QC tests for progress, gate clickability, comments, and next
  actions.
- Run the focused tests after each slice, then run the complete test and
  production build checks.
