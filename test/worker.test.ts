import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { NO_WORKSPACE } from '../src/reply.ts'
import { createActivate, type Speech } from '../src/worker.ts'

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
const isStopShown = (worker: Worker) => updates(worker).filter((u) => u.id === 'stop').at(-1)?.visible

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
