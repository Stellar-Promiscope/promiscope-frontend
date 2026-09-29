# PR Bodies (offline copy)

This directory stores self-contained PR body markdown for branches staged on the
user's fork (`dorisadams/scout-off-frontend`). Use them as `--body-file`
arguments when opening cross-fork PRs against `scout-off/scout-off-frontend`'s
`main` branch, instead of digging through chat scrollback.

## Files

| File                                                                       | Branch                           | Title                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| [`chore-resolve-30-issues.md`](./chore-resolve-30-issues.md)               | `chore/resolve-30-issues`        | chore(issues): resolve 12 of 30 ISSUES.md items + CI envs hoist + prettier fixup         |
| [`chore-lint-followups.md`](./chore-lint-followups.md)                     | `chore/lint-followups`           | chore(lint): fix 8 unescaped-entities + 1 exhaustive-deps blocking the build CI job      |
| [`feat-scout-subscription-guard.md`](./feat-scout-subscription-guard.md)   | `feat/scout-subscription-guard`  | feat(scout): add subscription guard to dashboard (ISSUES.md Issue #7)                    |
| [`test-error-boundary-production.md`](./test-error-boundary-production.md) | `test/error-boundary-production` | test(error-boundary): lock in production-mode error detail suppression (Issue #23 AC #3) |
| [`test-fix-lib-api-parser.md`](./test-fix-lib-api-parser.md)               | `test/fix-lib-api-parser`        | fix(test): remove orphan redeemReferralCode declaration in lib/api.ts (TS1005)           |
| [`test-jest-provider-helper.md`](./test-jest-provider-helper.md)           | `test/jest-provider-helper`      | test(infra): add setup-providers.tsx helper for app-level renders                        |
| [`issue-1295.md`](./issue-1295.md)                                         | `issue/1295`                     | fix(ipfs): stream /complete assembly to Pinata instead of buffering it                   |
| [`feat-1298-players-endpoint.md`](./feat-1298-players-endpoint.md)         | `feat/1298-players-endpoint`     | feat: back scout discovery with paginated indexer /players                               |

## How to use

```bash
# 1. Verify the branch is current. If git pull refuses with "not possible
#    to fast-forward" (because upstream scout-off/scout-off-frontend's main
#    moved past chore/resolve-30-issues after PR 1 landed), rebase instead:
#      git rebase scout-off/main    # or:  git rebase origin/main
git fetch origin
git checkout chore/resolve-30-issues
git pull --ff-only || git rebase origin/main
git log --oneline -3

# 2. Push to fork
git push -u origin chore/resolve-30-issues

# 3. Open the cross-fork PR using the body's stored file. The --title
#    comes from the HTML comment at the top of each markdown file. The
#    portable extractor below works on both GNU grep and macOS / BSD grep
#    (the previous grep -oP variant silently produced empty output on
#    macOS / BSD because -P is GNU-only):
title=$(sed -n 's/<!-- Title: \(.*\) -->/\1/p' \
    docs/pr-bodies/chore-resolve-30-issues.md | head -n1)

gh pr create \
  --repo scout-off/scout-off-frontend \
  --base main \
  --head dorisadams:chore/resolve-30-issues \
  --title "$title" \
  --body-file docs/pr-bodies/chore-resolve-30-issues.md
```

## When to update

- After **rebases**: re-verify validation tables (rerun `tsc`, `eslint`, `prettier --check`, and `jest` on the rebased branch and update the numbers in the body). Update commit hashes in any "Stack" / commit-log sections if rebased onto newer `main`.
- After **edit conflicts with another branch**: if the body conflicts with another PR's body when stacking, prefer the more specific branch's wording and link to it from the dependent branch's "Out-of-scope" section.
- When **upstream merges**: delete files for branches whose content has been merged into `scout-off/scout-off-frontend:main` so this directory stays in sync with pending work, not historical work.
- When **body-accuracy drift is reported**: body files hardcode the diff stats and test counts from their authoring moment; update them after any action that invalidates those numbers (e.g. a rebase that adds commits, or a follow-up commit on the same branch).

## Related

All six branches stacked for the bulk-deploy pass are now backfilled into this
directory. If a future bulk-deploy stack grows past the existing six entries,
follow the same authoring pattern (branch + title HTML comments at the top of
each body file, summary → diff → validation → out-of-scope sections) and
extend the Files table above.

To recover a body for a branch that exists elsewhere in the repo but wasn't
checked in here, run:

```bash
# If the body was committed to docs/pr-bodies/<branch>.md on that branch:
git show <sha>:docs/pr-bodies/<branch>.md 2>/dev/null

# Otherwise pull the body out of the commit message itself:
git log <sha> --format=%B -1 | sed -n '/^## Summary/,/^---$/p'
```

A cross-link from `CONTRIBUTING.md` to this directory has been added under
"Additional Notes" so contributors landing on `main` discover the directory
when onboarding, not only when opening a PR.
