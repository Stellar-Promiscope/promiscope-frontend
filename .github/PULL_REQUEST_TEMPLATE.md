## Summary

Please provide a concise description of the change and why it was made.

- What does this PR change?
- Why is this change needed?

## Type

- `feat`, `fix`, `docs`, `test`, `chore`, or `refactor`

## Scope

- What is included in this PR?
- Does it affect frontend only, contracts, backend, or docs?

## Related Issue

References: #

## Testing

Describe how this change was tested locally, including commands run.

- `npm run lint`
- `npm run test`
- `node scripts/validate-env.js`
- `cd ../promiscope-contracts && cargo test` (when contract integration is involved)

## Checklist

- [ ] I followed the repository contribution guidelines in `CONTRIBUTING.md`
- [ ] My code is formatted and linted
- [ ] New or updated tests are included where applicable
- [ ] All tests pass locally
- [ ] Environment validation passes
- [ ] No secrets, credentials, or private keys are included
- [ ] Documentation is updated if needed

## Notes for Reviewers

Include any additional context, screenshots, edge cases, or follow-up work.

## PR Body Source (optional — bulk-deploy workflow)

If you maintain an offline copy of this PR's body in `docs/pr-bodies/`, link it here so reviewers and future rebases can find the canonical source. The CI `lint` job (see `.github/workflows/ci.yml`) validates every body file in `docs/pr-bodies/` against the contract documented in [`docs/pr-bodies/README.md`](docs/pr-bodies/README.md).

- Body file: `docs/pr-bodies/<branch-with-dashes>.md` (e.g. `feat/foo-bar.md` ↔ branch `feat/foo-bar`)
- Required headers — comment markers at the very top:

  ```
  <!-- Branch: feat/foo-bar -->
  <!-- Title: feat(foo): ... -->
  ```

- The PR **title** must match `<!-- Title: ... -->` verbatim (no surrounding quotes, no markdown markup).
- A `## Summary` section and a `## Validation` table are required; the validation step exits non-zero if any of these are missing.
- After your PR merges, delete the matching file from `docs/pr-bodies/` — the CI `lint` job fails fast if a body file's derived branch no longer resolves locally, so a stranded file will block subsequent runs.

To open a cross-fork PR from a body file:

```bash
title=$(sed -n 's/<!-- Title: \(.*\) -->/\1/p' \
    docs/pr-bodies/<branch>.md | head -n1)
gh pr create \
  --repo promiscope/promiscope-frontend \
  --base main \
  --head <your-fork>:<branch> \
  --title "$title" \
  --body-file docs/pr-bodies/<branch>.md
```
