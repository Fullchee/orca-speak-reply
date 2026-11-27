import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Activate } from 'orca/worker'
import { orcaCliPath, replyToSpeak, type RunOrca } from './reply.ts'

/** A running speech: `stop` cuts it off, `done` settles when it ends either way. */
export type Speech = {
  pause(): void
  resume(): void
  stop(): void
  /** Jump to the next paragraph's start and play; past the last one, finish. */
  next(): void
  /** Jump to the previous paragraph's start and play; in the first one, restart it. */
  previous(): void
  done: Promise<void>
}
export type Deps = { runOrca: RunOrca; speak(text: string): Speech }

const WORDS_PER_MINUTE = '210'

type Playback = { speech: Speech; isPaused: boolean }

/** One sentence being spoken: `cancel` cuts it off, `ended` settles when it ends either way. */
export type Utterance = { cancel(): void; ended: Promise<void> }
/** Renders a sentence to an audio clip ahead of time, then plays a clip. */
export type Voice = { render(sentence: string): Promise<string>; play(clip: string): Utterance }

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\w/.test(sentence))
}

/** Each paragraph's sentences; a blank line ends a paragraph. */
export function paragraphs(text: string): string[][] {
  return text
    .split(/\n[ \t]*\n/)
    .map(sentences)
    .filter((paragraph) => paragraph.length > 0)
}

/**
 * `say` hands audio to a macOS speech service that keeps talking when `say` is frozen,
 * so pausing cancels the current sentence and resuming plays it again from its start.
 * The next sentence renders while this one plays, so sentences follow without a gap.
 */
export function speakBySentence(text: string, voice: Voice): Speech {
  const parts: string[] = []
  const paragraphStarts: number[] = []
  for (const paragraph of paragraphs(text)) {
    paragraphStarts.push(parts.length)
    parts.push(...paragraph)
  }
  const clips = new Map<number, Promise<string>>()
  const clip = (part: number) => {
    if (!clips.has(part)) clips.set(part, voice.render(parts[part]))
    return clips.get(part)!
  }
  let index = 0
  // Bumped by every cancel, so a sentence still rendering when cancelled never plays.
  let turn = 0
  let isPlaying = false
  let current: Utterance | null = null
  let finish = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })

  const playNext = async () => {
    if (index >= parts.length) return finish()
    const myTurn = turn
    isPlaying = true
    const rendering = clip(index)
    if (index + 1 < parts.length) void clip(index + 1)
    const file = await rendering
    if (myTurn !== turn) return
    current = voice.play(file)
    await current.ended
    if (myTurn !== turn) return
    index++
    void playNext()
  }
  const cancel = () => {
    turn++
    isPlaying = false
    current?.cancel()
    current = null
  }

  const jumpToParagraph = (paragraph: number) => {
    if (index >= parts.length) return
    cancel()
    index = paragraphStarts[paragraph] ?? parts.length
    void playNext()
  }
  const currentParagraph = () => paragraphStarts.filter((start) => start <= index).length - 1

  void playNext()
  return {
    pause: cancel,
    resume: () => {
      if (!isPlaying) void playNext()
    },
    stop: () => {
      cancel()
      index = parts.length
      finish()
    },
    next: () => jumpToParagraph(currentParagraph() + 1),
    previous: () => jumpToParagraph(Math.max(0, currentParagraph() - 1)),
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
      for (const id of ['previous', 'next', 'stop']) {
        await orca.host.call('statusBar.update', { id, visible: playback !== null })
      }
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

    const navigate = (move: 'next' | 'previous') => async () => {
      if (!playback) return
      playback.speech[move]()
      playback.isPaused = false
      await show()
    }
    orca.commands.register('speak-reply.next', navigate('next'))
    orca.commands.register('speak-reply.previous', navigate('previous'))

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
  // `say` repeats its last word when it exits mid-playback, so it only renders clips and `afplay` plays them.
  speak: (text) => {
    const clipFolder = mkdtempSync(join(tmpdir(), 'speak-reply-'))
    let clipCount = 0
    const speech = speakBySentence(text, {
      // A clip that fails to render makes `afplay` exit at once, so playback skips that sentence.
      render: (sentence) =>
        new Promise((resolve) => {
          const clip = join(clipFolder, `${clipCount++}.aiff`)
          execFile('/usr/bin/say', ['-r', WORDS_PER_MINUTE, '-o', clip, sentence], () => resolve(clip))
        }),
      play: (clip) => {
        const child = spawn('/usr/bin/afplay', [clip], { stdio: 'ignore' })
        return {
          cancel: () => child.kill(),
          ended: new Promise((resolve) => child.on('close', () => resolve())),
        }
      },
    })
    void speech.done.then(() => rmSync(clipFolder, { recursive: true, force: true }))
    return speech
  },
})
