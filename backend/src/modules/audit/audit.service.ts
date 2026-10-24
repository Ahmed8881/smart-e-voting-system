import type { Db } from '../../db.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { sha256 } from '../../lib/crypto.js'
import { canonicalJson } from './canonical.js'

export const GENESIS_HASH = '0'.repeat(64)

export type ActorType = 'ADMIN' | 'VOTER' | 'SYSTEM' | 'ANONYMOUS'

export type AuditEntry = {
  actorType: ActorType
  actorId?: string | null
  action: string
  payload?: Record<string, unknown>
}

type HashedFields = {
  actorType: string
  actorId: string | null
  action: string
  payload: unknown
  createdAt: Date
}

export function computeHash(prevHash: string, row: HashedFields) {
  return sha256(
    prevHash +
      canonicalJson({
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        payload: row.payload,
        createdAt: row.createdAt,
      }),
  )
}

/**
 * Appends one entry to the hash chain. The single AuditChainHead row is locked FOR UPDATE, so
 * concurrent appends are serialised and the chain can never fork. Pass a transaction client to make
 * the audit entry commit or roll back together with the action it records.
 */
export async function appendAudit(
  db: Db | Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  if ('$transaction' in db) await db.$transaction((tx) => appendInTx(tx, entry))
  else await appendInTx(db, entry)
}

async function appendInTx(db: Prisma.TransactionClient, entry: AuditEntry) {
  const [head] = await db.$queryRaw<{ lastHash: string }[]>`
    SELECT lastHash FROM AuditChainHead WHERE id = 1 FOR UPDATE`
  if (!head) throw new Error('Audit chain head missing — run migrations')

  const row: HashedFields = {
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    payload: entry.payload ?? {},
    createdAt: new Date(),
  }
  const hash = computeHash(head.lastHash, row)
  await db.auditLog.create({
    data: { ...row, payload: row.payload as Prisma.InputJsonValue, prevHash: head.lastHash, hash },
  })
  await db.auditChainHead.update({ where: { id: 1 }, data: { lastHash: hash } })
}

export type ChainVerification =
  | { valid: true; checked: number }
  | {
      valid: false
      checked: number
      brokenAtId: number | null
      reason: 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH' | 'HEAD_MISMATCH'
    }

/** Walks the whole chain in id order and reports the first break, if any. */
export async function verifyChain(db: Db, batchSize = 500): Promise<ChainVerification> {
  let expectedPrev = GENESIS_HASH
  let checked = 0
  let cursor = 0

  for (;;) {
    const rows = await db.auditLog.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: batchSize,
    })
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.prevHash !== expectedPrev) {
        return { valid: false, checked, brokenAtId: row.id, reason: 'PREV_HASH_MISMATCH' }
      }
      if (computeHash(row.prevHash, row) !== row.hash) {
        return { valid: false, checked, brokenAtId: row.id, reason: 'HASH_MISMATCH' }
      }
      expectedPrev = row.hash
      checked++
      cursor = row.id
    }
  }

  // Catches deletion of the newest entries, which leaves the rest of the chain internally consistent.
  const head = await db.auditChainHead.findUnique({ where: { id: 1 } })
  if (head?.lastHash !== expectedPrev) {
    return { valid: false, checked, brokenAtId: null, reason: 'HEAD_MISMATCH' }
  }
  return { valid: true, checked }
}
