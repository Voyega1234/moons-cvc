# Moons Creative OS

Production-oriented TypeScript foundation for the approved Moons prototype.

## Commands

```bash
npm install
npm run dev
npm run check
```

The root application is implemented in React and strict TypeScript. The
original HTML remains in the repository only as the visual reference.

## Source layout

```text
src/
  app/       React application composition
  config/    Environment-independent application configuration
  data/      Replaceable mock data
  domain/    Framework-free business types
  features/  Product workflows and state transitions
  lib/       Vendor clients such as Supabase
  ports/     Contracts for APIs, persistence, generation, and storage
  repositories/ Data access implementations
  services/  Reusable business operations
  shared/    Utilities, hooks, and constants with no feature ownership
  styles/    Approved visual system
```

Read `docs/ARCHITECTURE.md` before replacing prototype behavior.
Use `docs/ROADMAP.md` for implementation order, blocked integrations, and
acceptance criteria.
The locked v1 workflow behavior is documented in
`docs/V1_WORKFLOW_CONTRACT.md`.
Supabase production setup is documented in `docs/PRODUCTION_SETUP.md`.
The current Supabase schema and next adapter order are documented in
`docs/DATABASE_CONTRACT.md`.
The production Start/client-picker behavior is documented in
`docs/FEATURE_START.md`.
The Brand Memory/Profile upload contract is documented in
`docs/FEATURE_BRAND_MEMORY.md`.

Set `VITE_DATA_SOURCE=mock` for the prototype. When the Supabase schema and
queries are ready, set it to `supabase`. Feature components do not import the
Supabase client directly.

In mock mode, unfinished workspace state is stored under the versioned
`moons.workspace` LocalStorage key. This development adapter is selected only
from `app/dependencies.ts`.
# moons-cvc
