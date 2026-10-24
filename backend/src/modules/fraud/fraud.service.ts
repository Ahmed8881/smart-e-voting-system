import type { Deps } from '../../app.js'
import type { Db } from '../../db.js'
import type { Prisma, Severity } from '../../generated/prisma/client.js'
import { appendAudit } from '../audit/audit.service.js'
import { getSettings } from '../settings/settings.js'

export type AlertInput = {
  type: string
  severity: Severity
  description: string
  details: Prisma.InputJsonValue
  voterId?: string | null
  electionId?: string | null
  score?: number | null
}

/**
 * Creates a fraud alert (UC-18). A HIGH alert about a voter also LOCKS their account until an
 * admin reviews it (brief §8) — locking is a rule decision, never the anomaly model's.
 */
export async function raiseAlert(db: Db, alert: AlertInput) {
  const created = await db.fraudAlert.create({ data: alert })
  if (alert.severity === 'HIGH' && alert.voterId) {
    const { count } = await db.voter.updateMany({
      where: { id: alert.voterId, status: { in: ['APPROVED', 'PENDING'] } },
      data: { status: 'LOCKED' },
    })
    if (count > 0) {
      await appendAudit(db, {
        actorType: 'SYSTEM',
        action: 'VOTER_LOCKED',
        payload: { voterId: alert.voterId, alertId: created.id, alertType: alert.type },
      })
    }
  }
  return created
}

export type AuthEventInput = {
  type: 'REGISTRATION' | 'FACE' | 'LIVENESS' | 'WEBAUTHN'
  success: boolean
  voterId?: string | null
  cnicAttempted?: string | null
  ip: string
  userAgent: string
  deviceHash: string
}

const LOGIN_FAILURE_TYPES = ['FACE', 'LIVENESS', 'WEBAUTHN']

/** Stores the auth event, then runs the deterministic rules (UC-16, UC-17) on it. */
export async function recordAuthEvent({ db }: Deps, event: AuthEventInput) {
  await db.authEvent.create({ data: event })
  const settings = await getSettings(db)
  const now = Date.now()
  const loginWindow = new Date(now - settings['fraud.failedLoginWindowMinutes'] * 60_000)
  const deviceWindow = new Date(now - settings['fraud.deviceWindowHours'] * 3_600_000)

  if (!event.success && LOGIN_FAILURE_TYPES.includes(event.type)) {
    await repeatedFailures(db, event, loginWindow, settings['fraud.maxFailedLogins'])
  }
  if (!event.success && event.type === 'LIVENESS') {
    await repeatedLivenessFailures(db, event, loginWindow, settings['fraud.maxLivenessFailures'])
  }
  if (event.cnicAttempted) {
    const k = settings['fraud.maxAccountsPerDevice']
    await manyAccounts(db, 'deviceHash', event.deviceHash, deviceWindow, k, 'MEDIUM')
    // Shared IPs (campus Wi-Fi, mobile carrier NAT) are common, so the IP signal is weaker.
    await manyAccounts(db, 'ip', event.ip, deviceWindow, k, 'LOW')
  }
}

/** Who the event is about: the voter if known, else the CNIC typed in. */
function subject(event: AuthEventInput): Prisma.AuthEventWhereInput[] {
  return [
    ...(event.voterId ? [{ voterId: event.voterId }] : []),
    ...(event.cnicAttempted ? [{ cnicAttempted: event.cnicAttempted }] : []),
  ]
}

async function openAlertExists(
  db: Db,
  type: string,
  since: Date,
  match: Prisma.FraudAlertWhereInput,
) {
  return (
    (await db.fraudAlert.count({
      where: { type, status: 'OPEN', createdAt: { gte: since }, ...match },
    })) > 0
  )
}

async function voterIdFor(db: Db, event: AuthEventInput) {
  if (event.voterId) return event.voterId
  if (!event.cnicAttempted) return null
  return (
    (await db.voter.findUnique({ where: { cnic: event.cnicAttempted }, select: { id: true } }))
      ?.id ?? null
  )
}

// Rule: >= N failed logins for one person within M minutes → HIGH (locks the account).
async function repeatedFailures(db: Db, event: AuthEventInput, since: Date, max: number) {
  const who = subject(event)
  if (who.length === 0) return
  const failures = await db.authEvent.count({
    where: {
      success: false,
      type: { in: LOGIN_FAILURE_TYPES },
      createdAt: { gte: since },
      OR: who,
    },
  })
  if (failures < max) return
  const voterId = await voterIdFor(db, event)
  const match = voterId
    ? { voterId }
    : { details: { path: '$.cnic', equals: event.cnicAttempted ?? '' } }
  if (await openAlertExists(db, 'REPEATED_FAILED_LOGINS', since, match)) return
  await raiseAlert(db, {
    type: 'REPEATED_FAILED_LOGINS',
    severity: 'HIGH',
    voterId,
    description: `${failures} failed sign-in attempts within the window`,
    details: {
      cnic: event.cnicAttempted ?? null,
      failures,
      ip: event.ip,
      deviceHash: event.deviceHash,
    },
  })
}

// Rule: liveness failed >= N times → someone may be holding up photos or a screen.
async function repeatedLivenessFailures(db: Db, event: AuthEventInput, since: Date, max: number) {
  const who = subject(event)
  if (who.length === 0) return
  const failures = await db.authEvent.count({
    where: { success: false, type: 'LIVENESS', createdAt: { gte: since }, OR: who },
  })
  if (failures < max) return
  const voterId = await voterIdFor(db, event)
  const match = voterId
    ? { voterId }
    : { details: { path: '$.cnic', equals: event.cnicAttempted ?? '' } }
  if (await openAlertExists(db, 'REPEATED_LIVENESS_FAILURE', since, match)) return
  await raiseAlert(db, {
    type: 'REPEATED_LIVENESS_FAILURE',
    severity: 'MEDIUM',
    voterId,
    description: `Liveness check failed ${failures} times — possible photo or video spoofing`,
    details: {
      cnic: event.cnicAttempted ?? null,
      failures,
      ip: event.ip,
      deviceHash: event.deviceHash,
    },
  })
}

// Rule: one device (or IP) used for >= K different CNICs in the window.
async function manyAccounts(
  db: Db,
  field: 'deviceHash' | 'ip',
  value: string,
  since: Date,
  max: number,
  severity: Severity,
) {
  const distinct = await db.authEvent.groupBy({
    by: ['cnicAttempted'],
    where: { [field]: value, createdAt: { gte: since }, cnicAttempted: { not: null } },
  })
  if (distinct.length < max) return
  const type = field === 'deviceHash' ? 'SHARED_DEVICE' : 'SHARED_IP'
  if (await openAlertExists(db, type, since, { details: { path: `$.${field}`, equals: value } }))
    return
  await raiseAlert(db, {
    type,
    severity,
    description: `${distinct.length} different CNICs used from one ${field === 'ip' ? 'IP address' : 'device'}`,
    details: { [field]: value, accounts: distinct.length },
  })
}
