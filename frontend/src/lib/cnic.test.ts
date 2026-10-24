import { expect, test } from 'vitest'
import { CNIC_PATTERN, formatCnic } from './cnic.ts'

test.each([
  ['', ''],
  ['35202', '35202'],
  ['352021', '35202-1'],
  ['352021234567', '35202-1234567'],
  ['3520212345671', '35202-1234567-1'],
  ['35202-1234567-1', '35202-1234567-1'],
  ['3520212345671999', '35202-1234567-1'],
  ['ab35202x1234567-1', '35202-1234567-1'],
])('formatCnic(%j) → %j', (input, expected) => {
  expect(formatCnic(input)).toBe(expected)
})

test('pattern accepts only the full format', () => {
  expect(CNIC_PATTERN.test('35202-1234567-1')).toBe(true)
  expect(CNIC_PATTERN.test('35202-1234567')).toBe(false)
  expect(CNIC_PATTERN.test('3520212345671')).toBe(false)
})
