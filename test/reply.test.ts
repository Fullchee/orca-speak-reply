import { assert, test } from 'orca/testing'
import { listReplies, NO_REPLY, NO_WORKSPACE, orcaCliPath, replyToSpeak, toSpeech, type RunOrca } from '../src/reply.ts'

const WORKSPACE = 'identity:wt2:local:abc'

function fakeOrca(answers: Record<string, unknown>): RunOrca & { calls: string[][] } {
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    const answer = answers[args.slice(0, 2).join(' ')]
    if (answer === undefined) throw new Error(`unexpected orca ${args.join(' ')}`)
    return JSON.stringify(answer)
  }
  return Object.assign(run, { calls })
}

const agents = (list: unknown[]) => ({ ok: true, result: { agents: list } })
const entries = (list: unknown[]) => ({ ok: true, result: { entries: list } })

test('says no workspace is focused when Orca names none', async () => {
  const orca = fakeOrca({})
  assert.equal(await replyToSpeak(undefined, orca), NO_WORKSPACE)
  assert.equal(orca.calls.length, 0)
})

test('reads the full last reply of the most recently updated agent', async () => {
  const orca = fakeOrca({
    'agent list': agents([
      { orcaSessionId: 'old', lastAssistantMessage: 'hi', updatedAt: 1 },
      { orcaSessionId: 'new', lastAssistantMessage: 'cut…', updatedAt: 2 },
      { orcaSessionId: 'silent', lastAssistantMessage: null, updatedAt: 3 },
    ]),
    'agent read': entries([
      { kind: 'message', role: 'assistant', text: 'First' },
      { kind: 'tool', role: null },
      { kind: 'message', role: 'user', text: 'Thanks' },
      { kind: 'message', role: 'assistant', text: 'The **full** reply' },
    ]),
  })
  assert.equal(await replyToSpeak(WORKSPACE, orca), 'The  full  reply')
  assert.deepEqual(orca.calls, [
    ['agent', 'list', '--worktree', WORKSPACE, '--json'],
    ['agent', 'read', 'orca_session_id:new', '--limit', '100', '--json'],
  ])
})

test('says there is no reply when no agent has answered', async () => {
  const orca = fakeOrca({ 'agent list': agents([{ orcaSessionId: 'a', lastAssistantMessage: null, updatedAt: 1 }]) })
  assert.equal(await replyToSpeak(WORKSPACE, orca), NO_REPLY)
})

test('says there is no reply when the history holds no assistant message', async () => {
  const orca = fakeOrca({
    'agent list': agents([{ orcaSessionId: 'a', lastAssistantMessage: 'x', updatedAt: 1 }]),
    'agent read': entries([{ kind: 'message', role: 'user', text: 'hello' }]),
  })
  assert.equal(await replyToSpeak(WORKSPACE, orca), NO_REPLY)
})

test('names the CLI error when Orca refuses the lookup', async () => {
  const orca = fakeOrca({ 'agent list': { ok: false, error: { message: 'No such workspace' } } })
  await assert.rejects(replyToSpeak(WORKSPACE, orca), /No such workspace/)
})

test('reduces Markdown to plain sentences', () => {
  const markdown = [
    '# Title',
    '- **Bold** item with [a link](https://example.com)',
    'See https://example.com/page now.',
    '| a | b |',
    '| --- | --- |',
    '```ts',
    'const x = 1',
    '```',
  ].join('\n')
  assert.equal(
    toSpeech(markdown),
    ['  Title', 'Bold  item with a link', 'See  (link)  now.', '  a   b  ', '', ' (code block) '].join('\n'),
  )
})

test('finds the CLI in the app bundle running the worker', () => {
  assert.equal(
    orcaCliPath('/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper'),
    '/Applications/Orca.app/Contents/Resources/bin/orca',
  )
})

test('falls back to orca on PATH outside an app bundle', () => {
  assert.equal(orcaCliPath('/usr/local/bin/node'), 'orca')
})

test('lists replies newest first with their opening words and age', async () => {
  const long = `${'word '.repeat(30)}end`
  const orca = fakeOrca({
    'agent list': agents([{ orcaSessionId: 'a', lastAssistantMessage: 'x', updatedAt: 1 }]),
    'agent read': entries([
      { kind: 'message', role: 'assistant', text: long },
      { kind: 'message', role: 'assistant', text: '' },
      { kind: 'message', role: 'assistant', text: '# Plan\n\nStep one.' },
      { kind: 'message', role: 'user', text: 'Go' },
      { kind: 'message', role: 'assistant', text: 'Done.' },
    ]),
  })
  const { replies, emptyReason } = await listReplies(WORKSPACE, orca)
  assert.equal(emptyReason, null)
  assert.deepEqual(
    replies.map(({ title, age }) => [title, age]),
    [
      ['Done.', 'Latest reply'],
      ['Plan', '1 reply ago'],
      [`${'word '.repeat(15)}word…`, '2 replies ago'],
    ],
  )
  assert.equal(replies[1].speech, '  Plan\n\nStep one.')
})

test('lists nothing, with the reason, when no workspace is focused', async () => {
  assert.deepEqual(await listReplies(undefined, fakeOrca({})), { replies: [], emptyReason: NO_WORKSPACE })
})

test('lists nothing, with the reason, when no agent has answered', async () => {
  const orca = fakeOrca({ 'agent list': agents([]) })
  assert.deepEqual(await listReplies(WORKSPACE, orca), { replies: [], emptyReason: NO_REPLY })
})
