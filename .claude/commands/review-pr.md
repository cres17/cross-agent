Perform a complete PR review on the current repository using the pr-review-agent pipeline.

## Argument
The user may pass a base branch or SHA as `$ARGUMENTS` (e.g. `/review-pr main`).
If no argument is given, default to `main`.

## Steps to follow

**Step 1 — Determine base ref**
Use `$ARGUMENTS` as the base if provided, otherwise use `main`.

**Step 2 — Get changed files**
Run:
```
git diff --name-only <base>...HEAD
```
Collect the list of changed files.

**Step 3 — Run DocCheck (if compiled)**
Check whether `dist/cli.js` exists.
- If it exists: run `npm run doccheck` and read `out/review_result.json` and `out/review_report.md`. Display the findings directly.
- If it does not exist: run `npm run build` first, then run `npm run doccheck`.

**Step 4 — If compiled pipeline is not available, run manual DocCheck**
Read `.reviewagent.yml`. For each enabled rule:
- Check if any changed file matches `trigger_globs`
- Check if any changed file matches `require_any_of_globs`
- If trigger matches exist but required doc matches do not → report a finding with the configured severity and title

**Step 5 — Get the diff for code review**
Run:
```
git diff <base>...HEAD
```
Before analyzing, mentally exclude any file whose path contains: `.env`, `secret`, `credential`, `key`, `dist/`, `build/`, `node_modules/`, `*.lock`.

**Step 6 — Review the diff**
Analyze the redacted diff and provide structured findings covering:
- Bugs or logic errors
- Security issues (e.g. missing auth checks, injection risks, hardcoded values)
- Missing or inadequate tests
- Performance concerns
- API or contract inconsistencies
- Documentation gaps

**Step 7 — Present results**
Organize findings by severity:
1. **BLOCKER** — must be fixed before merge
2. **MAJOR** — significant issue, should fix
3. **MINOR** — recommended improvement
4. **NIT** — stylistic or trivial

For each finding include: severity, file path (if applicable), description, and a concrete suggestion.

End with a one-line recommended action: `merge_blocked`, `needs_fix`, or `ok`.
