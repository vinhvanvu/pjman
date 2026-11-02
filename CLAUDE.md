# pjman

This project's record lives in the global pjman store (`pjman where` names it) and the project is built with pjman. Follow the `pjman` skill: read `pjman context change:<slug>` before working on a change, open decisions `proposed` before acting on a choice that forecloses options (never accept one yourself), name new work as `change:<slug>`, and leave the plan where the work stands before stopping. Every write to the store goes through the `pjman` command; run `pjman validate` before committing.

Example keys in docs and tests use `ABC-1234`.

The installed `pjman` is a copy, never a link to this checkout. After a merge to main run `npm run install:local` (builds, packs, installs, refreshes the plugin, restarts the dashboard); when the installed tool then asks for a store migration, run `pjman migrate` once. Never `npm link` this checkout.

To see a change running, `npm run dev` from the worktree's root: it serves the worktree's own API and app at `http://<branch>.pjman.localhost:1355` (the main checkout at `http://pjman.localhost:1355`). Name that URL to the person; never pick a port. The installed dashboard on 7331 is the person's and stays as it is.

Work on a change in a worktree named for it (the `branch:` line of its context), as the pjman skill says. Worktrees branch from the local main (`worktree.baseRef` in `.claude/settings.json`) and get the main checkout's node modules by symlink; if a worktree lacks them, run `npm install` at its root and in `ui/`. Once the branch is merged, remove the worktree and its branch.
