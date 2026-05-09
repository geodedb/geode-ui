// Geode UI — English (US) translations.
//
// Reference locale. Every other locale is validated against this one
// by scripts/validate-translations.mjs. Pattern is borrowed verbatim
// from ../brancher/brancher (see CLAUDE.md i18n guidelines):
//
//   • Single namespace 'translation', nested by domain.
//   • Keys are camelCase; the dot-path is the React-side accessor.
//   • Plurals use the i18next _one / _other suffixes.
//   • Variable interpolation uses {{var}} (escapeValue: false).
//
// Add new keys to this file FIRST, run `pnpm verify:translations` to
// confirm, then port them to other locales.

export const en = {
  common: {
    cancel: 'Cancel',
    delete: 'Delete',
    confirm: 'Confirm',
    create: 'Create',
    apply: 'Apply',
    revoke: 'Revoke',
    enable: 'Enable',
    disable: 'Disable',
    sign: 'Sign',
    download: 'Download',
    restore: 'Restore',
    uploading: 'Uploading…',
    actions: 'Actions',
    closeDialog: 'Close dialog',
    cannotBeUndone: 'This action cannot be undone.',
    skipToMain: 'Skip to main content',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    notYetWired: 'not yet wired',
    rowCount_one: '{{count}} row',
    rowCount_other: '{{count}} rows',
    elapsed: '{{ms}} ms',
  },

  brand: {
    home: 'Geode home',
  },

  nav: {
    primary: 'Primary',
    primaryMobile: 'Primary mobile',
    query: 'Query',
    schema: 'Schema',
    admin: 'Admin',
    ops: 'Ops',
    logout: 'Logout',
  },

  auth: {
    signIn: 'Sign in',
    signInButton: 'Sign in',
    profile: 'Profile',
    profileList: 'Available profiles',
    username: 'Username',
    password: 'Password',
    loginFailed: 'login failed',
  },

  query: {
    runHotkey: 'Run (⌘+Enter)',
    cancel: 'Cancel',
    streamMode: 'Stream',
    expandGraphCells: 'Expand graph cells',
    resultViewLabel: 'Result view',
    tabTable: 'table',
    tabJson: 'json',
    tabGraph: 'graph',
  },

  graph: {
    canvasAria:
      'Cytoscape graph rendering. Use the Display panel to choose which property labels each node and edge.',
    displayHeading: 'Display',
    noNodesToConfigure: 'No nodes to configure.',
    nodeFieldLabel: 'Display field for {{label}} nodes',
    edgeFieldLabel: 'Display field for {{type}} edges',
    unlabeledNode: 'unlabeled',
    optionLabelName: 'label name',
    optionType: 'type',
    selectedNode: 'Node {{id}}',
    selectedEdge: 'Edge {{id}}',
    inspectHint: 'Click a node or edge to inspect properties.',
    selectionHeading: 'Selection',
    selectNodeById: 'Select node by id',
    selectEdgeById: 'Select edge by id',
    nodeIdPlaceholder: 'node id…',
    edgeIdPlaceholder: 'edge id…',
    empty: 'No nodes or edges to display for this query.',
    errorBanner: 'Failed to render graph: {{message}}',
    layoutLabel: 'Layout',
    layout: {
      cose: 'Force (cose)',
      breadthfirst: 'Breadth-first',
      circle: 'Circle',
      concentric: 'Concentric',
      grid: 'Grid',
    },
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    resetView: 'Reset',
    stats: '{{nodes}} nodes · {{edges}} edges',
    visibilityHeading: 'Visibility',
  },

  schema: {
    graphsTitle: 'Graphs',
    noGraphs: 'No graphs.',
    selectGraph: 'Select a graph.',
    labelsTitle: 'Labels',
    labelsTitleScoped: 'Labels ({{graph}})',
    edgeTypesTitle: 'Edge types',
    edgeTypesTitleScoped: 'Edge types ({{graph}})',
    indexes: 'Indexes',
    constraints: 'Constraints',
    noLabels: 'No labels.',
    noEdgeTypes: 'No edge types.',
    noIndexes: 'No indexes.',
    noConstraints: 'No constraints.',
  },

  users: {
    title: 'Users ({{count}})',
    newButton: '+ New user',
    columnUsername: 'Username',
    columnEmail: 'Email',
    columnRoles: 'Roles',
    columnStatus: 'Status',
    statusDisabled: 'disabled',
    statusActive: 'active',
    deleteTitle: 'Delete user "{{name}}"?',
    deleteConfirm: 'Delete',
    empty: 'No users.',
    createTitle: 'New user',
    fieldUsername: 'Username',
    fieldEmail: 'Email',
    fieldPassword: 'Password',
    passwordHint: 'The user can change this on first login.',
  },

  roles: {
    title: 'Roles ({{count}})',
    newButton: '+ New role',
    columnName: 'Name',
    columnDescription: 'Description',
    columnPermissions: 'Permissions',
    deleteTitle: 'Delete role "{{name}}"?',
    deleteConfirm: 'Delete',
    empty: 'No roles.',
    createTitle: 'New role',
    fieldName: 'Name',
    fieldDescription: 'Description',
    fieldPermissions: 'Permissions',
    permissionsHint: 'Comma-separated identifiers (e.g. read,write,admin).',
  },

  policies: {
    title: 'Policies ({{count}})',
    newButton: '+ New policy',
    columnName: 'Name',
    columnResource: 'Resource',
    columnExpression: 'Expression',
    deleteTitle: 'Delete policy "{{name}}"?',
    deleteConfirm: 'Delete',
    empty: 'No policies.',
    createTitle: 'New policy',
    fieldName: 'Name',
    fieldResource: 'Resource',
    resourceHint:
      'The graph or namespace this policy guards (e.g. graph:default).',
    fieldExpression: 'Expression',
  },

  grants: {
    title: 'Grants',
    fieldPermission: 'Permission',
    permissionHint: 'The action being granted (e.g. read, write, admin).',
    fieldResource: 'Resource',
    resourceHint: 'The resource the grant applies to (e.g. graph:default).',
    fieldGrantee: 'Grantee',
    granteePlaceholder: 'username or role name',
    fieldGranteeKind: 'Grantee kind',
    granteeKindUser: 'user',
    granteeKindRole: 'role',
    applied: 'Grant applied.',
    revoked: 'Grant revoked.',
  },

  backups: {
    title: 'Backups ({{count}})',
    newButton: '+ New backup',
    columnFile: 'File',
    columnSize: 'Size',
    columnCreated: 'Created',
    columnGraphs: 'Graphs',
    columnNodes: 'Nodes',
    columnEdges: 'Edges',
    deleteTitle: 'Delete backup "{{name}}"?',
    deleteBody: 'The file will be removed from disk.',
    empty: 'No backups.',
    createTitle: 'New backup',
    fieldGraph: 'Graph',
    graphHint: 'Optional — backs up all graphs when blank.',
    fieldOutput: 'Output path',
    outputHint: 'Optional — defaults to the configured backup directory.',
  },

  restore: {
    title: 'Restore',
    fieldUpload: 'Upload backup file',
    fieldFile: 'File',
    filePlaceholder: 'backup file name',
    fieldTargetTime: 'Target time',
    targetTimeHint: 'Optional point-in-time recovery cutoff (RFC3339).',
    started: 'Restore started.',
    uploaded: 'Uploaded {{name}} ({{size}} bytes). Ready to restore.',
  },

  migrations: {
    title: 'Migrations',
    newButton: '+ New migration',
    runPending: 'Run pending ({{count}})',
    appliedToast: 'Applied {{count}} migration(s).',
    pendingHeading: 'Pending ({{count}})',
    appliedHeading: 'Applied ({{count}})',
    columnName: 'Name',
    columnAppliedAt: 'Applied at',
    columnSignedBy: 'Signed by',
    emptyPending: 'No pending migrations.',
    emptyApplied: 'No applied migrations.',
    createTitle: 'New migration',
    uploadLabel: 'Migration file (.gql / .sql)',
    staged: 'Staged: {{name}}',
    fieldName: 'Name',
    fieldDescription: 'Description',
  },

  audit: {
    title: 'Audit log ({{count}})',
    fieldSince: 'Since',
    sincePlaceholder: '2025-01-01T00:00:00Z',
    fieldEvent: 'Event',
    eventPlaceholder: 'event name',
    fieldUser: 'User',
    userPlaceholder: 'username',
    columnTimestamp: 'Timestamp',
    columnUser: 'User',
    columnEvent: 'Event',
    columnFields: 'Fields',
    empty: 'No audit entries.',
  },

  errors: {
    uploadFailed: 'upload failed ({{status}})',
    queryFailed: 'query failed',
  },

  connection: {
    noActive: 'No active connection',
    connect: 'Connect',
    disconnect: 'Disconnect',
    addAnother: 'Add another connection',
  },

  profiles: {
    title: 'Profiles',
    description:
      'Manage Geode connection profiles. System profiles are visible to everyone; personal profiles are scoped to you.',
    scope: {
      system: 'System',
      personal: 'Personal',
    },
    flag: {
      default: 'Default',
    },
    column: {
      name: 'Name',
      scope: 'Scope',
      description: 'Description',
      owner: 'Owner',
    },
    empty: 'No profiles yet.',
    loading: 'Loading profiles…',
    error: 'Could not load profiles.',
  },
} as const

export type Translations = typeof en
