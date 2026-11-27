# Speak Reply for Orca

An [Orca](https://orca.dev) plugin that reads the last agent reply in the focused workspace aloud. It works in chat tabs and terminal agents alike. macOS only: it speaks with the built-in `say` and `afplay` commands.

## Use

- **Read**: click **Read reply** in the status bar, or press ⌘⇧R.
- **Pause / Resume**: click the same button, or press ⌘⇧R again. Resume replays the sentence it paused in, then carries on.
- **Next / Back**: click **Next** or **Back**, or press ⌘⇧. and ⌘⇧,. Next skips to the next paragraph; Back returns to the previous one, or restarts the first. Both play, even from a pause.
- **Stop**: click **Stop**, shown while a reply plays or is paused. The next read starts from the top.

It reads the newest reply of the agent that answered most recently in the focused workspace. Markdown is reduced to plain sentences: code blocks become "code block" and URLs become "link".

## Install

You need macOS and Orca with plugins turned on (Settings → Plugins). No clone is needed: Orca installs straight from GitHub.

1. Install the newest release:

   ```sh
   orca plugin install Fullchee/orca-speak-reply
   ```

2. Orca stops and lists the access the plugin asks for (see [Access](#access)). If you agree, run the `--approve <fingerprint>` command it prints.
3. Check that **Read reply** appears in the status bar, or that `orca plugin list` shows `fullchee.speak-reply` as `running`.

- **Update**: `orca plugin update fullchee.speak-reply`
- **Remove**: `orca plugin uninstall fullchee.speak-reply`

## Access

- **Full access (`trusted-worker`)**: the worker runs the `orca` CLI to read the reply, `say` to turn each sentence into audio, and `afplay` to play it.
- **`workspace:read`**: tells the worker which workspace is focused.

Nothing leaves your machine.

## Develop

```sh
bun install
orca plugin types .        # writes .orca/types, which tsconfig.json extends
orca plugin dev watch .    # load into Orca, reload on save, stream logs
bun run typecheck
bun run test
bun run plugin:install     # install the newest GitHub release into Orca
```

## License

[MIT](LICENSE)
