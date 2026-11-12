import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Fast Refresh (a dev-server convenience) wants component files to
      // export only components. These files deliberately share a few small
      // constants and helpers with the components that use them; listing
      // them keeps the rule on for everything else.
      'react-refresh/only-export-components': ['error', {
        allowExportNames: [
          // Section.jsx: step states and shared styles
          'STEP_STATES', 'labelStyle', 'inputStyle', 'subPanelStyle', 'preStyle',
          'tableStyle', 'thStyle', 'tdStyle', 'chipStyle',
          // JobResultSummary.jsx
          'CATEGORY_LABELS',
          // LoadTestConfig.jsx
          'LIMITS', 'clampInt',
          // RequestHeadersEditor.jsx
          'headersObject',
          // SloConfig.jsx
          'SLO_FIELDS', 'DEFAULT_SLO', 'sloPayload',
          // CapacityConfig.jsx
          'CAPACITY_LIMITS', 'capacitySteps',
        ],
      }],
    },
  },
])
