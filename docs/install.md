# Installing pjman

pjman installs from npm or from its Homebrew tap. Either way, run `pjman init` in your repository afterwards: it sets up the store, registers the repository and, with Claude Code on the PATH, installs the plugin.

## With npm

```bash
npm install -g @vinhvanvu/pjman
```

Node 22.13 or newer and git.

## With Homebrew

```bash
brew trust --formula vinhvanvu/pjman/pjman
brew install vinhvanvu/pjman/pjman
cd <your-repo> && pjman init
```

Homebrew brings its own Node. Three things can stop the install.

### Homebrew refuses the tap

Current Homebrew loads a formula from a tap outside its own only once you trust it. Without that, the install stops with:

```
Refusing to load formula vinhvanvu/pjman/pjman from untrusted tap
```

Trust the formula, then install again:

```bash
brew trust --formula vinhvanvu/pjman/pjman
```

### An npm copy runs instead

A pjman installed earlier with npm (under nvm, for example) usually comes before `/opt/homebrew/bin` on the PATH, so `pjman` keeps running the old version. Brew warns about it at install. See which copies there are:

```bash
which -a pjman
pjman --version
```

Remove the npm copy, under whichever name it was installed:

```bash
npm uninstall -g @vinhvanvu/pjman   # or: npm uninstall -g pjman
```

Then run `pjman init` again, so the Claude Code plugin loads from the Homebrew copy instead of the one you removed. Restart open Claude Code sessions, or run `/reload-plugins` in each, to pick up the new hooks.

### Command Line Tools are too outdated

`brew install` stops with "Your Command Line Tools are too outdated" until they are updated. Update them from System Settings → General → Software Update, or:

```bash
softwareupdate --list            # names the Command Line Tools update
softwareupdate --install "<the name it printed>"
```

When none are installed, `xcode-select --install` installs them.

## Upgrading

```bash
brew upgrade pjman               # or: npm install -g @vinhvanvu/pjman@latest
```

When the new version changes how the store is laid out, pjman says so and asks for a migration. Run `pjman migrate` until it reports nothing to migrate. Restart open Claude Code sessions to load the new hooks.

## When something is off

`pjman doctor` checks the install without changing anything: which `pjman` runs and whether another copy shadows it, where the Claude Code plugin loads from and its version, sessions still on older hooks, the dashboard, the store and the registered project folders. Each line names the command that fixes it; `pjman init` makes most of the fixes.
