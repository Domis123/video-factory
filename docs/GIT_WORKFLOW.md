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
6. **End report asks about merge.** Last line of every end-of-task report: *"Merge to main and deploy, or hold?"*
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
| Merge to main | Agent (after Domis approval in chat) | Agent sandbox → origin |
| Push main | Agent | Agent sandbox → origin |
| Deploy to VPS | Agent (after merge) | Agent sandbox → VPS via SSH |
| Rollback | Agent (after Domis approval in chat) | Agent sandbox → origin → VPS |
| Delete merged remote branches | Agent (immediately after merge) | Agent sandbox → origin |
| Review + approve | Domis | Chat |

**Agent owns the full cycle.** Domis's only git action is approval in chat.

**Agent merges to main ONLY after Domis gives explicit approval in chat** (e.g. "merge", "ship", "approved to merge"). Agent never merges silently. Agent never force-pushes main. Agent never rewrites main's history.

---

## Standard feature workflow (Option B — agent-owned)

**Agent session start:**
```bash
git fetch origin
git checkout main
git pull origin main
git status      # must be clean
git log origin/main..main   # must be empty
```

**Agent creates branch and works:**
```bash
git checkout -b feat/xyz-description
# ... work, commit, push ...
git push origin feat/xyz-description
```

Branch naming:
- `feat/phase4-w0c-ingestion-integration` ✓ (scope clear)
- `feat/do-stuff` ✗ (meaningless)
- `feat/phase4-and-also-fix-formatFullBrief` ✗ (two scopes)

Conventional commits. Small, focused. Don't squash during work — if Domis wants squash-on-merge, that's his call at merge time.

**Agent reports to Domis, ending with:** *"Merge to main and deploy, or hold?"*

**If Domis says MERGE:**
```bash
# Pre-merge gate: build must pass
npm run build

# Merge on agent sandbox
git checkout main
git pull origin main   # ensure current
git merge --no-ff feat/xyz-description -m "merge feat/xyz-description"
git push origin main

# Delete feature branch
git push origin --delete feat/xyz-description
git branch -d feat/xyz-description

# Deploy VPS
ssh root@95.216.137.35 "cd /home/video-factory && \
  git fetch origin && \
  git checkout main && \
  git pull origin main && \
  npm install && \
  npm run build && \
  systemctl restart video-factory"

# Verify service
ssh root@95.216.137.35 "systemctl status video-factory --no-pager | head -10"

# Report back: "Merged + deployed. Main is at <sha>. Service: <status>."
```

**If Domis says HOLD:** agent stays on feature branch, awaits further instructions.

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

### Rollback under Option B

If Domis says "rollback" or "revert" after a deploy:

```bash
# Agent identifies the bad commit
git log origin/main --oneline -10
# Domis confirms which commit to revert (or agent infers from context)

# On agent sandbox
git checkout main
git pull origin main
git revert --no-edit <bad-commit-sha>
git push origin main

# Redeploy VPS (same deploy sequence as the merge flow)
ssh root@95.216.137.35 "cd /home/video-factory && \
  git fetch origin && \
  git checkout main && \
  git pull origin main && \
  npm install && \
  npm run build && \
  systemctl restart video-factory"

# Report back: "Reverted <bad-sha>. Main is at <new-sha>. Service: <status>."
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
- [ ] Report ends with: *"Merge to main and deploy, or hold?"*
- [ ] If Domis says merge: run the full merge + deploy sequence, report result
- [ ] If Domis says hold: stay on branch, await further instructions
- [ ] If stacked: STACK NOTE included

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
| "Git revert for rollback (agent-owned)" | History becomes a branch graveyard; prod state hard to reason about. Under Option B the agent runs revert + redeploy after Domis approves in chat. |
| "Max stack depth 1" | Literally the problem this doc exists to prevent |
| "Weekly hygiene" | Branch list becomes unreadable, confusion about in-progress work |

---

## Workflow history

- 2026-04-20 v1: initial workflow doc, Domis handled merges manually.
- 2026-04-20 v2: Option B adopted, agent owns merges after chat approval.
  Obsolete v1 "backlog flush" section removed — backlog was flushed in
  commit 919ee73 (merge Phase 3.5 pivot + quick-wins + Phase 4 W0a to main).

---

## Open items

- `SESSION_GUIDE.md` has some overlapping git content (the testing workflow section). When this doc stabilizes, trim SESSION_GUIDE's git section to a pointer: *"See GIT_WORKFLOW.md."*
- Consider adding pre-commit hooks: `npm run build` runs before any commit. One-time setup in `.husky/` or similar. Defer until after W0 completes.
- Agent-side branch protection: should there be a script that refuses commits directly on `main`? Belt-and-suspenders given that Domis is the only one merging. Defer.
