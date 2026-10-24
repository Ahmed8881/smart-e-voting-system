// Creates the first admin from ADMIN_SEED_* env vars. Safe to re-run: an existing admin is left untouched.
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { createDb } from '../src/db.js'
import { appendAudit } from '../src/modules/audit/audit.service.js'
import { BCRYPT_COST } from '../src/modules/auth/admin-auth.routes.js'

const env = z
  .object({
    DATABASE_URL: z.string().startsWith('mysql://'),
    ADMIN_SEED_NAME: z.string().min(1).max(120),
    ADMIN_SEED_EMAIL: z.email().transform((e) => e.toLowerCase()),
    ADMIN_SEED_PASSWORD: z.string().min(12, 'must be at least 12 characters'),
  })
  .parse(process.env)

const db = createDb(env.DATABASE_URL)
try {
  const existing = await db.admin.findUnique({ where: { email: env.ADMIN_SEED_EMAIL } })
  if (existing) {
    console.log(`Admin ${env.ADMIN_SEED_EMAIL} already exists — nothing to do.`)
  } else {
    const admin = await db.admin.create({
      data: {
        name: env.ADMIN_SEED_NAME,
        email: env.ADMIN_SEED_EMAIL,
        passwordHash: await bcrypt.hash(env.ADMIN_SEED_PASSWORD, BCRYPT_COST),
      },
    })
    await appendAudit(db, {
      actorType: 'SYSTEM',
      action: 'ADMIN_SEEDED',
      payload: { adminId: admin.id, email: admin.email },
    })
    console.log(`Created admin ${admin.email}.`)
  }
} finally {
  await db.$disconnect()
}
