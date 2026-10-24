import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { createMailer } from './lib/mailer.js'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
createApp({ config, db, mailer: createMailer(config) }).listen(config.BACKEND_PORT, () => {
  console.log(`Backend listening on http://localhost:${config.BACKEND_PORT} (${config.NODE_ENV})`)
})
