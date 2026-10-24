import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

type Role = 'ADMIN' | 'VOTER' | null

const election = (status: string) => ({
  id: 'e1',
  title: 'Student Council President 2026',
  description: 'Annual election for the student council.',
  status,
  startsAt: '2026-11-01T04:00:00Z',
  endsAt: '2026-11-01T12:00:00Z',
  candidates: [
    { id: 'c1', name: 'Aisha Ishfaq', party: 'Blue Alliance', symbolUrl: null },
    { id: 'c2', name: 'Zainab Noor', party: 'Green Front', symbolUrl: null },
    { id: 'c3', name: 'Bilal Ahmed', party: 'Independent', symbolUrl: null },
  ],
})
const results = {
  election: { id: 'e1', title: 'Student Council President 2026', endsAt: '2026-11-01T12:00:00Z' },
  status: 'CLOSED',
  consistent: true,
  turnout: { voted: 812, eligible: 1040, percent: 78.1 },
  totalVotes: 812,
  results: [
    { candidateId: 'c2', name: 'Zainab Noor', party: 'Green Front', votes: 401, percent: 49.4 },
    { candidateId: 'c1', name: 'Aisha Ishfaq', party: 'Blue Alliance', votes: 298, percent: 36.7 },
    { candidateId: 'c3', name: 'Bilal Ahmed', party: 'Independent', votes: 113, percent: 13.9 },
  ],
}

/** Answers every /api call the pages make, as a signed-in admin, voter, or nobody. */
async function mockApi(page: Page, role: Role, electionStatus = 'ACTIVE') {
  const fixtures: Record<string, unknown> = {
    'POST /api/auth/refresh': role ? { accessToken: 't', role } : null,
    'GET /api/health': { status: 'ok' },
    'GET /api/me': {
      id: 'v1',
      name: 'Aisha Ishfaq',
      email: 'aisha@example.com',
      status: 'APPROVED',
    },
    'GET /api/admin/me': { id: 'a1', name: 'Admin', email: 'admin@example.com' },
    'GET /api/elections/active': [{ ...election('ACTIVE'), hasVoted: false, open: true }],
    'GET /api/elections/published': [
      { id: 'e0', title: 'Society Treasurer 2025', endsAt: '2025-11-01T12:00:00Z' },
    ],
    'GET /api/me/participation': [
      {
        id: 'e0',
        title: 'Society Treasurer 2025',
        status: 'PUBLISHED',
        votedAt: '2025-11-01T06:12:00Z',
      },
    ],
    'GET /api/elections/e1/candidates': {
      election: election('ACTIVE'),
      candidates: election('ACTIVE').candidates,
    },
    'GET /api/elections/e1/results': results,
    'GET /api/admin/elections': [{ ...election(electionStatus), candidateCount: 3 }],
    'GET /api/admin/elections/e1': election(electionStatus),
    'GET /api/admin/elections/e1/turnout': results.turnout,
    'GET /api/admin/elections/e1/results': results,
    'GET /api/admin/voters': {
      total: 2,
      items: [
        {
          id: 'v1',
          name: 'Aisha Ishfaq',
          email: 'aisha@example.com',
          cnic: '35202-1234567-1',
          status: 'PENDING',
          createdAt: '2026-10-20T08:00:00Z',
        },
        {
          id: 'v2',
          name: 'Zainab Noor',
          email: 'zainab@example.com',
          cnic: '35202-7654321-2',
          status: 'LOCKED',
          createdAt: '2026-10-21T08:00:00Z',
        },
      ],
    },
    'GET /api/admin/fraud-alerts': {
      total: 1,
      openBySeverity: { HIGH: 1 },
      items: [
        {
          id: 'f1',
          type: 'REPEATED_FAILED_LOGINS',
          severity: 'HIGH',
          status: 'OPEN',
          score: null,
          description: '5 failed sign-in attempts within the window',
          details: { failures: 5 },
          createdAt: '2026-10-24T08:00:00Z',
          election: null,
          voter: { id: 'v2', name: 'Zainab Noor', cnic: '35202-7654321-2', status: 'LOCKED' },
        },
      ],
    },
    'GET /api/admin/audit-log': {
      total: 1,
      page: 1,
      pageSize: 25,
      items: [
        {
          id: 1,
          actorType: 'ADMIN',
          actorId: 'a1',
          action: 'ELECTION_CREATED',
          payload: { electionId: 'e1' },
          createdAt: '2026-10-24T08:00:00Z',
        },
      ],
    },
    'GET /api/admin/settings': { 'face.matchThreshold': 0.363, 'fraud.maxFailedLogins': 5 },
    'GET /api/admin/recovery-requests': [],
  }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const key = `${route.request().method()} ${url.pathname}`
    const body = fixtures[key]
    if (body === undefined || body === null) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      })
    } else {
      await route.fulfill({ status: 200, json: body })
    }
  })
}

const PAGES: { path: string; role: Role; heading: string | RegExp; status?: string }[] = [
  { path: '/', role: null, heading: 'Smart E-Voting System' },
  { path: '/register', role: null, heading: 'Voter registration' },
  { path: '/login', role: null, heading: 'Voter sign in' },
  { path: '/admin/login', role: null, heading: 'Admin sign in' },
  { path: '/voter', role: 'VOTER', heading: 'Open elections' },
  { path: '/voter/elections/e1', role: 'VOTER', heading: 'Student Council President 2026' },
  { path: '/voter/elections/e1/results', role: 'VOTER', heading: /results/ },
  { path: '/admin/elections', role: 'ADMIN', heading: 'Elections' },
  {
    path: '/admin/elections/e1',
    role: 'ADMIN',
    heading: 'Student Council President 2026',
    status: 'ACTIVE',
  },
  {
    path: '/admin/elections/e1',
    role: 'ADMIN',
    heading: 'Student Council President 2026',
    status: 'CLOSED',
  },
  { path: '/admin/voters', role: 'ADMIN', heading: 'Voters' },
  { path: '/admin/fraud', role: 'ADMIN', heading: 'Fraud alerts' },
  { path: '/admin/audit-log', role: 'ADMIN', heading: 'Audit log' },
  { path: '/admin/settings', role: 'ADMIN', heading: 'System settings' },
  { path: '/admin/recovery', role: 'ADMIN', heading: 'Device recovery requests' },
]

for (const p of PAGES) {
  test(`${p.path}${p.status ? ` (${p.status})` : ''}: fits the screen and passes axe`, async ({
    page,
  }, info) => {
    await mockApi(page, p.role, p.status)
    await page.goto(p.path)
    await expect(page.getByRole('heading', { name: p.heading }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: `e2e/.results/screens/${info.project.name}${p.path.replaceAll('/', '_') || '_home'}${p.status ? `_${p.status}` : ''}.png`,
      fullPage: true,
    })

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0)

    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([])

  })
}

test('ballot is usable by keyboard alone', async ({ page }) => {
  await mockApi(page, 'VOTER')
  await page.goto('/voter/elections/e1')
  await page.getByRole('radio').first().focus()
  await page.keyboard.press('ArrowDown') // radios move with arrow keys
  await expect(page.getByRole('radio', { name: /Zainab Noor/ })).toBeChecked()
  await page.getByRole('button', { name: 'Review my vote' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('You are voting for')).toBeVisible()
})
