import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import HomePage from './HomePage.tsx'

afterEach(() => vi.unstubAllGlobals())

test('shows backend online when /api/health responds ok', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  render(<HomePage />)
  expect(await screen.findByText(/Backend: online/)).toBeInTheDocument()
})

test('shows backend unreachable when the request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
  render(<HomePage />)
  expect(await screen.findByText(/Backend: unreachable/)).toBeInTheDocument()
})
