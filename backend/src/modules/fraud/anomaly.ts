import type { Deps } from '../../app.js'
import { getSettings } from '../settings/settings.js'
import { raiseAlert } from './fraud.service.js'

export type LoginFeatures = {
  hour_of_day: number
  failed_attempts_last_hour: number
  new_device: boolean
  new_ip: boolean
  accounts_on_device_24h: number
  days_since_registration: number
  face_similarity: number
}

type VoterFacts = { id: string; cnic: string; createdAt: Date }
type ClientFacts = { ip: string; deviceHash: string }

/** Builds the model's features for a login that just passed the face step. */
export async function loginFeatures(
  { db }: Deps,
  voter: VoterFacts,
  info: ClientFacts,
  similarity: number,
): Promise<LoginFeatures> {
  const now = new Date()
  const hourAgo = new Date(now.getTime() - 3_600_000)
  const dayAgo = new Date(now.getTime() - 86_400_000)
  // Only successes before this login, so "new device / IP" means new until now.
  const before = {
    voterId: voter.id,
    success: true,
    createdAt: { lt: new Date(now.getTime() - 1000) },
  }
  const [failed, seenDevice, seenIp, accounts] = await Promise.all([
    db.authEvent.count({
      where: {
        success: false,
        createdAt: { gte: hourAgo },
        OR: [{ voterId: voter.id }, { cnicAttempted: voter.cnic }],
      },
    }),
    db.authEvent.count({ where: { ...before, deviceHash: info.deviceHash } }),
    db.authEvent.count({ where: { ...before, ip: info.ip } }),
    db.authEvent.groupBy({
      by: ['cnicAttempted'],
      where: {
        deviceHash: info.deviceHash,
        createdAt: { gte: dayAgo },
        cnicAttempted: { not: null },
      },
    }),
  ])
  return {
    hour_of_day: now.getHours(),
    failed_attempts_last_hour: failed,
    new_device: seenDevice === 0,
    new_ip: seenIp === 0,
    accounts_on_device_24h: accounts.length,
    days_since_registration: Math.floor((now.getTime() - voter.createdAt.getTime()) / 86_400_000),
    face_similarity: similarity,
  }
}

/**
 * Asks the AI service how unusual this login looks; above the threshold raises a MEDIUM alert.
 * It never blocks and never fails the login: if the model is down or untrained, it is skipped.
 */
export async function scoreLogin(
  deps: Deps,
  voter: VoterFacts,
  info: ClientFacts,
  similarity: number,
) {
  try {
    const features = await loginFeatures(deps, voter, info, similarity)
    const { score, modelVersion } = await deps.ai.score(features)
    const { 'fraud.anomalyThreshold': threshold } = await getSettings(deps.db)
    if (score >= threshold) {
      await raiseAlert(deps.db, {
        type: 'ANOMALOUS_LOGIN',
        severity: 'MEDIUM',
        voterId: voter.id,
        score,
        description: 'Sign-in behaviour is unusual compared with normal voters (model score)',
        details: { features, modelVersion, threshold },
      })
    }
  } catch (err) {
    console.warn('Anomaly scoring skipped:', err instanceof Error ? err.message : 'unknown error')
  }
}
