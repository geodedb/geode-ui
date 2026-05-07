// Mirrors deploy/geode/init.gql so test assertions stay in sync.
// Update both files together if the seed changes.
export const seed = {
  graph: 'movies',
  labels: ['Person', 'Movie'] as const,
  edgeTypes: ['ACTED_IN', 'DIRECTED'] as const,
  counts: {
    persons: 6,
    movies: 3,
    actedIn: 9,
    directed: 3,
    nodesTotal: 9,
    edgesTotal: 12,
  },
  people: [
    'Alice Wonder',
    'Bob Builder',
    'Carol Singer',
    'Dave Smith',
    'Eve Adams',
    'Frank Director',
  ] as const,
  movieTitles: ['The Graph', 'Edges of Reality', 'Walk the Path'] as const,
}
