import React from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { GQL_LANGUAGE_ID, registerGqlLanguage } from './gqlLanguage'

type Props = {
  value: string
  onChange: (s: string) => void
  onRun: () => void
  height?: number
}

export const GqlEditor: React.FC<Props> = ({ value, onChange, onRun, height = 240 }) => {
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
      options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false }}
    />
  )
}
