/**
 * Commitlint config — enforce Conventional Commits.
 *
 * Why: enables automated changelog generation, semantic-release style
 * version bumps, and a scannable git log. Scope of the convention is
 * documented below so contributors (and AI agents) can self-serve.
 *
 * Format: <type>(<scope>)<!>: <subject>
 *
 * Types:
 *   feat      → new feature visible to end users
 *   fix       → bug fix
 *   docs      → documentation only (no code change)
 *   style     → formatting (whitespace, semicolons, etc — no logic change)
 *   refactor  → code change that neither fixes a bug nor adds a feature
 *   perf      → performance improvement
 *   test      → adding or fixing tests
 *   build     → build system, deps, CI, turbo config
 *   ci        → CI/CD pipeline (workflows, jobs, scripts)
 *   chore     → tooling, configs, anything not in src/
 *   revert    → reverts a previous commit
 *
 * Scopes (use when applicable, not required):
 *   api, dashboard, shared, config, types, database, voice, deps, infra
 *
 * Rules enforced by @commitlint/config-conventional:
 *   - type is one of the above
 *   - subject is non-empty, ≤ 72 chars
 *   - header is ≤ 100 chars
 *   - body line ≤ 100 chars (best-effort)
 *   - no trailing period on subject
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  // Allow our existing types and explicitly forbid common drift.
  // 'config-conventional' already includes the standard set; we add
  // nothing here — this comment is the policy.
};
