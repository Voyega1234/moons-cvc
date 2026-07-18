# Single-owner project handoff

## V1 rule

Every active creative run has one current owner.

- Assigned client members can view the run.
- Only the current owner can edit or advance it.
- The current owner can send it to one specific active team member.
- A handoff note is optional.
- Completed runs remain viewable but cannot be handed off from the normal UI.
- Admins can perform the same database handoff when an owner is unavailable.

Compass does not provide simultaneous editing, presence, automatic locks, data
merging, or multiple editors in this release.

## Handoff safety

Before calling the handoff database function, the UI flushes the latest
workspace save. `moons.handoff_run(...)` then performs one transaction:

1. Lock the run row.
2. Verify the caller is the owner or a Compass admin.
3. Verify the expected version.
4. Verify the receiving user is active and can view the client.
5. Change the owner and increment the version.
6. Append a `moons.run_handoffs` audit record.

If the version is stale, the transaction stops and the user must reload the
latest project. No partial handoff is committed.

## Rollout

Apply:

```text
supabase/migrations/202607160002_single_owner_handoffs.sql
```

Existing Auth users are copied into `moons.team_profiles`. Department comes
from trusted `app_metadata.department` and supports `cs`, `gd`, `pm`, or
`admin`. Until department metadata is configured, the UI displays `Team`.

The first save after migration copies each existing private workspace run into
its shared `moons.runs.snapshot`. The original private workspace remains as a
safety fallback during rollout.
