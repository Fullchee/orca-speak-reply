/** One reply as the Replies panel lists it; `speech` is what Play reads. */
export type ListedReply = { title: string; age: string; speech: string }

/** The panel's view of the focused workspace: its replies, newest first, or why there are none. */
export type ReplyList = { replies: ListedReply[]; emptyReason: string | null }

declare module 'orca' {
  interface PluginRequests {
    'replies.list': { output: ReplyList }
    'replies.play': { input: { speech: string } }
  }
}
