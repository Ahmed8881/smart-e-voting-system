import { z } from 'zod'
import type { Db } from '../../db.js'

/**
 * Every tunable the system reads at runtime (UC-14). Values are stored as strings in SystemSetting;
 * keys not stored fall back to these defaults.
 */
export const SETTINGS = {
  // Cosine similarity for SFace; 0.363 is the threshold published with the OpenCV model.
  'face.matchThreshold': { schema: z.coerce.number().min(0).max(1), default: 0.363 },
  'fraud.maxFailedLogins': { schema: z.coerce.number().int().min(1).max(100), default: 5 },
  'fraud.failedLoginWindowMinutes': {
    schema: z.coerce.number().int().min(1).max(1440),
    default: 15,
  },
  'fraud.maxAccountsPerDevice': { schema: z.coerce.number().int().min(1).max(100), default: 3 },
  'fraud.deviceWindowHours': { schema: z.coerce.number().int().min(1).max(720), default: 24 },
  'fraud.maxLivenessFailures': { schema: z.coerce.number().int().min(1).max(100), default: 3 },
  'fraud.anomalyThreshold': { schema: z.coerce.number().min(0).max(1), default: 0.6 },
} as const

export type SettingKey = keyof typeof SETTINGS
export type Settings = { [K in SettingKey]: number }

export const isSettingKey = (key: string): key is SettingKey => key in SETTINGS

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.systemSetting.findMany()
  const stored = new Map(rows.map((r) => [r.key, r.value]))
  return Object.fromEntries(
    Object.entries(SETTINGS).map(([key, def]) => {
      const raw = stored.get(key)
      const parsed = raw === undefined ? undefined : def.schema.safeParse(raw)
      return [key, parsed?.success ? parsed.data : def.default]
    }),
  ) as Settings
}
