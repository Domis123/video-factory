# Git Workflow — Video Factory

**Last updated:** 2026-04-20
**Read this at the start of every agent session.** Keep branches flat, GitHub current, rollbacks one-command.

**Supersedes:** Git guidance previously scattered across `SESSION_GUIDE.md`. Once this doc is stable, trim git content from SESSION_GUIDE and link here.

---

## TL;DR

Ten rules. Breaking any of them creates the mess this doc exists to prevent.

1. **Branch from `main`.** Not from another feature branch. Not from somewhere weird. `main`.
2. **Sync main first.** Every session starts with `git fetch && git checkout main && git pull origin main`. Verify clean working tree.
3. **One task = one branch.** Don't mix scopes. `fix/quick-wins` doesn't also fix unrelated bugs.
4. **Name the branch for the scope.** `feat/` new feature, `fix/` bug, `hotfix/` urgent prod fix, `chore/` refactor or docs.
5. **Push branch to origin when task complete.** Before reporting to Domis. So the work exists on GitHub, not just locally.
6. **End report asks about merge.** Last line of every end-of-task report: *"Merge to main and push, or hold on branch?"*
7. **Merge within 24h of approval.** Longer than that, something's wrong.
8. **Push main to origin immediately after merge.** GitHub stays in sync.
9. **Rollback via `git revert` on main, not branch-switching on VPS.** Creates clean undo commit in history.
10. **Never stack branches without explicit approval.** Max stack depth: 1. If you feel the need to stack, stop and ask Domis to merge the dependency first.

---

## Who does what

| Action | Who | Where |
|---|---|---|
| Create branch | Agent | Agent sandbox |
| Commit + push | Agent | Agent sandbox → origin |
| Review | Domis | GitHub UI or laptop |
| Merge to main | Domis | Laptop |
| Push main | Domis | Laptop → origin |
| Deploy to VPS | Domis | Laptop (ssh → VPS pulls) |
| Rollback | Domis | Laptop (git revert, then deploy) |
| Delete merged branches | Domis | Laptop (weekly) |

**The agent never merges to main.** Merging is Domis's review signal.
**The agent never pushes main.** Only ever pushes feature branches.

---

## Standard feature workflow

### Agent — session start

```bash
# Every session, no exceptions
git fetch origin
git checkout main
git pull origin main
git status
# If working tree is dirty, STOP and report. Do not proceed.

# Verify main matches origin
git log origin/main..main
# Should be empty. If not, something is out of sync — STOP and report.
```

### Agent — create branch

```bash
git checkout -b feat/short-description-kebab-case
```

Branch naming:
- `feat/phase4-w0c-ingestion-integration` ✓ (scope clear)
- `feat/do-stuff` ✗ (meaningless)
- `feat/phase4-and-also-fix-formatFullBrief` ✗ (two scopes)

### Agent — during work

Conventional commits. Small, focused.

```bash
git add -A
git commit -m "feat(segment-v2): add per-parent batching to analyzer"
# Repeat as needed — one logical change per commit
```

Don't squash during work. If Domis wants squash-on-merge, that's his call at merge time.

### Agent — session end

```bash
# Verify build still passes
npm run build

# Push
git push origin feat/xyz-description

# Then report to Domis. Report must include:
# - Commit hashes
# - Files changed (git diff --stat origin/main..HEAD)
# - Test output or logs
# - Known issues or flags
# - Ask: "Merge to main and push, or hold on branch?"
```

### Domis — merge decision

```bash
# From laptop
git fetch origin
git checkout main
git pull origin main

# Review
git log main..origin/feat/xyz-description --stat
git diff main..origin/feat/xyz-description
# Or use GitHub UI for bigger changes

# If approved:
git merge --no-ff origin/feat/xyz-description -m "merge feat/xyz-description"
git push origin main

# Clean up remote branch
git push origin --delete feat/xyz-description

# Optional: delete local copy if you had one
git branch -d feat/xyz-description
```

### Domis — deploy to VPS

```bash
ssh root@95.216.137.35 "cd /home/video-factory && \
  git fetch origin && \
  git checkout main && \
  git pull origin main && \
  npm install && \
  npm run build && \
  systemctl restart video-factory"
```

---

## Stacking branches — only when explicitly approved

Stacking means branching from a non-main branch. Sometimes necessary. Usually a smell.

### When it's OK

