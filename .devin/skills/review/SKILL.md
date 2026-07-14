---
name: review
description: Review the current uncommitted or staged diff for correctness, security, migrations, tests, and deployment risks.
agent: reviewer
---

Review the current uncommitted and staged diff in the Sokar repository.

Run `git status --short`, `git diff --stat`, and `git diff` (or `git diff --cached`) to understand the changes.
Then read the relevant files and search for related patterns.

Produce a structured report with:

- Verdict (Approve / Request changes)
- Summary
- Blocking issues, major issues, minor suggestions
- Risks to flag (migration, env var, breaking change, security sensitivity)
- Files reviewed

Do not modify any file.
