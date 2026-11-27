import { atom, EmptyState, IconButton, List, ListItem, on, plugin, read, Row, set, Spinner, Stack, Text, type PanelContext } from 'orca'
import type { ReplyList } from './requests.ts'

const list = atom<ReplyList | null>(null)
const failure = atom<string | null>(null)

async function load() {
  try {
    set(list, await plugin.request('replies.list'))
    set(failure, null)
  } catch (error) {
    set(failure, error instanceof Error ? error.message : String(error))
  }
}

export function setup(ctx: PanelContext) {
  ctx.subscriptions.push(
    on('workspace.changed', () => void load()),
    on('agent.status.changed', (event) => {
      if (event.state === 'done') void load()
    }),
  )
  void load()
}

export default function RepliesPanel() {
  const current = read(list)
  const error = read(failure)
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Text muted size="sm">
          Click a reply to read it aloud
        </Text>
        <IconButton icon="refresh" label="Refresh replies" variant="ghost" size="sm" onPress={load} />
      </Row>
      {error ? (
        <EmptyState icon="error" title="Couldn't load replies" description={error} />
      ) : !current ? (
        <Spinner label="Loading replies" />
      ) : current.emptyReason ? (
        <EmptyState icon="info" title={current.emptyReason} />
      ) : (
        <List label="Agent replies">
          {current.replies.map((reply, index) => (
            <ListItem
              key={String(index)}
              icon="play"
              title={reply.title}
              description={reply.age}
              onPress={() => plugin.request('replies.play', { speech: reply.speech })}
            />
          ))}
        </List>
      )}
    </Stack>
  )
}
