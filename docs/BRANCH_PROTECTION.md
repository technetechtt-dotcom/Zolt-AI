# Branch protection

Protect `main`:

- Require pull request reviews (at least one CODEOWNER)
- Require status checks: `unit`, `integration`
- Do not allow force pushes
- Do not allow deletions
- Require linear history or squash merges
- Restrict who can push to `main`

Releases are tagged (`vX.Y.Z`) after changelog updates. Do not deploy untagged images to production.
