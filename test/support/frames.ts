/**
 * A manual `requestAnimationFrame`. @effect/ui-kit settles its open/close transitions on animation frames
 * (`internal/transition.js`), and happy-dom drives those from real timers. Under test the frames queue here
 * instead, and `flushFrames` runs them: a test decides when a frame happens, like it decides when the
 * `TestClock` moves.
 */
const queue = new Map<number, FrameRequestCallback>()
let nextId = 1

export const requestFrame = (callback: FrameRequestCallback): number => {
  const id = nextId++
  queue.set(id, callback)
  return id
}

export const cancelFrame = (id: number): void => {
  queue.delete(id)
}

/** Runs every queued frame callback (one frame), and returns how many ran. Callbacks queued by those wait. */
export const flushFrames = (): number => {
  const frame = [...queue]
  queue.clear()
  for (const [, callback] of frame) callback(0)
  return frame.length
}

/** Discards any un-flushed animation frames between tests. */
export const resetFrames = (): void => {
  queue.clear()
  nextId = 1
}