- The parent branch has been tested and approved but merge-to-main is pending for reasons (e.g. 48h smoke observation window). Domis explicitly says: *"stack the next task on feat/xyz — don't wait for main merge."*
- Multi-stage work where stages share code that isn't ready for main (e.g. W0b.1 → W0b.2 → W0b.3 all on `feat/w0b-xxx`, each a separate commit on the same branch).

### Max stack depth: 1

Never branch C from B from A.

If you want to, stop. Ask Domis to merge A first, then branch B from fresh main, then C from fresh main (or from B if truly needed).

### Required declaration in agent's end report

When branch is stacked, the last section of the agent's report must include:

```
STACK NOTE: This branch (feat/w0b-xxx) is stacked on feat/w0a-xxx.
Branching point: commit <sha>.
If feat/w0a-xxx is not merged before this branch, the merge order is:
  1. Merge feat/w0a-xxx first
  2. Then merge feat/w0b-xxx (will fast-forward or need --ff-only)
```

---

## Conflicts and divergence

### Main is behind origin at session start

```bash
git fetch origin
git checkout main
git pull origin main
# If pull is a fast-forward, you're fine. If it conflicts, STOP and ask Domis.
```

### Agent's feature branch was created from stale main

```bash
# Fix before pushing
git fetch origin
git rebase origin/main
# If conflicts arise that the agent can't confidently resolve — STOP and report.
# Do not force-push. Do not merge. Ask Domis.

# If rebase succeeds cleanly:
git push --force-with-lease origin feat/xyz-description
```

`--force-with-lease` is safer than `--force`. It fails if someone else pushed to the branch meanwhile. Use it.

### Genuine merge conflict agent can't resolve

**Stop. Report. Do not guess.** Response template:

```
CONFLICT REPORT
Branch: feat/xyz-description
Rebasing onto: origin/main
Conflicted files:
  - src/agents/foo.ts (lines 45-67)
  - src/lib/bar.ts (lines 12-25)

I cannot confidently resolve because: [specific reason]
Leaving branch in conflicted state. Awaiting manual resolution by Domis.
```

The agent does not guess at conflict resolution in this codebase. The cost of a bad auto-resolution is higher than the cost of Domis spending 5 minutes resolving manually on his laptop.

---

## Rollback patterns

### Rollback a single commit already on main and deployed

```bash
# Domis laptop
git checkout main
git pull origin main
git log --oneline -20   # find the bad commit
git revert <bad-commit-sha>
git push origin main

# Redeploy VPS
ssh root@95.216.137.35 "cd /home/video-factory && git pull origin main && npm install && npm run build && systemctl restart video-factory"
```

`git revert` creates a new commit that inverts the bad one. History stays linear and explicit. Future `git log` shows exactly what was undone and why.

### Rollback multiple commits

```bash
git revert <sha-newest>..<sha-oldest>
# Or revert a merge commit:
git revert -m 1 <merge-commit-sha>
```

### Emergency: VPS to previous commit (no GitHub round-trip)

When production is on fire and you need instant revert:

```bash
ssh root@95.216.137.35 "cd /home/video-factory && \
  git log --oneline -10 && \
  git checkout <good-commit-sha> && \
  systemctl restart video-factory"
```

This detaches HEAD on VPS. **Within 6 hours**, do the proper `git revert` on laptop, push main, then restore VPS to main. Don't leave VPS on detached HEAD indefinitely — `git pull` will fail and any agent checking state will be confused.

### Feature branch went bad before merge

```bash
git push origin --delete feat/bad-branch
# Agent's local copy is now orphaned; they can delete it
```

Nothing else to do. It never touched main.

---

## Weekly hygiene (Domis, Friday or whenever)

Takes 2 minutes.

```bash
# List remote branches that are fully merged into main (safe to delete)
git fetch --prune
git branch -r --merged origin/main | grep -v "origin/main$" | grep -v "origin/HEAD"

# Review the list. Delete each with:
git push origin --delete <branch-name>

# Or bulk delete if confident:
git branch -r --merged origin/main \
  | grep -v "origin/main$" \
  | grep -v "origin/HEAD" \
  | sed 's|origin/||' \
  | xargs -I {} git push origin --delete {}

# Also check local merged branches
git branch --merged main | grep -v "^\*\|main"
# Delete each with:
git branch -d <branch-name>
```

If a branch shows as merged but you don't recognize the name — investigate before deleting. But usually merged means done.

