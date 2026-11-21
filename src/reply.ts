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

/** The words to speak for the newest agent reply in a workspace (an Orca worktree selector). */
export async function replyToSpeak(workspaceId: string | undefined, runOrca: RunOrca): Promise<string> {
  if (!workspaceId) return NO_WORKSPACE
  const { agents } = await orcaJson<{ agents: Agent[] }>(runOrca, ['agent', 'list', '--worktree', workspaceId])
  const newest = agents
    .filter((agent) => agent.orcaSessionId && agent.lastAssistantMessage)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .at(0)
  if (!newest) return NO_REPLY
  // The list cuts lastAssistantMessage to 200 characters, so read the full history.
  const { entries } = await orcaJson<{ entries: Entry[] }>(runOrca, [
    'agent',
    'read',
    `orca_session_id:${newest.orcaSessionId}`,
    '--limit',
    '100',
  ])
  const text = entries.filter((entry) => entry.kind === 'message' && entry.role === 'assistant').at(-1)?.text
  return text ? toSpeech(text) : NO_REPLY
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
