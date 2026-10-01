import { expect, test, type APIRequestContext } from '@playwright/test'
import { ensureAccounts, loginApi, RECEPTION, signedInContext, VOLUNTEER } from './accounts'

/**
 * The floor board at the end of the evening (docs/07 task 6.3).
 *
 * `FloorUnderLoadTest` on the backend proves the API still answers quickly with a full
 * evening behind it. "Renders in under a second" is a claim about a browser, though, so it
 * needs one: the board derives a timer state per station, sorts by urgency and paints a
 * card for each, and none of that is exercised by a server-side test.
 *
 * This is slow — it registers 200 people through the real API — so it is off unless asked
 * for: `npm run e2e:load`. The everyday suite stays at ten seconds.
 */

const SEED_TICKETS = Number(process.env.E2E_LOAD_TICKETS ?? 200)

/**
 * A tablet that has been used once already has the fingerprinted bundle cached for a year
 * (see frontend/nginx.conf), so the honest thing to measure is the second visit, not the
 * first. index.html is never cached, so this is still a real page load.
 */
const RENDER_BUDGET_MS = 1000

/** Everyone this spec registered, so it can take them out of the queue again. */
const seededTicketIds: number[] = []

test.describe('floor board under a full evening', () => {
  test.skip(!process.env.E2E_LOAD, 'Set E2E_LOAD=1 to run this — it registers 200 people.')
  test.slow()

  test.beforeAll(async ({ baseURL }) => {
    await ensureAccounts(baseURL!)
    const desk = await loginApi(baseURL!, RECEPTION.username, RECEPTION.password)
    try {
      await seed(desk)
    } finally {
      await desk.dispose()
    }
  })

  /**
   * Put the room back. These 200 people are queued on a shared stack, and leaving them
   * there means the next spec's new arrival is 200th in line and never reaches a station —
   * which is exactly how this spec broke `live-session` the first time it ran.
   */
  test.afterAll(async ({ baseURL }) => {
    const desk = await loginApi(baseURL!, RECEPTION.username, RECEPTION.password)
    try {
      const BATCH = 10
      for (let i = 0; i < seededTicketIds.length; i += BATCH) {
        await Promise.all(
          seededTicketIds.slice(i, i + BATCH).map((id) =>
            desk.post(`/api/tickets/${id}/cancel`, {
              data: { reason: 'Load-test teardown', refund: false },
            }),
          ),
        )
      }
    } finally {
      await desk.dispose()
    }
  })

  test('paints the whole floor within the budget', async ({ browser, baseURL }) => {
    const context = await signedInContext(browser, baseURL!, VOLUNTEER)
    const page = await context.newPage()
    try {
      // First visit warms the asset cache, exactly as bookmarking the board on a tablet
      // does. The measurement below is the one a volunteer actually lives with.
      await page.goto('/floor')
      await expect(page.getByRole('article').first()).toBeVisible()

      const started = Date.now()
      await page.goto('/floor')
      const cards = page.getByRole('article')
      await expect(cards.first()).toBeVisible()
      const elapsed = Date.now() - started

      const painted = await cards.count()
      expect(painted, 'every station should have a card').toBeGreaterThan(5)
      expect(
        elapsed,
        `the board took ${elapsed}ms to paint ${painted} stations with ${SEED_TICKETS}+ tickets behind it`,
      ).toBeLessThan(RENDER_BUDGET_MS)

      // Quick, but quick and wrong is no use: the queue beside the board has to still be
      // showing the crowd. (At this width it is a permanent sidebar, not a tab.)
      await expect(page.getByRole('region', { name: 'Queue' })
        .getByRole('heading', { name: /Queue \d{2,}/ })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})

/** Registers a full evening's worth of people, a handful at a time. */
async function seed(desk: APIRequestContext): Promise<void> {
  const allPlans = await (await desk.get('/api/plans')).json()
  // Sim Sprint and Console Duo pin the preference to their own station, and the server
  // rightly refuses any other. The open plans are the bulk of the evening's sales anyway.
  const plans = allPlans.filter((p: { deviceTypeIds: number[] }) => p.deviceTypeIds.length === 0)
  const floor = await (await desk.get('/api/floor')).json()
  const typeIds: number[] = floor.byDeviceType.map((t: { id: number }) => t.id)
  // Ten digits starting 6-9, and uniquely indexed, so a re-run needs its own block.
  const base = 700_000_000 + Math.floor(Math.random() * 150_000_000)

  const BATCH = 10
  for (let i = 0; i < SEED_TICKETS; i += BATCH) {
    const results = await Promise.all(
      Array.from({ length: Math.min(BATCH, SEED_TICKETS - i) }, (_, n) => {
        const index = i + n
        const plan = plans[index % plans.length]
        return desk.post('/api/tickets', {
          headers: { 'Idempotency-Key': `load-${base}-${index}` },
          data: {
            student: { fullName: `Load Tester ${index}`, phone: `9${base + index}` },
            planId: plan.id,
            preferredDeviceTypeId: typeIds[index % typeIds.length],
            payment: { method: 'CASH', amountPaise: plan.pricePaise },
          },
        })
      }),
    )
    // A seed that fails quietly gives you a load test with nothing loaded, which passes
    // and tells you nothing. The first draft of this did exactly that.
    for (const res of results) {
      if (!res.ok()) throw new Error(`Seeding failed: ${res.status()} ${await res.text()}`)
      seededTicketIds.push((await res.json()).id)
    }
  }

  const queued = (await (await desk.get('/api/queue')).json()).items.length
  if (queued < SEED_TICKETS / 2) {
    throw new Error(`Only ${queued} people are waiting after seeding ${SEED_TICKETS}`)
  }
}
