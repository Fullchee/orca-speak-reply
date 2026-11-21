# Speak Reply for Orca

An [Orca](https://orca.dev) plugin that reads the last agent reply in the focused workspace aloud. It works in chat tabs and terminal agents alike. macOS only: it speaks with the built-in `say` command.

## Use

- **Read**: click **Read reply** in the status bar, or press ⌘⇧R.
- **Stop**: click **Stop**, or press ⌘⇧R again.

It reads the newest reply of the agent that answered most recently in the focused workspace. Markdown is reduced to plain sentences: code blocks become "code block" and URLs become "link".

## Install

```sh
orca plugin install Fullchee/orca-speak-reply
```

Orca lists the access the plugin needs and prints the `--approve <fingerprint>` command to run next.

## Access

- **Full access (`trusted-worker`)**: the worker runs the `orca` CLI to read the reply, and `say` to speak it.
- **`workspace:read`**: tells the worker which workspace is focused.

Nothing leaves your machine.

## Develop

```sh
bun install
orca plugin types .        # writes .orca/types, which tsconfig.json extends
orca plugin dev watch .    # load into Orca, reload on save, stream logs
bun run typecheck
bun run test
```

## License

[MIT](LICENSE)
