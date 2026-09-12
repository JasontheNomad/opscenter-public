// ESLint (flat config). `npm run lint`; the deploy script runs it before shipping.
// Recommended JS / TypeScript / Svelte rules, plus the type-aware promise rules — an unhandled rejection
// in a click handler or the poller is this app's most common silent failure. The strict "unsafe any"
// family is left off: Graph and HubSpot responses are loosely typed and it would bury everything else.
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
	{ ignores: ['build/', '.svelte-kit/', 'node_modules/', 'extension/', 'static/', 'data/'] },
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: { projectService: true, extraFileExtensions: ['.svelte'] }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser } }
	},
	{
		rules: {
			// house style: `cond && run()` / `(a(), b())` one-liners, bare `dep;` reads that make a $derived
			// depend on something, and `catch {}` where a failure is acceptable
			'@typescript-eslint/no-unused-expressions': 'off',
			'no-empty': ['error', { allowEmptyCatch: true }],
			// plain Map / Set / Date here are deliberately non-reactive (in-flight sets, banner maps, date math)
			'svelte/prefer-svelte-reactivity': 'off',
			// served at the root, never under a base path — resolve() on every href/goto buys nothing here
			'svelte/no-navigation-without-resolve': 'off',
			// every remote-HTML {@html} goes through DOMPurify (cleanHtml / DOMPurify.sanitize) — see sanitize.ts
			'svelte/no-at-html-tags': 'off'
		}
	},
	{
		files: ['**/*.ts', '**/*.svelte'],
		rules: {
			'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
			'@typescript-eslint/await-thenable': 'error',
			// async functions passed where a boolean is expected (if (fetchThing) …) — not event handlers,
			// where Svelte ignores the returned promise by design
			'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }]
		}
	},
	{
		// plain JS config files aren't in the TS project
		files: ['**/*.js'],
		...ts.configs.disableTypeChecked
	}
);
