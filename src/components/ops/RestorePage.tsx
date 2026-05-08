import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import styled from 'styled-components'

import { client } from '../../api/client'
import { auth } from '../../api/auth'
import { getCsrfToken } from '../../api/csrf'
import type { Theme } from '../../theme'
import { Button, Field, Input, Stack } from '../ui'

interface ToneArgs {
  theme: Theme
  $tone: 'ok' | 'err'
}

function bannerBorder({ $tone, theme }: ToneArgs): string {
  return $tone === 'err' ? theme.colors.danger : theme.colors.success
}

function bannerColor({ $tone, theme }: ToneArgs): string {
  return $tone === 'err' ? theme.text.danger : theme.text.success
}

// RestorePage drives the /ops/restore tab. Backed by Geode B7:
//
//   restore POST /api/v1/restore -> client.restore({ file, target_time })
//
// The page accepts a `file` value via router location state when a
// user clicks "Restore" on a row in BackupPage; otherwise users type
// the filename in by hand.
const Heading = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

const Banner = styled.div<{ $tone: 'ok' | 'err' }>`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${bannerBorder};
  color: ${bannerColor};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const FormWrap = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  max-width: 480px;
`

export const RestorePage: React.FC = () => {
  const location = useLocation()
  const [file, setFile] = useState('')
  const [targetTime, setTargetTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // onUpload posts the selected file to the hand-rolled multipart
  // endpoint /api/v1/backups/upload. Server validates filename
  // (alphanumeric+._- only), enforces 64 MiB cap, and returns the
  // stored filename. We populate the `file` field with the result so
  // the operator can immediately submit Restore against it.
  const onUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setErr(null)
    setOkMsg(null)
    try {
      const form = new FormData()
      form.append('file', f)
      // SEC-F7 (#62 S3c): cookie carries the JWT (credentials:
      // 'same-origin'); CSRF header must accompany state-changing
      // requests. The legacy bearer path is retained for the backout
      // flag escape hatch.
      const tok = auth.getToken() ?? ''
      const csrf = getCsrfToken()
      const headers: Record<string, string> = {}
      if (tok) headers.Authorization = `Bearer ${tok}`
      if (csrf) headers['X-CSRF-Token'] = csrf
      const res = await fetch('/api/v1/backups/upload', {
        method: 'POST',
        headers,
        body: form,
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error_description?: string
          error?: string
        }
        throw new Error(
          j.error_description || j.error || `upload failed (${res.status})`
        )
      }
      const j = (await res.json()) as { file: string; size_bytes: number }
      setFile(j.file)
      setOkMsg(`Uploaded ${j.file} (${j.size_bytes} bytes). Ready to restore.`)
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  let restoreLabel = 'Restore'
  if (uploading) restoreLabel = 'Uploading…'

  return (
    <Stack $gap="md">
      <Heading>Restore</Heading>
      <FormWrap onSubmit={submit}>
        <Field label="Upload backup file" htmlFor="rp-upload">
          <input
            id="rp-upload"
            ref={fileInputRef}
            type="file"
            onChange={onUpload}
            disabled={uploading || busy}
          />
        </Field>
        <Field label="File" htmlFor="rp-file" required>
          <Input
            id="rp-file"
            placeholder="backup file name"
            value={file}
            onChange={(e) => setFile(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Target time"
          htmlFor="rp-target-time"
          hint="Optional point-in-time recovery cutoff (RFC3339)."
        >
          <Input
            id="rp-target-time"
            placeholder="2025-01-01T00:00:00Z"
            value={targetTime}
            onChange={(e) => setTargetTime(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={uploading}>
          {restoreLabel}
        </Button>
      </FormWrap>
      {err && (
        <Banner $tone="err" role="alert">
          {err}
        </Banner>
      )}
      {okMsg && (
        <Banner $tone="ok" role="status">
          {okMsg}
        </Banner>
      )}
    </Stack>
  )
}
