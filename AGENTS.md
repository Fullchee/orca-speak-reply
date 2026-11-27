# Speak Reply for Orca

An Orca plugin that reads the last agent reply aloud. See [README.md](README.md) for use and development commands.

## Ship every change to the running Orca

After each change, release it and update the installed plugin. Orca installs this plugin from its newest `vX.Y.Z` tag, so a commit alone changes nothing in Orca.

1. Bump `version` in `orca-plugin.json`: minor for a feature, patch for a fix.
2. Run `bun run typecheck`, `bun run test` and `bun run validate`.
3. Commit, push to `main`, then tag the commit `vX.Y.Z` (matching `version`) and push the tag.
4. Run `orca plugin update fullchee.speak-reply`.
5. If it exits 3 (`approval_required`), the update adds commands, shortcuts, buttons or capabilities. Run the printed `--approve <fingerprint>` command when it only adds what the change introduced; ask the user first if it grows `capabilities` or `execution`.
6. Run `orca plugin list` and check that `fullchee.speak-reply` shows the new version and `running`.

## Failure log

### Releasing

- Tag every release `vX.Y.Z` and push the tag: `orca plugin update` reports "up-to-date" for untagged commits on `main`.
