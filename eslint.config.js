import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude/는 /issue 워크트리(다른 브랜치), src/components/ui·src/hooks·src/lib/utils.ts는 shadcn/ui가 만든 파일(CLAUDE.md)
  globalIgnores(['dist', '.claude', 'src/components/ui', 'src/hooks', 'src/lib/utils.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
