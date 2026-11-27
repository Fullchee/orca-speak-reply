import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from '../src/panel.tsx'
import type { ListedReply, ReplyList } from '../src/requests.ts'

const reply = (title: string, age: string): ListedReply => ({ title, age, speech: `${title} spoken` })
const twoReplies: ReplyList = { replies: [reply('Done.', 'Latest reply'), reply('Plan', '1 reply ago')], emptyReason: null }

async function mountPanel(answers: (ReplyList | Error)[]) {
  const played: string[] = []
  let calls = 0
  const host = mockHost({
    requests: {
      'replies.list': () => {
        const answer = answers[Math.min(calls++, answers.length - 1)]
        if (answer instanceof Error) throw answer
        return answer
      },
      'replies.play': ({ speech }) => (played.push(speech), null),
    },
  })
  return { view: await mount(panel, { host }), played, listCalls: () => calls }
}

test('lists each reply with its age, and plays the one pressed', async () => {
  const { view, played } = await mountPanel([twoReplies])
  const rows = view.findAll({ type: 'ListItem' })
  assert.deepEqual(rows.map((row) => row.label), ['Done.', 'Plan'])
  assert.match(rows[1].text, /1 reply ago/)
  await view.press(rows[1])
  assert.deepEqual(played, ['Plan spoken'])
  assert.deepEqual(view.errors, [])
})

test('shows why there are no replies', async () => {
  const { view } = await mountPanel([{ replies: [], emptyReason: 'No workspace is focused.' }])
  assert.equal(view.find({ type: 'EmptyState' })?.label, 'No workspace is focused.')
})

test('shows the error when the worker cannot list replies', async () => {
  const { view } = await mountPanel([new Error('orca agent list: boom')])
  assert.match(view.find({ type: 'EmptyState' })?.text ?? '', /boom/)
})

test('reloads on Refresh, a workspace switch, and an agent finishing', async () => {
  const { view, listCalls } = await mountPanel([twoReplies])
  await view.press({ label: 'Refresh replies' })
  await view.emit('workspace.changed', { context: null })
  await view.emit('agent.status.changed', { workspaceId: 'w', paneKey: 'p', state: 'working', receivedAt: 1 })
  await view.emit('agent.status.changed', { workspaceId: 'w', paneKey: 'p', state: 'done', receivedAt: 2 })
  await view.settled()
  assert.equal(listCalls(), 4)
})
