// Mirrors deploy/geode/init.gql (generated from the Neo4j Movies dataset
// via deploy/geode/seed/convert.py). Update both files together if the
// seed regenerates.
//
// Counts cross-checked against the live geode-e2e stack — they reflect
// exactly what `MATCH ... RETURN count(...)` returns post-seed, NOT
// what the upstream Cypher would imply (Geode v0.5.11 has a wire quirk
// the converter sentinels around — see deploy/geode/seed/SOURCES.md).
export const seed = {
  graph: 'movies',
  labels: ['Person', 'Movie'] as const,
  edgeTypes: [
    'ACTED_IN',
    'DIRECTED',
    'PRODUCED',
    'WROTE',
    'REVIEWED',
    'FOLLOWS',
  ] as const,
  counts: {
    persons: 133,
    movies: 38,
    nodesTotal: 171,
    actedIn: 172,
    directed: 44,
    produced: 15,
    wrote: 10,
    reviewed: 9,
    follows: 3,
    edgesTotal: 253,
  },
  // A small subset of person and movie names — enough for spot-check
  // assertions without coupling tests to the full 133-person list.
  // Drawn from The Matrix cluster (the densest sub-graph in the seed),
  // so any "MATCH (n:Person) WHERE n.name CONTAINS X RETURN n" search
  // surfaces them quickly.
  people: [
    'Keanu Reeves',
    'Carrie-Anne Moss',
    'Laurence Fishburne',
    'Hugo Weaving',
    'Lilly Wachowski',
    'Lana Wachowski',
  ] as const,
  movieTitles: [
    'The Matrix',
    'The Matrix Reloaded',
    'The Matrix Revolutions',
  ] as const,
}
