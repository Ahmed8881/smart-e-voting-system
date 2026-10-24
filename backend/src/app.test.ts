import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { testApp } from './test/helpers.js'

const { app } = testApp()

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'backend' })
  })

  test('sends security headers and does not advertise Express', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toBeDefined()
  })

  test('allows only the configured CORS origin', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example')
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example')
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
