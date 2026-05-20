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
    dashboard: 'Dashboard',
    query: 'Query',
    schema: 'Schema',
    admin: 'Admin',
    profiles: 'Profiles',
    logout: 'Logout',
    // Admin sub-tab labels (rendered inside AdminPage's tab strip).
    // The first four were inline string literals pre-Ops merge; the
    // last four were the OpsPage tabs before that page was deleted
    // (2026-05-17) and its sub-routes folded into /admin/*.
    adminTabUsers: 'Users',
    adminTabRoles: 'Roles',
    adminTabPolicies: 'Policies',
    adminTabGrants: 'Grants',
    adminTabBackups: 'Backups',
    adminTabRestore: 'Restore',
    adminTabMigrations: 'Migrations',
    adminTabAudit: 'Audit',
  },

  theme: {
    selectorLabel: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },

  auth: {
    signIn: 'Sign in',
    signInButton: 'Sign in',
    profile: 'Profile',
    profileList: 'Available profiles',
    username: 'Username',
    password: 'Password',
    loginFailed: 'login failed',
    savePassword: 'Save password for this profile',
    // PSR-F14 (#111): explicit opt-in to fetching a previously saved
    // password from the secure store. Pre-fix the renderer auto-fired
    // getStoredPassword on every keystroke; the gate avoids that
    // implicit safeStorage.decrypt round-trip.
    useSavedPassword: 'Use saved password',
  },

  query: {
    runHotkey: 'Run ({{mod}}+Enter)',
    cancel: 'Cancel',
    streamMode: 'Stream',
    expandGraphCells: 'Expand graph cells',
    resultViewLabel: 'Result view',
    tabTable: 'table',
    tabJson: 'json',
    tabGraph: 'graph',
    tabMatrix: 'Matrix',
    loadingEditor: 'Loading editor…',
    loadingGraph: 'Loading graph view…',
    maximizeResults: 'Maximize results',
    exitFullscreen: 'Exit fullscreen',
    optionsLabel: 'Options',
    formatLabel: 'Format',
    formatHotkey: 'Format ({{mod}}{{shift}}F)',
    formatAriaLabel: 'Format query',
    autoFormatInserted: 'Auto-format inserted queries',
    streamRetentionBanner:
      '{{truncated}} more streamed rows were not retained (in-memory cap {{cap}}). Re-run with server-side export to get the full result.',
  },

  graph: {
    canvasAria:
      'Cytoscape graph rendering. Use the Display panel to choose which property labels each node and edge.',
    noNodesToConfigure: 'No nodes to configure.',
    nodeFieldLabel: 'Display field for {{label}} nodes',
    edgeFieldLabel: 'Display field for {{type}} edges',
    unlabeledNode: 'unlabeled',
    optionLabelName: 'label name',
    optionType: 'type',
    selectedNode: 'Node {{id}}',
    selectedEdge: 'Edge {{id}}',
    inspectHint: 'Click a node or edge to inspect properties.',
    inspectorViewGroup: 'Inspector view',
    inspectorViewProps: 'Properties',
    inspectorViewJson: 'Raw JSON',
    inspectorNoProps: 'No properties.',
    tooltipNoProps: 'No properties.',
    inspectorId: 'id',
    inspectorLabels: 'labels',
    inspectorType: 'type',
    inspectorStub: 'placeholder',
    inspectorActions: 'Node actions',
    actionHide: 'Hide',
    actionCollapse: 'Collapse',
    actionExploreNeighbours: 'Explore neighbours',
    menuZoomTo: 'Zoom to node',
    menuExpand: 'Expand neighbours…',
    menuFocus: 'Focus on this node',
    menuPin: 'Pin position',
    menuUnpin: 'Unpin',
    menuCopyId: 'Copy id',
    focus: 'Focus',
    focusClear: 'Clear focus',
    focusClearChip: 'Focused — Clear ×',
    focusHops: 'Hops',
    expandTitle: 'Expand neighbours of node {{id}}',
    expandDirection: 'Direction',
    expandBoth: 'Both',
    expandOut: 'Outgoing',
    expandIn: 'Incoming',
    expandLabelFilter: 'Label filter',
    expandLabelAny: '(any)',
    expandLimit: 'Limit',
    expandCancel: 'Cancel',
    expandRun: 'Run',
    exploreNeighboursLoading: 'Exploring…',
    exploreNeighboursFailed: 'Could not load neighbours: {{message}}',
    exploreNeighboursUnavailable:
      'This node has no stable id to query — explore is unavailable for synthesised nodes.',
    collapsedCount_one: '{{count}} neighbour collapsed',
    collapsedCount_other: '{{count}} neighbours collapsed',
    neighborsHeading_one: '{{count}} neighbor',
    neighborsHeading_other: '{{count}} neighbors',
    hiddenHeading: 'Hidden ({{count}})',
    collapsedHeading: 'Collapsed ({{count}})',
    restore: 'Restore',
    expand: 'Expand',
    empty: 'No nodes or edges to display for this query.',
    errorBanner: 'Failed to render graph: {{message}}',
    layoutLabel: 'Layout',
    layout: {
      cose: 'Force (cose)',
      fcose: 'Force (fast)',
      dagre: 'Layered (DAG)',
      breadthfirst: 'Breadth-first',
      circle: 'Circle',
      concentric: 'Concentric',
      grid: 'Grid',
      spread: 'Spread (anti-overlap)',
    },
    stats: '{{nodes}} nodes · {{edges}} edges',
    selectionModeLabel: 'Selection mode',
    selectionModePan: 'Pan',
    selectionModeBox: 'Box select',
    clusterByLabel: 'Group by label',
    clusterByLabelLabel: 'Group nodes by label',
    degreeSizing: 'Size by edges',
    degreeSizingLabel: 'Resize nodes by number of connections (log-scaled)',
    pathMode: 'Path',
    pathModeLabel: 'Find a path between two nodes',
    pathPickSource: 'Click the start node',
    pathPickTarget: 'Click the end node',
    pathResult: 'Path: {{from}} → {{to}} · {{hops}} hops',
    pathNone: 'No path between {{from}} and {{to}}',
    pathClear: 'Clear path',
    canvasControls: {
      aria: 'Graph viewport controls',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit graph to view',
      reset: 'Reset view + layout',
    },
    zoomSlider: {
      aria: 'Zoom level',
    },
    miniMap: 'Mini-map',
    wheelSensitivity: 'Mouse-wheel zoom sensitivity',
    lasso: 'Lasso',
    domNodes: 'HTML nodes',
    findPlaceholder: 'Find node…',
    findAria: 'Find nodes by id, label, or property value',
    findCount_one: '{{count}} match',
    findCount_other: '{{count}} matches',
    moreLabel: 'More…',
    toggleSidebarFromMore: 'Show inspector sidebar',
    toggleSidebarShow: 'Show inspector sidebar',
    toggleSidebarHide: 'Hide inspector sidebar',
    viewGroupLabel: 'View',
    filtersGroupLabel: 'Filters',
    analysisGroupLabel: 'Analysis',
    sectionVisibility: 'Visibility',
    sectionDisplay: 'Display fields',
    sectionInspector: 'Inspector',
    filterChipHidden: 'Hidden: {{label}}',
    filterChipFocused: 'Focused (id {{id}}, {{hops}} hops)',
    filterChipCluster: 'Grouped by label',
    filterChipPath: 'Path mode',
    filterChipClear: 'Clear filter',
  },

  matrix: {
    empty: 'No edges between labelled nodes to show.',
    tableLabel: 'Label adjacency matrix',
    cellTitle: '{{from}} → {{to}}: {{count}} edges ({{types}})',
    cellTitleEmpty: '{{from}} → {{to}}: 0 edges',
    overflow:
      'Showing {{shown}} of {{shown}}+{{hidden}} labels (+{{hidden}} more, {{edges}} edges hidden)',
  },

  dashboard: {
    title: 'Overview',
    graphsTitle: 'Graphs ({{count}})',
    graphsEmpty: 'No graphs.',
    graphsOpenAria: 'Open schema for {{name}}',
    recentTitle: 'Session query history',
    recentEmpty: 'No queries yet — run one on the Query page.',
    recentFailed: 'failed',
    recentScopeHint:
      'Stored on this device only; not synced to the Geode server.',
    clearHistory: 'Clear',
    connectionTitle: 'Connection',
    version: 'Geode {{version}}',
    capUsers: 'Users',
    capRoles: 'Roles',
    capPolicies: 'Policies',
    capGrants: 'Grants',
    capYes: 'enabled',
    capNo: 'disabled',
    statsTitle: '{{graph}} stats',
    statsLoad: 'Load stats',
    statsNodes: 'Nodes',
    statsEdges: 'Edges',
    loading: 'Loading…',
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
    // Password generator + client-side policy (mirrors
    // internal/server/password_policy.go). See
    // src/lib/passwordPolicy.ts for the mapping from policy violation
    // enum to i18n key.
    generatePassword: 'Generate',
    passwordTooShort: 'Password must be at least 12 characters',
    passwordWeakPattern: 'Password is too predictable',
    passwordContainsUsername: 'Password must not contain the username',
    passwordHintRequirements:
      'At least 12 characters; not all same character or all digits; must not contain the username',
    unsupportedNote:
      'Creating users is not supported on the connected Geode build.',
    unsupportedTooltip:
      'Not supported on the connected Geode build — manage users via the `geode` CLI',
    wireFeatureMissing:
      'Not supported on the connected Geode build — manage users via the `geode` CLI',
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
    permissionsHint:
      'Type a permission and press Enter to add it. Suggestions follow the <action>:<resource> convention (e.g. read:graph); free text is accepted.',
    permissionsPlaceholder: 'e.g. read:graph',
    removePermission: 'Remove permission {{permission}}',
    unsupportedNote:
      'Creating roles is not supported on the connected Geode build.',
    unsupportedTooltip:
      'Not supported on the connected Geode build — manage roles via the `geode` CLI',
    wireFeatureMissing:
      'Not supported on the connected Geode build — manage roles via the `geode` CLI',
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
    operationLabel: 'Operation',
    tableLabel: 'Table',
    tableHint:
      'The table or resource this policy guards (e.g. node); free text is accepted.',
    usingLabel: 'USING clause',
    usingHint:
      'A boolean predicate evaluated per row, e.g. owner_id = current_user().',
    checkLabel: 'WITH CHECK clause',
    checkHint:
      'WITH CHECK clause (optional) — predicate new or updated rows must satisfy.',
    unsupportedNote:
      'Creating policies is not supported on the connected Geode build.',
    unsupportedTooltip:
      'Not supported on the connected Geode build — manage policies via the `geode` CLI',
    wireFeatureMissing:
      'Not supported on the connected Geode build — manage policies via the `geode` CLI',
  },

  grants: {
    title: 'Grants',
    fieldPermission: 'Permission',
    permissionHint:
      'The permission being granted — typically <action>:<resource> (e.g. read:graph) or a bare action; free text is accepted.',
    permissionPlaceholder: 'e.g. read:graph',
    fieldResource: 'Resource',
    resourceHint:
      'The resource the grant applies to (e.g. graph or graph:default); free text is accepted.',
    resourcePlaceholder: 'e.g. graph',
    fieldGrantee: 'Grantee',
    granteePlaceholder: 'username or role name',
    fieldGranteeKind: 'Grantee kind',
    granteeKindUser: 'user',
    granteeKindRole: 'role',
    applied: 'Grant applied.',
    revoked: 'Grant revoked.',
    unsupportedNote:
      'Applying and revoking grants is not supported on the connected Geode build.',
    unsupportedTooltip:
      'Not supported on the connected Geode build — manage grants via the `geode` CLI',
    wireFeatureMissing:
      'Not supported on the connected Geode build — manage grants via the `geode` CLI',
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
    queryFailed: 'query failed',
  },

  connection: {
    noActive: 'No active connection',
    connect: 'Connect',
    disconnect: 'Disconnect',
    addAnother: 'Add another connection',
    // PSR-G04 (#81) — surfaced when the open-time `listProfiles` call
    // fails so the user knows the saved-username dropdown will not
    // populate. The form remains usable; the error is informational.
    profileListLoadFailed:
      'Could not load saved profiles — you can still type credentials manually.',
    // PSR-G04 (#81) — surfaced when `fetchPublicProfiles` fails so the
    // user knows the bootstrap profile picker is using a free-form
    // input rather than a populated select.
    publicProfileListLoadFailed:
      'Could not load the profile list — pick a profile name manually.',
  },

  electron: {
    browse: 'Browse…',
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
    actions: {
      create: 'Create profile',
      edit: 'Edit',
      delete: 'Delete',
      setDefault: 'Set as default',
    },
    empty: 'No profiles yet.',
    loading: 'Loading profiles…',
    error: 'Could not load profiles.',
    editor: {
      create: {
        title: 'Create profile',
      },
      edit: {
        title: 'Edit profile',
      },
      field: {
        name: 'Name',
        dsn: 'DSN',
        description: 'Description',
        savedUsername: 'Saved username (optional)',
        scope: 'Scope',
        isDefault: 'Default for this scope',
        caPem: 'CA PEM',
        clientCertPem: 'Client certificate PEM',
        clientKeyPem: 'Client key PEM',
        maxOpenConns: 'Max open connections',
        maxIdleConns: 'Max idle connections',
        connMaxLifetimeMs: 'Max connection lifetime (ms)',
        connMaxIdleMs: 'Max idle time (ms)',
      },
      section: {
        tls: 'TLS material (optional)',
        pool: 'Pool tuning (optional — leave blank for server defaults)',
      },
      actions: {
        save: 'Save',
        cancel: 'Cancel',
      },
      error: {
        failed: 'Failed to save profile',
        nameTaken: 'A profile with this name already exists',
      },
    },
    delete: {
      title: 'Delete profile',
      confirm: 'Delete profile "{{name}}"? This cannot be undone.',
      // PSR-G05 (#82): surfaced when DELETE /profiles/{id} rejects so
      // the user knows the row will reappear on next refresh and can
      // retry.
      error: 'Failed to delete profile',
      actions: {
        delete: 'Delete',
        cancel: 'Cancel',
      },
    },
    // PSR-G05 (#82): surfaced when one of the two PATCH calls in
    // ProfilesPage.setAsDefault rejects. The dance can leave the
    // server in a partially-updated state (peer cleared, target not
    // promoted, or vice-versa); the toast lets the user know they
    // should re-run the action or reload.
    setDefaultError: 'Failed to set default profile',
  },
} as const

export type Translations = typeof en
