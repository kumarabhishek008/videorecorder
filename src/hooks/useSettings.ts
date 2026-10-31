import { useCallback, useState } from 'react'
import { defaultSettings, type Settings } from '../lib/settings'

const KEY = 'reel.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }, [])
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable */
    }
    setSettings(defaultSettings)
  }, [])
  return { settings, update, reset }
}
