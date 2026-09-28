import { expect, test, type Locator } from '@playwright/test'
import { ensureAccounts, RECEPTION, signedInContext, VOLUNTEER } from './accounts'

/**
 * One turn, start to finish, across two screens (docs/06 §8).
 *
 * Both people are open at the same time and neither screen is ever reloaded after the
 * first one. That is the whole point: every assertion on the volunteer's screen about
 * something reception just did, and vice versa, is a live update that had to cross SSE to
 * get there. A test that reloaded between steps would pass just as happily with the stream
 * completely broken, which is why the desk moves between its tabs by clicking the nav.
 */

const PHONE = `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`
const NAME = `E2E Player ${PHONE.slice(-4)}`

test.beforeAll(async ({ baseURL }) => {
  await ensureAccounts(baseURL!)
})

test('a turn from the desk to the floor, live on both screens', async ({ browser, baseURL }) => {
  const receptionContext = await signedInContext(browser, baseURL!, RECEPTION)
  const volunteerContext = await signedInContext(browser, baseURL!, VOLUNTEER)
  const desk = await receptionContext.newPage()
  const floor = await volunteerContext.newPage()

  try {
    await floor.goto('/floor')
    await expect(floor.getByRole('status', { name: /live/i }).or(floor.getByText('Live', { exact: true })))
      .toBeVisible()

    // ── the desk ─────────────────────────────────────────────────────────────
    await desk.goto('/reception/register')
    await desk.getByLabel('Phone number').fill(PHONE)
    await desk.getByLabel('Full name').fill(NAME)
    await desk.getByRole('radio', { name: /laptop/i }).check()
    await desk.getByRole('button', { name: /^Quick Play/ }).click()
    await desk.getByRole('button', { name: /^Register/ }).click()
    await expect(desk.getByText(/PPX-\d{4}/).first()).toBeVisible()
    const ticketNo = (await desk.getByText(/PPX-\d{4}/).first().innerText()).match(/PPX-\d{4}/)![0]

    // ── it reaches the floor on its own ──────────────────────────────────────
    // No reload here, and none anywhere below. This is the assertion the whole file is for:
    // nobody told this screen anything, and the new arrival shows up on a station anyway.
    //
    // Which station is not ours to choose. Next-up is handed out one ticket per free
    // station in queue order, so anyone already waiting is ahead of us — the test asks
    // where this ticket landed rather than assuming.
    const arrival = floor.getByRole('article').filter({ hasText: ticketNo }).first()
    await expect(arrival).toBeVisible()
    const station = await stationCode(arrival)
    const card = floor.getByRole('article', { name: new RegExp(`^${station}`) })

    // ── assign ───────────────────────────────────────────────────────────────
    await card.getByRole('button', { name: 'Assign' }).click()
    const sheet = floor.getByRole('dialog')
    await expect(sheet).toContainText(ticketNo)
    await sheet.getByRole('button', { name: /Start session/ }).click()
    await expect(card).toContainText(/IN USE/i)

    // The desk sees where they went without asking. In-app links, not page loads: a
    // reload would fetch the answer fresh and prove nothing about the stream.
    await desk.getByRole('link', { name: 'Registrations' }).click()
    await expect(desk.getByRole('row', { name: new RegExp(ticketNo) })).toContainText(station)

    // ── extend, unpaid ───────────────────────────────────────────────────────
    await card.getByRole('button', { name: '15' }).click()
    const extend = floor.getByRole('dialog')
    await expect(extend).toContainText(/Collect ₹30 at reception/)
    await extend.getByRole('button', { name: 'Extend', exact: true }).click()
    await expect(card).toContainText(/Pay at desk/i)

    // ...and the money lands on the desk's Dues tab, live.
    await desk.getByRole('link', { name: 'Dues' }).click()
    // By role, not by text: the live-region announcer holds the ticket number too, and it
    // is still in the DOM precisely because this page was never reloaded.
    const dueRow = desk.getByRole('button', { name: new RegExp(`${ticketNo}.*Payment due`) })
    await expect(dueRow).toBeVisible()
    await expect(dueRow).toContainText('₹30')

    // ── end ──────────────────────────────────────────────────────────────────
    await card.getByRole('button', { name: 'End', exact: true }).click()
    const end = floor.getByRole('dialog')
    await end.getByRole('button', { name: /End session/ }).click()
    await expect(card).toContainText(/CLEANING/i)

    // A finished turn still owes ₹30 — ending a session never collects money.
    await expect(dueRow).toBeVisible()
  } finally {
    await receptionContext.close()
    await volunteerContext.close()
  }
})

/** A card's station code, from the label the board already gives screen readers. */
async function stationCode(card: Locator): Promise<string> {
  const label = await card.getAttribute('aria-label')
  const code = label?.match(/^[A-Z0-9]+-\d+/)?.[0]
  if (!code) throw new Error(`Could not read a station code from ${label}`)
  return code
}
