import type { ReplyList } from './requests.ts'

/** Runs the `orca` CLI with these arguments and resolves with its stdout. */
export type RunOrca = (args: string[]) => Promise<string>

type Agent = { orcaSessionId?: string; lastAssistantMessage?: string | null; updatedAt: number }
type Entry = { kind: string; role?: string | null; text?: string }

export const NO_WORKSPACE = 'No workspace is focused.'
export const NO_REPLY = 'No reply to read in this workspace.'

async function orcaJson<T>(runOrca: RunOrca, args: string[]): Promise<T> {
  const answer = JSON.parse(await runOrca([...args, '--json'])) as
    | { ok: true; result: T }
    | { ok: false; error: { message: string } }
  if (!answer.ok) throw new Error(`orca ${args.join(' ')}: ${answer.error.message}`)
  return answer.result
}

/** The full text of the newest agent's replies in a workspace (an Orca worktree selector), newest first. */
export async function recentReplies(workspaceId: string, runOrca: RunOrca): Promise<string[]> {
  const { agents } = await orcaJson<{ agents: Agent[] }>(runOrca, ['agent', 'list', '--worktree', workspaceId])
  const newest = agents
    .filter((agent) => agent.orcaSessionId && agent.lastAssistantMessage)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .at(0)
  if (!newest) return []
  // The list cuts lastAssistantMessage to 200 characters, so read the full history.
  const { entries } = await orcaJson<{ entries: Entry[] }>(runOrca, [
    'agent',
    'read',
    `orca_session_id:${newest.orcaSessionId}`,
    '--limit',
    '100',
  ])
  return entries
    .flatMap((entry) => (entry.kind === 'message' && entry.role === 'assistant' && entry.text ? [entry.text] : []))
    .reverse()
}

/** The words to speak for the newest agent reply in a workspace. */
export async function replyToSpeak(workspaceId: string | undefined, runOrca: RunOrca): Promise<string> {
  if (!workspaceId) return NO_WORKSPACE
  const [newest] = await recentReplies(workspaceId, runOrca)
  return newest ? toSpeech(newest) : NO_REPLY
}

const TITLE_LENGTH = 80

/** What the Replies panel shows for a workspace: each reply's opening words and how far back it is. */
export async function listReplies(workspaceId: string | undefined, runOrca: RunOrca): Promise<ReplyList> {
  if (!workspaceId) return { replies: [], emptyReason: NO_WORKSPACE }
  const replies = (await recentReplies(workspaceId, runOrca)).map((markdown, index) => {
    const speech = toSpeech(markdown)
    const opening = (speech.split('\n').find((line) => /\w/.test(line)) ?? '').replace(/\s+/g, ' ').trim()
    return {
      title: opening.length > TITLE_LENGTH ? `${opening.slice(0, TITLE_LENGTH - 1)}…` : opening,
      age: index === 0 ? 'Latest reply' : index === 1 ? '1 reply ago' : `${index} replies ago`,
      speech,
    }
  })
  return { replies, emptyReason: replies.length ? null : NO_REPLY }
}

/** Speech engines read Markdown syntax aloud, so reduce it to plain sentences. */
export function toSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (link) ')
    .replace(/^[ \t]*\|?[-:| ]+\|?[ \t]*$/gm, '')
    .replace(/[`*_#>|]+/g, ' ')
    .replace(/^[ \t]*[-•][ \t]+/gm, '')
}

/** The CLI ships inside the app bundle that runs this worker; outside one, use `orca` on PATH. */
export function orcaCliPath(execPath: string): string {
  const app = /^(.*?\.app)\/Contents\//.exec(execPath)?.[1]
  return app ? `${app}/Contents/Resources/bin/orca` : 'orca'
}
