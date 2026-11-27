import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { NO_WORKSPACE } from '../src/reply.ts'
import { createActivate, paragraphs, sentences, speakBySentence, type Speech, type Utterance } from '../src/worker.ts'

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

function fakeUtterances() {
  const said: string[] = []
  const cancelled: string[] = []
  let end = () => {}
  const utter = (sentence: string): Utterance => {
    said.push(sentence)
    const ended = new Promise<void>((resolve) => {
      end = resolve
    })
    return { cancel: () => (cancelled.push(sentence), end()), ended }
  }
  return { utter, said, cancelled, end: () => end() }
}

test('splits text into sentences and lines, skipping blank ones', () => {
  assert.deepEqual(sentences('One. Two? Three!\n- four\n\n  \nFive'), ['One.', 'Two?', 'Three!', '- four', 'Five'])
})

test('groups sentences into paragraphs split by blank lines', () => {
  assert.deepEqual(paragraphs('One. Two.\n- three\n \n\nFour.\n\n  '), [['One.', 'Two.', '- three'], ['Four.']])
})

const threeParagraphs = 'One. Two.\n\nThree. Four.\n\nFive.'

test('next jumps to the start of the next paragraph', () => {
  const fake = fakeUtterances()
  const speech = speakBySentence(threeParagraphs, fake.utter)
  speech.next()
  speech.next()
  assert.deepEqual(fake.said, ['One.', 'Three.', 'Five.'])
})

test('next in the last paragraph finishes the speech', async () => {
  const fake = fakeUtterances()
  const speech = speakBySentence('One.\n\nTwo.', fake.utter)
  let isDone = false
  void speech.done.then(() => (isDone = true))
  speech.next()
  speech.next()
  await tick()
  assert.equal(isDone, true)
  assert.deepEqual(fake.said, ['One.', 'Two.'])
})

test('previous jumps to the start of the previous paragraph', async () => {
  const fake = fakeUtterances()
  const speech = speakBySentence(threeParagraphs, fake.utter)
  speech.next()
  fake.end()
  await tick()
  speech.previous()
  assert.deepEqual(fake.said, ['One.', 'Three.', 'Four.', 'One.'])
})

test('previous in the first paragraph restarts it', async () => {
  const fake = fakeUtterances()
  const speech = speakBySentence(threeParagraphs, fake.utter)
  fake.end()
  await tick()
  speech.previous()
  assert.deepEqual(fake.said, ['One.', 'Two.', 'One.'])
})

test('navigating a paused speech plays from the new paragraph', () => {
  const fake = fakeUtterances()
  const speech = speakBySentence(threeParagraphs, fake.utter)
  speech.pause()
  speech.next()
  assert.deepEqual(fake.said, ['One.', 'Three.'])
})

test('navigating a stopped speech says nothing', () => {
  const fake = fakeUtterances()
  const speech = speakBySentence(threeParagraphs, fake.utter)
  speech.stop()
  speech.next()
  speech.previous()
  assert.deepEqual(fake.said, ['One.'])
})

test('speaks each sentence in turn, then finishes', async () => {
  const fake = fakeUtterances()
  let isDone = false
  void speakBySentence('One. Two.', fake.utter).done.then(() => (isDone = true))
  fake.end()
  await tick()
  fake.end()
  await tick()
  assert.deepEqual(fake.said, ['One.', 'Two.'])
  assert.equal(isDone, true)
})

test('pausing cancels the current sentence and resuming speaks it again', async () => {
  const fake = fakeUtterances()
  const speech = speakBySentence('One. Two.', fake.utter)
  fake.end()
  await tick()
  speech.pause()
  await tick()
  speech.resume()
  speech.resume()
  assert.deepEqual(fake.cancelled, ['Two.'])
  assert.deepEqual(fake.said, ['One.', 'Two.', 'Two.'])
})

test('stopping cancels the sentence and finishes without speaking more', async () => {
  const fake = fakeUtterances()
  const speech = speakBySentence('One. Two.', fake.utter)
  let isDone = false
  void speech.done.then(() => (isDone = true))
  speech.stop()
  await tick()
  speech.resume()
  assert.deepEqual(fake.said, ['One.'])
  assert.equal(isDone, true)
})

test('finishes at once when there is nothing to say', async () => {
  const fake = fakeUtterances()
  let isDone = false
  void speakBySentence('  ', fake.utter).done.then(() => (isDone = true))
  await tick()
  assert.equal(isDone, true)
  assert.deepEqual(fake.said, [])
})
