# Agent guide

Reference app built on Effect 4, `@effect/ui`, `@effect/ui-kit`, and Tailwind CSS v4 with per-route Vite code splitting and SSR hydration.

## Read first

| Topic                                                       | Path                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Project overview, toolchain, and chunk boundaries           | [README.md](README.md)                                                             |
| Query loading, error, and refresh boundary                  | [.agents/traits/query-result-boundary.md](.agents/traits/query-result-boundary.md) |
| SchemaForm, async validation, and unsaved navigation guards | [docs/complex-forms.md](docs/complex-forms.md)                                     |
| MVU workflows, Commands, and OTel trace links               | [docs/command-workflow-architecture.md](docs/command-workflow-architecture.md)     |
| Lazy EN/DE i18n catalogs and localized validation           | [docs/i18n-proposal.md](docs/i18n-proposal.md)                                     |

## Always

- **Strict types & lint:** Zero `any`, unsafe casts, non-null assertions (`!`), or `@ts-ignore` / `@ts-nocheck`. Any lint/type suppression must state why. Keep local module imports as namespace imports (`import * as X from "./X.ts"`).
- **Bundle isolation:** Keep `App.ts`, `Shell.ts`, and `main.ts` free of `@effect/ui-kit` and route-page imports; keep server stores and RPC handlers under `src/server/` (`verify:bundles` enforces 0 bytes leaked into entry/client).
- **Deterministic tests:** Write `@effect/vitest` `it.effect` tests using `TestClock` and `TestHost` — no wall-clock sleeps or flaky retries.

## Hit every surface & Reverse states

Every UI, route, or server change must hold across all surfaces before finishing:

- **Surfaces:** SSR HTML + `#state`, zero-flash client hydration, CSR route transitions, both `en` and `de` locales, dark/light color schemes, and no-JS progressive forms (`POST /locale`).
- **Reverse states:** If you add a way in (modal open, block/filter state, locale cookie, navigation guard, opt-in banner), verify the way out (close/cancel/reset/restore) and visibility after reload.
- **Verification:** Run `pnpm format && pnpm check` (`vp fmt --check`, `effect-tsgo vp lint`, `effect-tsgo tsrs --noEmit`, client + SSR builds, `verify:bundles`, `vp test run`, and `smoke.ts`).
