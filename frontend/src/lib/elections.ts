export type ElectionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED' | 'PUBLISHED'

export const STATUS_BADGE: Record<ElectionStatus, string> = {
  DRAFT: 'bg-gray-200 text-gray-800',
  SCHEDULED: 'bg-sky-100 text-sky-900',
  ACTIVE: 'bg-emerald-100 text-emerald-900',
  CLOSED: 'bg-amber-100 text-amber-900',
  PUBLISHED: 'bg-violet-100 text-violet-900',
}
