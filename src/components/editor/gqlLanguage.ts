import type { Monaco } from '@monaco-editor/react'

export const GQL_LANGUAGE_ID = 'gql'

export function registerGqlLanguage(monaco: Monaco): void {
  if (
    monaco.languages
      .getLanguages()
      .some((l: { id: string }) => l.id === GQL_LANGUAGE_ID)
  ) {
    return
  }
  monaco.languages.register({ id: GQL_LANGUAGE_ID })
  monaco.languages.setMonarchTokensProvider(GQL_LANGUAGE_ID, {
    ignoreCase: true,
    keywords: [
      'MATCH',
      'OPTIONAL',
      'RETURN',
      'WHERE',
      'WITH',
      'UNWIND',
      'CREATE',
      'MERGE',
      'DELETE',
      'DETACH',
      'SET',
      'REMOVE',
      'FOREACH',
      'CALL',
      'YIELD',
      'UNION',
      'ALL',
      'AS',
      'DISTINCT',
      'ORDER',
      'BY',
      'LIMIT',
      'SKIP',
      'OFFSET',
      'ASC',
      'DESC',
      'NULL',
      'TRUE',
      'FALSE',
      'AND',
      'OR',
      'NOT',
      'IN',
      'IS',
      'EXISTS',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'USE',
      'GRAPH',
      'SHOW',
      'GRANT',
      'REVOKE',
      'DROP',
      'INDEX',
      'CONSTRAINT',
      'POLICY',
      'USER',
      'ROLE',
      'PASSWORD',
      'BACKUP',
      'RESTORE',
    ],
    operators: [
      '=',
      '<>',
      '<',
      '>',
      '<=',
      '>=',
      '+',
      '-',
      '*',
      '/',
      '%',
      '->',
      '<-',
      '-->',
      '<--',
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, 'string'],
        [/\d+(\.\d+)?/, 'number'],
        [
          /[a-zA-Z_][\w]*/,
          { cases: { '@keywords': 'keyword', '@default': 'identifier' } },
        ],
        [/[[\]{}()]/, '@brackets'],
        [/[<>=!+\-*/%]+/, 'operator'],
      ],
    },
  })
}
