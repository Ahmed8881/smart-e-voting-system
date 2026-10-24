import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
createApp().listen(config.BACKEND_PORT, () => {
  console.log(`Backend listening on http://localhost:${config.BACKEND_PORT} (${config.NODE_ENV})`)
})
