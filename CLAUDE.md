# pjman

This project's record lives in the global pjman store (`pjman where` names it) and the project is built with pjman. Follow the `pjman` skill: read `pjman context change:<slug>` before working on a change, open decisions `proposed` before acting on a choice that forecloses options (never set one `decided`), name new work as `change:<slug>`, and set `next` before stopping. Every write to the store goes through the `pjman` command; run `pjman validate` before committing.

Example keys in docs and tests use `ABC-1234`.

The installed `pjman` is a copy, never a link to this checkout. After a merge to main run `npm run install:local` (builds, packs, installs, refreshes the plugin, restarts the dashboard); when the installed tool then asks for a store migration, run `pjman migrate` once. Never `npm link` this checkout.
