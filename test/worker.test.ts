import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { NO_WORKSPACE } from '../src/reply.ts'
import { createActivate, type Speech } from '../src/worker.ts'

function fakeSpeaker() {
  const spoken: string[] = []
  let finish = () => {}
  let stops = 0
  const speak = (text: string): Speech => {
    spoken.push(text)
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    return { stop: () => (stops++, finish()), done }
  }
  return { speak, spoken, finish: () => finish(), stops: () => stops }
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

const statusTexts = (worker: Awaited<ReturnType<typeof mount>>['worker']) =>
  worker.host.callsOf('statusBar.update').map((params) => (params as { text: string }).text)

test('speaks the focused workspace reply and shows Stop until it ends', async () => {
  const { worker, speaker } = await mount({ workspaceId: 'identity:w', branch: 'b', displayName: 'b', terminals: [] })
  await worker.command('speak-reply.toggle')
  assert.deepEqual(speaker.spoken, ['Done.'])
  assert.deepEqual(statusTexts(worker), ['Stop'])
  speaker.finish()
  await tick()
  assert.deepEqual(statusTexts(worker), ['Stop', 'Read reply'])
})

test('a second press stops the speech instead of starting another', async () => {
  const { worker, speaker } = await mount({ workspaceId: 'identity:w', branch: 'b', displayName: 'b', terminals: [] })
  await worker.command('speak-reply.toggle')
  await worker.command('speak-reply.toggle')
  await tick()
  assert.equal(speaker.stops(), 1)
  assert.equal(speaker.spoken.length, 1)
  assert.deepEqual(statusTexts(worker), ['Stop', 'Read reply'])
})

test('says no workspace is focused when Orca has none', async () => {
  const { worker, speaker } = await mount(null)
  await worker.command('speak-reply.toggle')
  assert.deepEqual(speaker.spoken, [NO_WORKSPACE])
})
