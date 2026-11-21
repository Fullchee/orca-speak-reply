import { execFile, spawn } from 'node:child_process'
import type { Activate } from 'orca/worker'
import { orcaCliPath, replyToSpeak, type RunOrca } from './reply.ts'

/** A running speech: `stop` cuts it off, `done` settles when it ends either way. */
export type Speech = { stop(): void; done: Promise<void> }
export type Deps = { runOrca: RunOrca; speak(text: string): Speech }

const WORDS_PER_MINUTE = '210'

export function createActivate({ runOrca, speak }: Deps): Activate {
  return (orca) => {
    let speech: Speech | null = null

    const show = (isSpeaking: boolean) =>
      orca.host.call('statusBar.update', {
        id: 'speak',
        text: isSpeaking ? 'Stop' : 'Read reply',
        icon: isSpeaking ? 'stop' : 'play',
      })

    orca.commands.register('speak-reply.toggle', async () => {
      if (speech) {
        speech.stop()
        return
      }
      // The worker runs from `/`, so the CLI's `--worktree active` can't find the workspace.
      const context = await orca.host.call('workspace.readContext', {})
      const text = await replyToSpeak(context?.workspaceId, runOrca)
      const current = speak(text)
      speech = current
      await show(true)
      void current.done.then(() => {
        speech = null
        return show(false)
      })
    })
  }
}

const orcaCli = orcaCliPath(process.execPath)

export default createActivate({
  // The CLI exits 1 on a failed lookup but still prints its JSON answer, which names the error.
  runOrca: (args) =>
    new Promise((resolve, reject) =>
      execFile(orcaCli, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
        stdout ? resolve(stdout) : reject(error),
      ),
    ),
  speak: (text) => {
    const child = spawn('/usr/bin/say', ['-r', WORDS_PER_MINUTE, text], { stdio: 'ignore' })
    return {
      stop: () => child.kill(),
      done: new Promise((resolve) => child.on('close', () => resolve())),
    }
  },
})
