import type { LiveEvent } from '@/types/api'

// Stands in for GET /api/stream. Events published in one tab reach every other tab
// through a BroadcastChannel, so two browsers side by side behave like two staff devices.

type Listener = (event: LiveEvent) => void

const listeners = new Set<Listener>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ppx.mock.events') : null

channel?.addEventListener('message', (m: MessageEvent<LiveEvent[]>) => {
  for (const e of m.data) deliver(e)
})

function deliver(event: LiveEvent) {
  listeners.forEach((l) => l(event))
}

export const eventBus = {
  publish(events: LiveEvent[]) {
    if (events.length === 0) return
    events.forEach(deliver)
    channel?.postMessage(events)
  },
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
