import { useEffect, useState, type FormEvent } from 'react'
import { Button, ErrorText, Field } from '../../components/ui.tsx'
import { api, errorMessage, put } from '../../lib/api.ts'

type Settings = Record<string, number>

const LABELS: Record<string, string> = {
  'face.matchThreshold': 'Face match threshold (0–1)',
  'fraud.maxFailedLogins': 'Failed logins before alert',
  'fraud.failedLoginWindowMinutes': 'Failed-login window (minutes)',
  'fraud.maxAccountsPerDevice': 'Max accounts per device',
  'fraud.deviceWindowHours': 'Device window (hours)',
  'fraud.maxLivenessFailures': 'Liveness failures before alert',
  'fraud.anomalyThreshold': 'Anomaly score threshold (0–1)',
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api<Settings>('/admin/settings')
      .then(setSettings)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setSaved(false)
    const form = Object.fromEntries(new FormData(e.currentTarget))
    // Send only what changed, so the audit log records real changes.
    const changes = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => Number(v) !== settings?.[k]),
    )
    if (Object.keys(changes).length === 0) return
    try {
      setSettings(await put<Settings>('/admin/settings', changes))
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section className="max-w-lg">
      <h1 className="mb-4 text-xl font-semibold">System settings</h1>
      {settings && (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {Object.entries(settings).map(([key, value]) => (
            <Field
              key={key}
              label={LABELS[key] ?? key}
              name={key}
              type="number"
              step="any"
              defaultValue={value}
              required
            />
          ))}
          <ErrorText>{error}</ErrorText>
          {saved && (
            <p role="status" className="text-sm text-emerald-800">
              Saved.
            </p>
          )}
          <Button type="submit">Save changes</Button>
        </form>
      )}
    </section>
  )
}
