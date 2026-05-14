import React, { useId, useState } from 'react'
import styled from 'styled-components'
import { buildExpandStatement, ExpandDirection } from './buildExpand'
import {
  Dialog,
  Input as WaInput,
  Option as WaOption,
  Select as WaSelect,
} from '../../../services/webawesome/components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

// The dialog is portalled by <wa-dialog> itself, so we only need a small
// content wrapper to lay out the form rows + preview consistently with
// the rest of the app. The bespoke <Modal>/<Card> overlay + styled
// backdrop are gone — WA owns scrim, focus trap, Escape, and stacking.
const DialogBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};

  .row {
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.sm};
    flex-wrap: wrap;
  }
  pre {
    background: ${({ theme }) => theme.bg.canvas};
    color: ${({ theme }) => theme.text.primary};
    padding: ${({ theme }) => theme.spacing.xs};
    border-radius: ${({ theme }) => theme.radii.sm};
    border: 1px solid ${({ theme }) => theme.border.subtle};
    font-family: ${({ theme }) => theme.font.family.mono};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    overflow-x: auto;
    margin: 0;
  }
`

export type ExpandRunOpts = {
  direction: ExpandDirection
  labelFilter: string | undefined
  limit: number
}

export type ExpandQueryPopoverProps = {
  open: boolean
  nodeId: string
  // Allowed label filter values, drawn from the live graph's buckets.
  labelOptions: string[]
  onRun: (opts: ExpandRunOpts) => void
  onCancel: () => void
  t: TFn
}

export const ExpandQueryPopover: React.FC<ExpandQueryPopoverProps> = ({
  open,
  nodeId,
  labelOptions,
  onRun,
  onCancel,
  t,
}) => {
  const [direction, setDirection] = useState<ExpandDirection>('both')
  const [labelFilter, setLabelFilter] = useState<string>('')
  const [limit, setLimit] = useState<string>('100')
  const reactId = useId()
  const dirBothId = `${reactId}-dir-both`
  const dirOutId = `${reactId}-dir-out`
  const dirInId = `${reactId}-dir-in`

  // <wa-dialog open> drives its own show/hide. Keep the React-level
  // early-return so the test's "renders nothing when open=false" case
  // still finds zero matches for the testid — without it, the dialog
  // node lives in the DOM even when hidden and screen.queryByTestId
  // would resolve. WA hides the chrome but keeps the host element.
  if (!open) return null

  const parsedLimit = Number.parseInt(limit, 10)
  const preview = (() => {
    try {
      return buildExpandStatement({
        id: nodeId,
        direction,
        labelFilter: labelFilter || undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      })
    } catch (e) {
      return `# ${(e as Error).message}`
    }
  })()

  const runDisabled = preview.startsWith('# ')

  return (
    <Dialog
      open={open}
      label={t('graph.expandTitle', { id: nodeId })}
      data-testid="graph-expand-popover"
      onWaAfterHide={onCancel}
    >
      <DialogBody>
        <div
          className="row"
          role="radiogroup"
          aria-label={t('graph.expandDirection')}
        >
          <label htmlFor={dirBothId}>
            <input
              id={dirBothId}
              type="radio"
              data-testid="graph-expand-direction-both"
              checked={direction === 'both'}
              onChange={() => setDirection('both')}
            />
            <span>{t('graph.expandBoth')}</span>
          </label>
          <label htmlFor={dirOutId}>
            <input
              id={dirOutId}
              type="radio"
              data-testid="graph-expand-direction-out"
              checked={direction === 'out'}
              onChange={() => setDirection('out')}
            />
            <span>{t('graph.expandOut')}</span>
          </label>
          <label htmlFor={dirInId}>
            <input
              id={dirInId}
              type="radio"
              data-testid="graph-expand-direction-in"
              checked={direction === 'in'}
              onChange={() => setDirection('in')}
            />
            <span>{t('graph.expandIn')}</span>
          </label>
        </div>
        <div className="row">
          <WaSelect
            label={t('graph.expandLabelFilter')}
            data-testid="graph-expand-label-filter"
            value={labelFilter}
            onChange={(e: Event) => {
              const target = e.target as HTMLSelectElement
              setLabelFilter(target.value ?? '')
            }}
          >
            <WaOption value="">{t('graph.expandLabelAny')}</WaOption>
            {labelOptions.map((l) => (
              <WaOption key={l} value={l}>
                {l}
              </WaOption>
            ))}
          </WaSelect>
          <WaInput
            type="number"
            label={t('graph.expandLimit')}
            data-testid="graph-expand-limit"
            value={limit}
            min={1}
            max={10000}
            onInput={(e: Event) => {
              const target = e.target as HTMLInputElement
              setLimit(target.value)
            }}
            onChange={(e: Event) => {
              const target = e.target as HTMLInputElement
              setLimit(target.value)
            }}
          />
        </div>
        <pre data-testid="graph-expand-preview">{preview}</pre>
      </DialogBody>
      <wa-button
        slot="footer"
        appearance="plain"
        size="m"
        role="button"
        data-testid="graph-expand-cancel"
        onClick={onCancel}
      >
        {t('graph.expandCancel')}
      </wa-button>
      <wa-button
        slot="footer"
        appearance="filled"
        variant="brand"
        size="m"
        role="button"
        data-testid="graph-expand-run"
        disabled={runDisabled ? true : undefined}
        onClick={() => {
          onRun({
            direction,
            labelFilter: labelFilter || undefined,
            limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
          })
        }}
      >
        {t('graph.expandRun')}
      </wa-button>
    </Dialog>
  )
}
