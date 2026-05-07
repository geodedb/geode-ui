import type cytoscape from 'cytoscape'

const palette = [
  '#5b8def',
  '#48b0a3',
  '#e7a14a',
  '#c25f8b',
  '#7e57c2',
  '#3aa757',
  '#d65a55',
  '#3aaab2',
]

export function labelToColor(label: string): string {
  let h = 0
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0
  }
  return palette[h % palette.length] as string
}

export const cytoscapeStyle: cytoscape.StylesheetJsonBlock[] = [
  {
    selector: 'node',
    style: {
      'background-color': (e: any) =>
        labelToColor((e.data('label') as string) || ''),
      label: 'data(label)',
      color: '#fff',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': 12,
      width: 36,
      height: 36,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      width: 1.5,
      'line-color': '#aaa',
      'target-arrow-color': '#aaa',
      'target-arrow-shape': 'triangle',
      label: 'data(type)',
      'font-size': 10,
      'text-rotation': 'autorotate',
      'text-margin-y': -6,
      color: '#666',
    },
  },
  {
    selector: ':selected',
    style: {
      'border-width': 3,
      'border-color': '#222',
    },
  },
]
