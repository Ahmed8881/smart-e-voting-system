import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { AiClient } from './lib/aiClient.js'
import type { Mailer } from './lib/mailer.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { adminRouter } from './modules/admin/admin.routes.js'
import { adminAuthRouter } from './modules/auth/admin-auth.routes.js'
import { sessionRouter } from './modules/auth/session.routes.js'
import { voterAuthRouter, voterEnrolRouter } from './modules/auth/voter-auth.routes.js'
import { meRouter } from './modules/voters/me.routes.js'
import { votingRouter } from './modules/voting/voting.routes.js'
import { registrationRouter } from './modules/voters/registration.routes.js'
import { healthRouter } from './routes/health.js'

export type Deps = { config: Config; db: Db; mailer: Mailer; ai: AiClient }

// Endpoints that receive webcam frames get a larger body limit than everything else.
const CAPTURE_PATHS = new Set(['/api/voters/register', '/api/auth/voter/face'])
const smallJson = express.json({ limit: '100kb' })
const captureJson = express.json({ limit: '3mb' })

const tooMany = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
}

export function createApp(deps: Deps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', deps.config.TRUST_PROXY)
  app.use(helmet())
  app.use(cors({ origin: deps.config.CORS_ORIGIN, credentials: true }))
  app.use((req, res, next) =>
    (CAPTURE_PATHS.has(req.path) ? captureJson : smallJson)(req, res, next),
  )
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
  app.use('/api/auth/voter', voterAuthRouter(deps))
  app.use('/api/auth', sessionRouter(deps))
  app.use('/api/voters/register', registrationRouter(deps))
  app.use('/api/voters/me/webauthn', voterEnrolRouter(deps))
  app.use('/api/me', meRouter(deps))
  app.use('/api/elections', votingRouter(deps))
  app.use('/api/admin', adminRouter(deps))

  app.use(notFound)
  app.use(errorHandler)
  return app
}
