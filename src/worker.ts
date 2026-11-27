import { execFile, spawn } from 'node:child_process'
import type { Activate } from 'orca/worker'
import { orcaCliPath, replyToSpeak, type RunOrca } from './reply.ts'

/** A running speech: `stop` cuts it off, `done` settles when it ends either way. */
export type Speech = { pause(): void; resume(): void; stop(): void; done: Promise<void> }
export type Deps = { runOrca: RunOrca; speak(text: string): Speech }

const WORDS_PER_MINUTE = '210'

type Playback = { speech: Speech; isPaused: boolean }

/** One sentence being spoken: `cancel` cuts it off, `ended` settles when it ends either way. */
export type Utterance = { cancel(): void; ended: Promise<void> }

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\w/.test(sentence))
}

/**
 * `say` hands audio to a macOS speech service that keeps talking when `say` is frozen,
 * so pausing cancels the current sentence and resuming speaks it again from its start.
 */
export function speakBySentence(text: string, utter: (sentence: string) => Utterance): Speech {
  const parts = sentences(text)
  let index = 0
  let current: Utterance | null = null
  let finish = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })

  const playNext = () => {
    if (index >= parts.length) return finish()
    const utterance = utter(parts[index])
    current = utterance
    void utterance.ended.then(() => {
      if (current !== utterance) return
      index++
      playNext()
    })
  }
  const cancel = () => {
    const utterance = current
    current = null
    utterance?.cancel()
  }

  playNext()
  return {
    pause: cancel,
    resume: () => {
      if (!current) playNext()
    },
    stop: () => {
      cancel()
      index = parts.length
      finish()
    },
    done,
  }
}

export function createActivate({ runOrca, speak }: Deps): Activate {
  return (orca) => {
    let playback: Playback | null = null

    const show = async () => {
      const mainButton = !playback
        ? { text: 'Read reply', icon: 'play' as const }
        : playback.isPaused
          ? { text: 'Resume', icon: 'play' as const }
          : { text: 'Pause', icon: 'pause' as const }
      await orca.host.call('statusBar.update', { id: 'speak', ...mainButton })
      await orca.host.call('statusBar.update', { id: 'stop', visible: playback !== null })
    }

    void show()

    orca.commands.register('speak-reply.toggle', async () => {
      if (playback) {
        if (playback.isPaused) playback.speech.resume()
        else playback.speech.pause()
        playback.isPaused = !playback.isPaused
        await show()
        return
      }
      // The worker runs from `/`, so the CLI's `--worktree active` can't find the workspace.
      const context = await orca.host.call('workspace.readContext', {})
      const text = await replyToSpeak(context?.workspaceId, runOrca)
      const current: Playback = { speech: speak(text), isPaused: false }
      playback = current
      await show()
      void current.speech.done.then(() => {
        playback = null
        return show()
      })
    })

    orca.commands.register('speak-reply.stop', () => {
      playback?.speech.stop()
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
  speak: (text) =>
    speakBySentence(text, (sentence) => {
      const child = spawn('/usr/bin/say', ['-r', WORDS_PER_MINUTE, sentence], { stdio: 'ignore' })
      return {
        cancel: () => child.kill(),
        ended: new Promise((resolve) => child.on('close', () => resolve())),
      }
    }),
})
