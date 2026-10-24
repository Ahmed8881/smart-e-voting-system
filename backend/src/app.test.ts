import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { createApp } from './app.js'

const app = createApp()

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'backend' })
  })

  test('does not advertise Express', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('error shape', () => {
  test('unknown route returns 404 in the standard error shape', async () => {
    const res = await request(app).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /api/does-not-exist' },
    })
  })

  test('malformed JSON body returns 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })
})
