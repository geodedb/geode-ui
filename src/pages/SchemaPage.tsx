import React from 'react'
import { SchemaExplorer } from '../components/schema/SchemaExplorer'

// SchemaPage is mounted at /schema and is currently a thin wrapper
// around SchemaExplorer. It exists as a separate page-level component
// so future page-level concerns (breadcrumbs, page-level toolbars,
// loading scaffolding) can be added without touching the explorer.
export const SchemaPage: React.FC = () => <SchemaExplorer />
