import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['dist', 'node_modules'] }, // Ignore dist and node_modules folders
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules, // Add React-specific recommended rules
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }], // Ignore constants
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'react/jsx-uses-react': 'off', // Not needed for React 17+ (new JSX transform)
      'react/react-in-jsx-scope': 'off', // Not needed for React 17+ (new JSX transform)
      'react/prop-types': 'off', // Disable prop-types rule if using TypeScript
      'react/jsx-filename-extension': ['warn', { extensions: ['.jsx', '.js'] }], // Allow JSX in .js files
      'react/jsx-key': 'error', // Ensure keys are used in lists
      'react/jsx-no-duplicate-props': 'error', // Prevent duplicate props in JSX
      'react/jsx-no-undef': 'error', // Prevent undefined variables in JSX
      'react/jsx-pascal-case': 'warn', // Enforce PascalCase for component names
    },
    settings: {
      react: {
        version: 'detect', // Automatically detect the React version
      },
    },
  },
];
