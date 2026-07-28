# Moons working guide

Read `docs/CURRENT_SYSTEM_MAP.md` before opening large workflow or CSS files.
Use it to locate the smallest relevant implementation slice.

## Source of truth

- React state, reducers, rules, services, and tests define application behavior.
- `neo-creative-compass-v51.html` defines visual direction only. Do not copy its
  fake data or inline JavaScript into the application.
- Preserve backend integrations, stage gates, permissions, persistence, and
  accessibility while matching the reference UI.

## Working rules

1. Search for component, action, and CSS class names before reading whole files.
2. Prefer targeted ranges such as `sed -n 'START,ENDp'` for legacy monoliths.
3. Keep structural extraction separate from behavior or visual changes.
4. Preserve exported component names while modules are being split.
5. After a structural move, run the narrow test first, then `npm run typecheck`.
6. Update `docs/CURRENT_SYSTEM_MAP.md` when ownership or file locations change.

## Large legacy files

- `src/features/workflow/stages.tsx` is a legacy workflow monolith.
- `src/styles/compass-redesign.css` is a legacy layered stylesheet.
- `src/features/workflow/stages-redesign.test.tsx` is the matching broad test.

Do not read or rewrite these files wholesale unless a cross-cutting audit
requires it. New stage-specific code belongs under
`src/features/workflow/stages/`; shared review UI belongs under
`src/features/workflow/review/`; new stage CSS belongs under
`src/styles/workflow/`.

## Verification

Use the repository scripts:

- `npm run typecheck`
- `npm run test -- <test-file>`
- `npm run build`

Do not treat a successful render alone as proof that workflow behavior is
preserved.
