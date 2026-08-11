## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary with label strings equal to role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Git workflow

- **Conventional commits**: All commit messages must follow conventional commits.
- **Commit on main**: Commit directly on `main` unless the implementation is too complex, in which case you may create a branch. The `auto-implement-tickets` skill is the documented exception: it branches per ticket and merges back by design.
- **Auto-run after implementation**: After completing an implementation, automatically generate the commit.
- **Dealing with conflicts**: This is a solo project, merge conflicts are unlikely. If a conflict occurs (remote or local), stop and ask the user for a decision.
- **Split unrelated changes**: Big changes usually take multiple commits unless they form a single logical feature; when unsure, err on the side of splitting. If there are pre-existing uncommitted changes unrelated to the current task, ask the user whether to ignore them, include them in the same commit, or commit them separately.
- **Remote**: Do not push commits to remote unless explicitly requested by the user.
