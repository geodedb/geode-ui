import React, { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { buildExpandStatement, ExpandDirection } from './buildExpand'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Modal = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.modal};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.bg.overlay};
`
const Card = styled.div`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  min-width: 360px;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};

  h4 {
    margin: 0;
    font-size: ${({ theme }) => theme.font.sizes.md};
    color: ${({ theme }) => theme.text.primary};
  }
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
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: ${({ theme }) => theme.spacing.xs};
  }
  button.primary {
    background: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.text.onPrimary};
    border: 1px solid ${({ theme }) => theme.colors.primary};
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
  const labelFilterId = `${reactId}-label-filter`
  const limitId = `${reactId}-limit`

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

  return createPortal(
    <Modal role="dialog" aria-modal="true" data-testid="graph-expand-popover">
      <Card>
        <h4>{t('graph.expandTitle', { id: nodeId })}</h4>
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
          <label htmlFor={labelFilterId}>
            <span>{t('graph.expandLabelFilter')}</span>
            <select
              id={labelFilterId}
              data-testid="graph-expand-label-filter"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
            >
              <option value="">{t('graph.expandLabelAny')}</option>
              {labelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={limitId}>
            <span>{t('graph.expandLimit')}</span>
            <input
              id={limitId}
              type="number"
              data-testid="graph-expand-limit"
              min={1}
              max={10000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              style={{ width: 80 }}
            />
          </label>
        </div>
        <pre data-testid="graph-expand-preview">{preview}</pre>
        <div className="actions">
          <button
            type="button"
            data-testid="graph-expand-cancel"
            onClick={onCancel}
          >
            {t('graph.expandCancel')}
          </button>
          <button
            type="button"
            data-testid="graph-expand-run"
            className="primary"
            disabled={runDisabled}
            onClick={() => {
              onRun({
                direction,
                labelFilter: labelFilter || undefined,
                limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
              })
            }}
          >
            {t('graph.expandRun')}
          </button>
        </div>
      </Card>
    </Modal>,
    document.body
  )
}
