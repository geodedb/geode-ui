import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { createPortal } from 'react-dom'

import { Button } from './Button'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  // Optional — when supplied, focus moves into the modal on open and
  // returns to this element on close. Defaults to document.activeElement
  // at the time of opening.
  initialFocusRef?: React.RefObject<HTMLElement>
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.bg.overlay};
  z-index: ${({ theme }) => theme.zIndex.overlay};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.md};
  animation: fade-in 150ms ease-out;

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const SIZE_MAX_WIDTH: Record<'sm' | 'md' | 'lg', string> = {
  sm: '400px',
  md: '560px',
  lg: '720px',
}

const Dialog = styled.div<{ $size: 'sm' | 'md' | 'lg' }>`
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.xl};
  box-shadow: ${({ theme }) => theme.shadows.xl};
  z-index: ${({ theme }) => theme.zIndex.modal};
  width: 100%;
  max-width: ${({ $size }) => SIZE_MAX_WIDTH[$size]};
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  outline: none;
`

const Header = styled.header`
  padding: ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spacing.md};
`

const TitleBlock = styled.div`
  flex: 1;
  min-width: 0;

  h2 {
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.xl};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    margin: 0;
  }
  p {
    font-size: ${({ theme }) => theme.font.sizes.sm};
    color: ${({ theme }) => theme.text.muted};
    margin-top: 4px;
  }
`

const CloseBtn = styled.button`
  background: transparent;
  border: 0;
  color: ${({ theme }) => theme.text.muted};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  cursor: pointer;
  width: ${({ theme }) => theme.touchTargets.min}px;
  height: ${({ theme }) => theme.touchTargets.min}px;
  border-radius: ${({ theme }) => theme.radii.md};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const Body = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  overflow-y: auto;
`

const Footer = styled.footer`
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
  border-top: 1px solid ${({ theme }) => theme.border.subtle};
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
`

// Focusable selectors — used to scope the focus trap. Mirrors the WAI
// "Inclusive Components" list with one geode-ui addition: contenteditable.
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable=true]'

// Modal — accessible dialog implemented with a focus trap, escape-to-
// close, scroll-lock on the body, and a portal to document.body. It
// renders nothing when `open` is false; when `open` flips to true the
// trap activates and focus moves to `initialFocusRef` (or the dialog
// itself).
//
// The portal target degrades cleanly under SSR and unit tests: when
// document is undefined, the modal returns null.
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  initialFocusRef,
  children,
}) => {
  const { t } = useTranslation()
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const lastFocusedRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined

    lastFocusedRef.current = document.activeElement as HTMLElement | null
    const target = initialFocusRef?.current ?? dialogRef.current
    target?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      )
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      lastFocusedRef.current?.focus?.()
    }
  }, [open, onClose, initialFocusRef])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <Backdrop
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-desc' : undefined}
        $size={size}
        tabIndex={-1}
      >
        <Header>
          <TitleBlock>
            <h2 id="modal-title">{title}</h2>
            {description && <p id="modal-desc">{description}</p>}
          </TitleBlock>
          <CloseBtn
            type="button"
            aria-label={t('common.closeDialog')}
            onClick={onClose}
          >
            ×
          </CloseBtn>
        </Header>
        <Body>{children}</Body>
        {footer && <Footer>{footer}</Footer>}
      </Dialog>
    </Backdrop>,
    document.body
  )
}

// ConfirmModal — a thin wrapper for the common destructive-confirm
// pattern. Used by admin pages for delete/disable flows.
export interface ConfirmModalProps {
  open: boolean
  title: React.ReactNode
  body: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  loading,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation()
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={loading}>
        {cancelLabel ?? t('common.cancel')}
      </Button>
      <Button
        variant={destructive ? 'danger' : 'primary'}
        onClick={onConfirm}
        loading={loading}
      >
        {confirmLabel ?? t('common.confirm')}
      </Button>
    </>
  )
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={footer}
    >
      {body}
    </Modal>
  )
}
