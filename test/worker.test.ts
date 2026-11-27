import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { NO_WORKSPACE } from '../src/reply.ts'
import { createActivate, paragraphs, sentences, speakBySentence, type Speech, type Utterance, type Voice } from '../src/worker.ts'

function fakeSpeaker() {
  const spoken: string[] = []
  const calls: string[] = []
  let finish = () => {}
  const speak = (text: string): Speech => {
    spoken.push(text)
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    return {
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
      stop: () => (calls.push('stop'), finish()),
      next: () => calls.push('next'),
      previous: () => calls.push('previous'),
      done,
    }
  }
  return { speak, spoken, calls, finish: () => finish() }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function mount(context: unknown) {
  const speaker = fakeSpeaker()
  const runOrca = async (args: string[]) => {
    const answer =
      args[1] === 'list'
        ? { agents: [{ orcaSessionId: 's', lastAssistantMessage: 'x', updatedAt: 1 }] }
        : { entries: [{ kind: 'message', role: 'assistant', text: 'Done.' }] }
    return JSON.stringify({ ok: true, result: answer })
  }
  const worker = await mountWorker({ default: createActivate({ runOrca, speak: speaker.speak }) }, {
    host: mockHost({ results: { 'workspace.readContext': context, 'statusBar.update': { ok: true } } }),
  })
  return { worker, speaker }
}

type Worker = Awaited<ReturnType<typeof mount>>['worker']
type StatusUpdate = { id: string; text?: string; visible?: boolean }

const updates = (worker: Worker) => worker.host.callsOf('statusBar.update') as StatusUpdate[]
const mainLabels = (worker: Worker) => updates(worker).flatMap((u) => (u.id === 'speak' ? [u.text] : []))
const isShown = (worker: Worker, id: string) => updates(worker).filter((u) => u.id === id).at(-1)?.visible
const isStopShown = (worker: Worker) => isShown(worker, 'stop')

const focused = { workspaceId: 'identity:w', branch: 'b', displayName: 'b', terminals: [] }

test('hides Stop and shows Read reply when nothing is playing', async () => {
  const { worker } = await mount(focused)
  await tick()
  assert.deepEqual(mainLabels(worker), ['Read reply'])
  assert.equal(isStopShown(worker), false)
})

test('speaks the focused workspace reply and shows Pause and Stop until it ends', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.toggle')
  assert.deepEqual(speaker.spoken, ['Done.'])
  assert.deepEqual(mainLabels(worker), ['Read reply', 'Pause'])
  assert.equal(isStopShown(worker), true)
  speaker.finish()
  await tick()
  assert.deepEqual(mainLabels(worker), ['Read reply', 'Pause', 'Read reply'])
  assert.equal(isStopShown(worker), false)
})

test('pressing again pauses, and pressing once more resumes the same speech', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.toggle')
  assert.deepEqual(speaker.calls, ['pause', 'resume'])
  assert.equal(speaker.spoken.length, 1)
  assert.deepEqual(mainLabels(worker), ['Read reply', 'Pause', 'Resume', 'Pause'])
  assert.equal(isStopShown(worker), true)
})

test('Stop ends a paused speech so the next press reads from the start', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.stop')
  await tick()
  assert.deepEqual(speaker.calls, ['pause', 'stop'])
  assert.equal(mainLabels(worker).at(-1), 'Read reply')
  assert.equal(isStopShown(worker), false)
  await worker.command('speak-reply.toggle')
  assert.equal(speaker.spoken.length, 2)
})

test('shows Back and Next only while a reply plays', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.toggle')
  assert.deepEqual([isShown(worker, 'previous'), isShown(worker, 'next')], [true, true])
  speaker.finish()
  await tick()
  assert.deepEqual([isShown(worker, 'previous'), isShown(worker, 'next')], [false, false])
})

test('Next and Back jump paragraphs and leave the reply playing', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.next')
  await worker.command('speak-reply.previous')
  assert.deepEqual(speaker.calls, ['pause', 'next', 'previous'])
  assert.equal(mainLabels(worker).at(-1), 'Pause')
})

test('Next and Back do nothing when nothing is playing', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.next')
  await worker.command('speak-reply.previous')
  assert.deepEqual(speaker.calls, [])
})

test('Stop does nothing when nothing is playing', async () => {
  const { worker, speaker } = await mount(focused)
  await worker.command('speak-reply.stop')
  assert.deepEqual(speaker.calls, [])
})

test('says no workspace is focused when Orca has none', async () => {
  const { worker, speaker } = await mount(null)
  await worker.command('speak-reply.toggle')
  assert.deepEqual(speaker.spoken, [NO_WORKSPACE])
})

