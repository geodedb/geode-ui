import React from 'react'

// DedupedDatalist — thin wrapper around native <datalist> that takes a
// pre-computed string array (the caller typically pipes
// `useUniqueValues` through) and emits one <option> per entry. Native
// browser <datalist> handles the typeahead UI; the SPA owns only the
// suggestion source.
//
// Why native: zero JS, ships in every evergreen browser, satisfies
// WCAG 2.1 SC 4.1.2 (Name, Role, Value) without extra plumbing, and
// matches the project's existing pattern in PoliciesPage / GrantsPanel.

export interface DedupedDatalistProps {
  /** id attribute the associated <input list="…"> points at. */
  id: string
  /** Pre-computed string options. Caller dedupes / sorts (e.g. via useUniqueValues). */
  values: ReadonlyArray<string>
}

export const DedupedDatalist: React.FC<DedupedDatalistProps> = ({
  id,
  values,
}) => (
  <datalist id={id}>
    {values.map((v) => (
      // eslint-disable-next-line jsx-a11y/control-has-associated-label
      <option key={v} value={v} />
    ))}
  </datalist>
)
