// src/types/recharts-subpaths.d.ts
//
// Type declarations for the recharts sub-path imports used by the
// dashboard cards. Recharts ships .d.ts only for the top-level
// `recharts` entry; reaching into `recharts/es6/*` for per-chart tree-
// shaking trips TypeScript's implicit-any guard. We re-export the
// types from the top-level entry — TypeScript reads the .d.ts, the
// bundler reads the sub-path, both happy.
//
// See src/components/dashboard/Sparkline.tsx and
// AuditEventMixCard.tsx for the call sites; the plan's
// open-question #1 captures the bundle-size reason for this dance.

declare module 'recharts/es6/chart/LineChart' {
  export { LineChart } from 'recharts'
}
declare module 'recharts/es6/chart/PieChart' {
  export { PieChart } from 'recharts'
}
declare module 'recharts/es6/cartesian/Line' {
  export { Line } from 'recharts'
}
declare module 'recharts/es6/cartesian/YAxis' {
  export { YAxis } from 'recharts'
}
declare module 'recharts/es6/component/ResponsiveContainer' {
  export { ResponsiveContainer } from 'recharts'
}
declare module 'recharts/es6/component/Tooltip' {
  export { Tooltip } from 'recharts'
}
declare module 'recharts/es6/component/Cell' {
  export { Cell } from 'recharts'
}
declare module 'recharts/es6/component/Legend' {
  export { Legend } from 'recharts'
}
declare module 'recharts/es6/polar/Pie' {
  export { Pie } from 'recharts'
}
