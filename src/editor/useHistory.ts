import { useCallback, useRef, useState } from 'react'
import type { Project } from './types'

const LIMIT = 100
/** Changes with the same key this close together (e.g. dragging a slider) are one undo step. */
const MERGE_MS = 700

/** Project state with undo / redo. */
export function useHistory(initial: Project | null) {
  const [project, setProject] = useState<Project | null>(initial)
  const past = useRef<Project[]>([])
  const future = useRef<Project[]>([])
  const last = useRef<{ key: string; at: number } | null>(null)
  const [, bump] = useState(0)

  const apply = useCallback((fn: (p: Project) => Project, mergeKey?: string) => {
    setProject((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      if (next === prev) return prev
      const now = Date.now()
      const merge = mergeKey && last.current?.key === mergeKey && now - last.current.at < MERGE_MS
      if (!merge) {
        past.current.push(prev)
        if (past.current.length > LIMIT) past.current.shift()
      }
      future.current = []
      last.current = mergeKey ? { key: mergeKey, at: now } : null
      return next
    })
    bump((n) => n + 1)
  }, [])

  /** Replaces the project without an undo step (loading, switching projects). */
  const reset = useCallback((p: Project | null) => {
    past.current = []
    future.current = []
    last.current = null
    setProject(p)
  }, [])

  const undo = useCallback(() => {
    setProject((cur) => {
      const prev = past.current.pop()
      if (!prev || !cur) return cur
      future.current.push(cur)
      return prev
    })
    last.current = null
    bump((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    setProject((cur) => {
      const next = future.current.pop()
      if (!next || !cur) return cur
      past.current.push(cur)
      return next
    })
    last.current = null
    bump((n) => n + 1)
  }, [])

  return { project, apply, reset, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }
}
