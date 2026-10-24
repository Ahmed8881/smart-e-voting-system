import { expect, test } from 'vitest'
import { fromLocalInput, toLocalInput } from './dates.ts'

test('round-trips between datetime-local and ISO', () => {
  const iso = '2026-11-01T10:30:00.000Z'
  expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
})

test('datetime-local value has no seconds or zone', () => {
  expect(toLocalInput('2026-11-01T10:30:45.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
})
