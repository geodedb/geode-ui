import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import styled from 'styled-components'
import { client } from '../../api/client'

// RestorePage drives the /ops/restore tab. Backed by Geode B7:
//
//   restore POST /api/v1/restore -> client.restore({ file, target_time })
//
// The page accepts a `file` value via router location state when a
// user clicks "Restore" on a row in BackupPage; otherwise users type
// the filename in by hand.
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 480px;
`

const Heading = styled.h2`
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.text};
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.85rem;

  input {
    padding: 6px 8px;
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
    font-family: inherit;
  }
`

const Btn = styled.button`
  padding: 8px 16px;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  align-self: flex-start;

  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`

const Banner = styled.p<{ $tone: 'ok' | 'err' }>`
  color: ${({ $tone }) => ($tone === 'err' ? '#ef4444' : '#10b981')};
  margin-top: 8px;
`

export const RestorePage: React.FC = () => {
  const location = useLocation()
  const [file, setFile] = useState('')
  const [targetTime, setTargetTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // BackupPage navigates here with location.state.file when the user
  // clicks "Restore" on a row; populate the file field on first render.
  useEffect(() => {
    const state = location.state as { file?: string } | null
    if (state && typeof state.file === 'string') {
      setFile(state.file)
    }
  }, [location.state])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      await client.restore({ file, target_time: targetTime })
      setOkMsg('Restore started.')
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wrap>
      <Heading>Restore</Heading>
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field>
          File
          <input
            placeholder="backup file name"
            value={file}
            onChange={(e) => setFile(e.target.value)}
            required
          />
        </Field>
        <Field>
          Target time (optional, RFC3339)
          <input
            placeholder="2025-01-01T00:00:00Z"
            value={targetTime}
            onChange={(e) => setTargetTime(e.target.value)}
          />
        </Field>
        <Btn type="submit" disabled={busy}>
          {busy ? '...' : 'Restore'}
        </Btn>
      </form>
      {err && <Banner $tone="err">{err}</Banner>}
      {okMsg && <Banner $tone="ok">{okMsg}</Banner>}
    </Wrap>
  )
}
