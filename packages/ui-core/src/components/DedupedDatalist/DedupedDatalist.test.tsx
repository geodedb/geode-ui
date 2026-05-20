/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { DedupedDatalist } from './DedupedDatalist'

test('emits one <option> per deduplicated value', () => {
  render(<DedupedDatalist id="test-list" values={['alice', 'bob', 'carol']} />)
  const list = document.getElementById('test-list')
  expect(list).not.toBeNull()
  expect(list?.querySelectorAll('option')).toHaveLength(3)
})

test('renders empty <datalist> when values is empty', () => {
  render(<DedupedDatalist id="empty-list" values={[]} />)
  const list = document.getElementById('empty-list')
  expect(list?.querySelectorAll('option')).toHaveLength(0)
})

test('exposes the id matching an associated input list= attribute', () => {
  render(
    <>
      <input list="my-list" data-testid="x" />
      <DedupedDatalist id="my-list" values={['one']} />
    </>
  )
  const input = screen.getByTestId('x') as HTMLInputElement
  expect(input.getAttribute('list')).toBe('my-list')
  expect(document.getElementById('my-list')?.tagName.toLowerCase()).toBe(
    'datalist'
  )
})
