// Tiny in-memory hand-off so other screens (document detail, graph) can send a
// pre-filled question to the Chat tab. The chat screen consumes it on focus.

let pending: string | null = null;

export function setPendingQuestion(q: string): void {
  pending = q;
}

/** Return and clear the pending question (one-shot). */
export function takePendingQuestion(): string | null {
  const q = pending;
  pending = null;
  return q;
}
