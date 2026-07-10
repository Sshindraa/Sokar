# Runbook — Testing

## Unit / integration

```zsh
pnpm test       # Vitest
pnpm lint       # turbo lint + stylelint
pnpm typecheck  # per-app tsc --noEmit
```

## E2E

```zsh
pnpm test:e2e   # Playwright dashboard
```

## Visual regression

`pnpm test:visual` captures screenshots of 6 critical pages (`/dashboard`, `/dashboard/reservations`, `/dashboard/calls`, `/dashboard/gift-cards`, `/`, `/pricing`) on 3 viewports (iPhone 14, iPad Mini, desktop 1440px) and compares them to the baseline in `apps/dashboard/e2e/__snapshots__/`. Tolerance threshold: 0.2% pixel diff.

### Update baselines after intentional visual changes

```zsh
cd apps/dashboard
npx playwright test visual-regression --update-snapshots
git diff --stat apps/dashboard/e2e/__snapshots__/
git add apps/dashboard/e2e/__snapshots__/
git commit -m "feat(dashboard): update visual baselines for <description>"
```

### Screenshot stability

- Animations disabled (`animations: 'disabled'`).
- CSS transitions neutralized via `e2e/visual-stability.css` (also forces `-webkit-font-smoothing: antialiased`).
- Text caret hidden.
- For `/dashboard`, wait for `.recharts-surface` (async SVG charts) and use a `settleMs` of 3000 ms.
- Dashboard pages without Clerk display demo data or a skeleton — no random content.

### Cross-platform

Baselines are generated on macOS (suffix `-darwin`). In CI (Linux), a script copies `-darwin` baselines to `-linux` before running. The 0.2% threshold absorbs micro-differences (font anti-aliasing).
