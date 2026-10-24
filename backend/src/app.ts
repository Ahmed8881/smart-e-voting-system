import express from 'express'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { healthRouter } from './routes/health.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '100kb' }))

  app.use('/api/health', healthRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
