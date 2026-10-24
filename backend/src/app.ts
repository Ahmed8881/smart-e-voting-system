import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { Mailer } from './lib/mailer.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { adminRouter } from './modules/admin/admin.routes.js'
import { adminAuthRouter } from './modules/auth/admin-auth.routes.js'
import { sessionRouter } from './modules/auth/session.routes.js'
import { healthRouter } from './routes/health.js'

export type Deps = { config: Config; db: Db; mailer: Mailer }

const tooMany = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
}

export function createApp(deps: Deps) {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: deps.config.CORS_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', message: tooMany }),
  )

  app.use('/api/health', healthRouter)
  // Password and OTP guessing: a tight per-IP budget on top of the per-challenge attempt limit.
  app.use(
    '/api/auth/admin',
    rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', message: tooMany }),
    adminAuthRouter(deps),
  )
  app.use('/api/auth', sessionRouter(deps))
  app.use('/api/admin', adminRouter(deps))

  app.use(notFound)
  app.use(errorHandler)
  return app
}
