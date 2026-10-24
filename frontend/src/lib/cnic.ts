export const CNIC_PATTERN = /^\d{5}-\d{7}-\d$/

/** Formats digits as the user types: 3520212345671 → 35202-1234567-1. */
export function formatCnic(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 13)
  if (d.length <= 5) return d
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`
}
