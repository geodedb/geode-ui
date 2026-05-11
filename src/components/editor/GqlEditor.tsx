import React from 'react'
// Side-effect import: wires @monaco-editor/react to the webpack-bundled
// monaco instance (skips the CDN AMD loader our CSP blocks). This used
// to live at the top of src/index.tsx, which pulled all of
// monaco-editor (~several MiB) into the initial bundle. As of F10 (#54)
// the editor is React.lazy'd at the QueryPage call site, so importing
// the bootstrap *here* keeps monaco inside the lazy editor chunk
// instead of the entry chunk.
import '../../monaco-bootstrap'
import Editor, { OnMount } from '@monaco-editor/react'
import { GQL_LANGUAGE_ID, registerGqlLanguage } from './gqlLanguage'

type Props = {
  value: string
  onChange: (s: string) => void
  onRun: () => void
  height?: number
}

export const GqlEditor: React.FC<Props> = ({
  value,
  onChange,
  onRun,
  height = 240,
}) => {
  const handleMount: OnMount = (editor, monaco) => {
    registerGqlLanguage(monaco)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun)
  }

  return (
    <Editor
      height={height}
      language={GQL_LANGUAGE_ID}
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
      }}
    />
  )
}