function fakeVoice() {
  const rendered: string[] = []
  const said: string[] = []
  const cancelled: string[] = []
  let end = () => {}
  const voice: Voice = {
    render: async (sentence) => (rendered.push(sentence), sentence),
    play: (clip): Utterance => {
      said.push(clip)
      const ended = new Promise<void>((resolve) => {
        end = resolve
      })
      return { cancel: () => (cancelled.push(clip), end()), ended }
    },
  }
  return { voice, rendered, said, cancelled, end: () => end() }
}

/** Ends the playing sentence and lets the next one start. */
async function endSentence(fake: ReturnType<typeof fakeVoice>) {
  fake.end()
  await tick()
}

test('splits text into sentences and lines, skipping blank ones', () => {
  assert.deepEqual(sentences('One. Two? Three!\n- four\n\n  \nFive'), ['One.', 'Two?', 'Three!', '- four', 'Five'])
})

test('groups sentences into paragraphs split by blank lines', () => {
  assert.deepEqual(paragraphs('One. Two.\n- three\n \n\nFour.\n\n  '), [['One.', 'Two.', '- three'], ['Four.']])
})

const threeParagraphs = 'One. Two.\n\nThree. Four.\n\nFive.'

test('next jumps to the start of the next paragraph', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence(threeParagraphs, fake.voice)
  await tick()
  speech.next()
  await tick()
  speech.next()
  await tick()
  assert.deepEqual(fake.said, ['One.', 'Three.', 'Five.'])
})

test('next in the last paragraph finishes the speech', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence('One.\n\nTwo.', fake.voice)
  let isDone = false
  void speech.done.then(() => (isDone = true))
  await tick()
  speech.next()
  await tick()
  speech.next()
  await tick()
  assert.equal(isDone, true)
  assert.deepEqual(fake.said, ['One.', 'Two.'])
})

test('previous jumps to the start of the previous paragraph', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence(threeParagraphs, fake.voice)
  await tick()
  speech.next()
  await tick()
  await endSentence(fake)
  speech.previous()
  await tick()
  assert.deepEqual(fake.said, ['One.', 'Three.', 'Four.', 'One.'])
})

test('previous in the first paragraph restarts it', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence(threeParagraphs, fake.voice)
  await tick()
  await endSentence(fake)
  speech.previous()
  await tick()
  assert.deepEqual(fake.said, ['One.', 'Two.', 'One.'])
})

test('navigating a paused speech plays from the new paragraph', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence(threeParagraphs, fake.voice)
  await tick()
  speech.pause()
  speech.next()
  await tick()
  assert.deepEqual(fake.said, ['One.', 'Three.'])
})

test('navigating a stopped speech says nothing', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence(threeParagraphs, fake.voice)
  await tick()
  speech.stop()
  speech.next()
  speech.previous()
  await tick()
  assert.deepEqual(fake.said, ['One.'])
})

test('speaks each sentence in turn, then finishes', async () => {
  const fake = fakeVoice()
  let isDone = false
  void speakBySentence('One. Two.', fake.voice).done.then(() => (isDone = true))
  await tick()
  await endSentence(fake)
  await endSentence(fake)
  assert.deepEqual(fake.said, ['One.', 'Two.'])
  assert.equal(isDone, true)
})

test('renders the next sentence while the current one plays, and each sentence once', async () => {
  const fake = fakeVoice()
  speakBySentence('One. Two. Three.', fake.voice)
  await tick()
  assert.deepEqual(fake.rendered, ['One.', 'Two.'])
  await endSentence(fake)
  assert.deepEqual(fake.rendered, ['One.', 'Two.', 'Three.'])
})

test('pausing cancels the current sentence and resuming plays it again', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence('One. Two.', fake.voice)
  await tick()
  await endSentence(fake)
  speech.pause()
  await tick()
  speech.resume()
  speech.resume()
  await tick()
  assert.deepEqual(fake.cancelled, ['Two.'])
  assert.deepEqual(fake.said, ['One.', 'Two.', 'Two.'])
})

test('pausing while a sentence renders keeps it from playing', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence('One.', fake.voice)
  speech.pause()
  await tick()
  assert.deepEqual(fake.said, [])
})

test('stopping cancels the sentence and finishes without speaking more', async () => {
  const fake = fakeVoice()
  const speech = speakBySentence('One. Two.', fake.voice)
  let isDone = false
  void speech.done.then(() => (isDone = true))
  await tick()
  speech.stop()
  await tick()
  speech.resume()
  await tick()
  assert.deepEqual(fake.said, ['One.'])
  assert.equal(isDone, true)
})

test('finishes at once when there is nothing to say', async () => {
  const fake = fakeVoice()
  let isDone = false
  void speakBySentence('  ', fake.voice).done.then(() => (isDone = true))
  await tick()
  assert.equal(isDone, true)
  assert.deepEqual(fake.said, [])
})