---

## Agent session checklist

### Session start
- [ ] Read this document if haven't today
- [ ] `git fetch origin && git checkout main && git pull origin main`
- [ ] `git status` — must show clean working tree
- [ ] `git log origin/main..main` — must be empty (no unpushed local commits)
- [ ] `git branch` — review local branches, should be few
- [ ] Branch name matches scope convention

### During work
- [ ] Commits are small, focused, conventional-commit style
- [ ] Build passes before every commit: `npm run build`
- [ ] No scope creep — if another bug surfaces, note it for a follow-up branch

### Session end
- [ ] All changes committed (no dirty working tree)
- [ ] `git push origin <branch-name>` succeeded
- [ ] Final build: `npm run build` — clean
- [ ] Report includes commit SHAs, files changed, tests/logs, flags
- [ ] Report ends with: *"Merge to main and push, or hold on branch?"*
- [ ] If stacked: STACK NOTE included

### When told to merge
- [ ] Agent does NOT merge — merging is Domis's action on laptop
- [ ] Agent confirms the branch is pushed and ready

---

## What breaks if we skip this

| Skip | Breaks |
|---|---|
| "Branch from main" | Branches stack, ancestors diverge, merge conflicts multiply |
| "Sync main first" | Agent's work built on stale base, rebase headaches later |
| "One task = one branch" | Can't cleanly revert a single feature without losing others |
| "Push branch on completion" | Work only exists in agent sandbox. If sandbox dies, work dies. |
| "Merge within 24h of approval" | GitHub drifts behind VPS. If VPS dies, GitHub isn't a valid backup. |
| "Push main after merge" | Next agent session pulls stale main, stacks inadvertently |
| "Git revert for rollback" | History becomes a branch graveyard; prod state hard to reason about |
| "Max stack depth 1" | Literally the problem this doc exists to prevent |
| "Weekly hygiene" | Branch list becomes unreadable, confusion about in-progress work |

---

## Current backlog to flush before this workflow takes effect

As of 2026-04-20, these branches are approved but unmerged:

```
main (origin) ─ behind ─ feat/architecture-pivot [approved, tested]
                          └─ fix/quick-wins [approved, tested]
                              └─ feat/w0a-segment-v2-prototype [approved, output reviewed]
                                  └─ feat/w0b-segment-v2-integration [in progress]
```

**Cleanup sequence (Domis on laptop):**

```bash
# 1. Fetch everything
git fetch origin

# 2. Confirm branches are on origin (agent should have pushed these — verify)
git branch -r | grep -E "(architecture-pivot|quick-wins|w0a-segment)"

# 3. Merge in stack order
git checkout main
git pull origin main

git merge --no-ff origin/feat/architecture-pivot -m "merge feat/architecture-pivot (Phase 3.5)"
git merge --no-ff origin/fix/quick-wins -m "merge fix/quick-wins (prep filter + subject_consistency)"
git merge --no-ff origin/feat/w0a-segment-v2-prototype -m "merge feat/w0a-segment-v2-prototype (Phase 4 W0a schema + analyzer)"

git push origin main

# 4. Delete merged remotes
git push origin --delete feat/architecture-pivot
git push origin --delete fix/quick-wins
git push origin --delete feat/w0a-segment-v2-prototype

# 5. Deploy (unchanged; VPS already runs these — this just aligns GitHub main)
ssh root@95.216.137.35 "cd /home/video-factory && git fetch && git checkout main && git pull origin main && npm install && npm run build && systemctl restart video-factory"
```

After this flushes, `feat/w0b-segment-v2-integration` remains in progress. It stacks on `feat/w0a-segment-v2-prototype` (now merged into main), so the branch's base is functionally identical to current main — no rebase needed. The W0b branch will merge cleanly onto main when its work completes.

**From that point forward, every new branch follows this doc.** No more pile-ups.

---

## Open items

- `SESSION_GUIDE.md` has some overlapping git content (the testing workflow section). When this doc stabilizes, trim SESSION_GUIDE's git section to a pointer: *"See GIT_WORKFLOW.md."*
- Consider adding pre-commit hooks: `npm run build` runs before any commit. One-time setup in `.husky/` or similar. Defer until after W0 completes.
- Agent-side branch protection: should there be a script that refuses commits directly on `main`? Belt-and-suspenders given that Domis is the only one merging. Defer.
