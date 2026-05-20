import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { DedupedDatalist, useUniqueValues } from '@geodedb/ui-core'
import { synthesiseGql, BuilderState, EdgeDirection } from './queryBuilder'

// GAP-060 Phase 1: visual query builder side-panel. The operator
// picks a starting label, optionally an edge type + terminal label,
// an optional LIMIT, and clicks Apply. The synthesiser
// (./queryBuilder.ts) produces the GQL string and the parent route
// installs it into the editor + (optionally) runs it.
//
// Phase 1 is intentionally narrow:
//   • One start label, one optional edge, one terminal label.
//   • Free-form text inputs for label/edge type (the schema picker
//     integration lands in Phase 2 alongside the canvas UI).
//   • No filter chips, no ORDER BY (those land in Phase 3 alongside
//     GAP-063 snippets).
//
// The synthesiser is pure + already unit-tested; this component
// limits itself to form state + the Apply callback.

const Panel = styled.aside`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 280px;
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
`

const Input = styled.input`
  background: ${({ theme }) => theme.bg.subtle};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.text.primary};
  padding: 6px 10px;
  font-family: ${({ theme }) => theme.font.family.body};
`

const Select = styled.select`
  background: ${({ theme }) => theme.bg.subtle};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.text.primary};
  padding: 6px 10px;
`

export interface QueryBuilderPanelProps {
  /** Active graph if the parent has one — surfaced as USE GRAPH. */
  graph?: string
  /** Called with the synthesised GQL when the operator clicks Apply. */
  onApply: (gql: string) => void
  // GAP-autocomplete: optional caller-provided suggestion sources.
  // SchemaExplorer + schemaCache already hold these; QueryPage threads
  // them through when the panel mounts.
  knownLabels?: ReadonlyArray<string>
  knownEdgeTypes?: ReadonlyArray<string>
}

export const QueryBuilderPanel: React.FC<QueryBuilderPanelProps> = ({
  graph,
  onApply,
  knownLabels,
  knownEdgeTypes,
}) => {
  const { t } = useTranslation()
  const [startLabel, setStartLabel] = useState('Person')
  const [edgeType, setEdgeType] = useState('')
  const [endLabel, setEndLabel] = useState('')
  const [edgeDirection, setEdgeDirection] = useState<EdgeDirection>('out')
  const [limit, setLimit] = useState<number>(25)

  const labelOptions = useUniqueValues(knownLabels ?? [], (s) => s)
  const edgeOptions = useUniqueValues(knownEdgeTypes ?? [], (s) => s)

  const handleApply = (): void => {
    const state: BuilderState = {
      graph,
      startLabel: startLabel.trim(),
      edgeType: edgeType.trim() || undefined,
      endLabel: endLabel.trim() || undefined,
      edgeDirection,
      projection: [],
      limit,
    }
    if (!state.startLabel) return
    onApply(synthesiseGql(state))
  }

  return (
    <Panel data-testid="query-builder-panel">
      <h3 className="m-0 fs-6 fw-semibold">{t('queryBuilder.title')}</h3>
      <Field>
        {t('queryBuilder.startLabel')}
        <Input
          data-testid="qb-start-label"
          list="qb-start-label-list"
          value={startLabel}
          onChange={(e) => setStartLabel(e.target.value)}
          placeholder="Person"
        />
        <DedupedDatalist id="qb-start-label-list" values={labelOptions} />
      </Field>
      <Field>
        {t('queryBuilder.edgeType')}
        <Input
          data-testid="qb-edge-type"
          list="qb-edge-type-list"
          value={edgeType}
          onChange={(e) => setEdgeType(e.target.value)}
          placeholder="ACTED_IN"
        />
        <DedupedDatalist id="qb-edge-type-list" values={edgeOptions} />
      </Field>
      <Field>
        {t('queryBuilder.edgeDirection')}
        <Select
          data-testid="qb-edge-direction"
          value={edgeDirection}
          onChange={(e) => setEdgeDirection(e.target.value as EdgeDirection)}
        >
          <option value="out">{t('queryBuilder.directionOut')}</option>
          <option value="in">{t('queryBuilder.directionIn')}</option>
          <option value="both">{t('queryBuilder.directionBoth')}</option>
        </Select>
      </Field>
      <Field>
        {t('queryBuilder.endLabel')}
        <Input
          data-testid="qb-end-label"
          list="qb-end-label-list"
          value={endLabel}
          onChange={(e) => setEndLabel(e.target.value)}
          placeholder="Movie"
        />
        <DedupedDatalist id="qb-end-label-list" values={labelOptions} />
      </Field>
      <Field>
        {t('queryBuilder.limit')}
        <Input
          data-testid="qb-limit"
          type="number"
          min={0}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
      </Field>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        data-testid="qb-apply"
        onClick={handleApply}
      >
        {t('queryBuilder.apply')}
      </button>
    </Panel>
  )
}
