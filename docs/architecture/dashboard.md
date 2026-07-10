# Dashboard Architecture

## Stack

- Next.js 15 App Router.
- React 19, Tailwind 3, Shadcn UI, Lucide.

## UI rules

- French-first copy.
- Tailwind colors must use design tokens / Shadcn CSS vars (`bg-background`, `text-muted-foreground`, `border-border`). No arbitrary hex classes.
- Shadcn UI from `@/components/ui/*`; icons from `lucide-react`; class composition via `cn()`.
- Components must handle loading, empty, error, and data states.
- Interactive elements should include `transition-all duration-200`.
- Layouts should be spacious (`p-6`/`p-8`) and responsive at iPad width.
- Marketing pages should stay static when possible (`○`, not `ƒ`).

## CSS guardrails (stylelint)

`pnpm lint:css` locks the following rules in `apps/*/src/**/*.css` (config `.stylelintrc.json` at root):

- No raw structural element selectors (`header`, `main`, `section`, `nav`, `footer`, `aside`, `article`, `button`, `div`) — they cause global bugs when styled in `globals.css` (see `header { position: fixed }` incident of July 2026).
- No hex colors (`#fff`).
- No `!important` (except a commented `stylelint-disable-next-line` for accessibility).
- No arbitrary z-index (use 0-50 or `var(--z-*)`).
- `font-size` in `rem`/`em` only.

## Copy tone

- Use `vous` everywhere, never `tu`. Sokar is a B2B SaaS billed monthly to restaurant managers (40-60, non-dev). `tu` feels consumer/developer-tool.
- Includes: onboarding (steps, modal, guard, dashboard), tooltips, error messages, banners, marketing copy.
- Indefinite pronoun `on` → `nous` in user-facing copy (OK in code comments).
- A Vitest test (`onboarding-tone.test.ts`) enforces the convention.
