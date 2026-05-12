import { useCallback, useRef, useState } from 'react'

export const MAX_PANES = 4

export type WorkspacePanes = {
  panes: string[]
  addPane: () => void
  removePane: (id: string) => void
}

export function useWorkspacePanes(): WorkspacePanes {
  const counterRef = useRef(1)
  const [panes, setPanes] = useState<string[]>(['pane-1'])

  const addPane = useCallback(() => {
    setPanes((cur) => {
      if (cur.length >= MAX_PANES) return cur
      counterRef.current += 1
      return [...cur, `pane-${counterRef.current}`]
    })
  }, [])

  const removePane = useCallback((id: string) => {
    setPanes((cur) => (cur.length <= 1 ? cur : cur.filter((p) => p !== id)))
  }, [])

  return { panes, addPane, removePane }
}
