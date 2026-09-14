import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config'; // vite's, plus the `test` block

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter({ precompress: true })
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// the server runs in Arizona time (deploy/vps/opscenter.service); date math is tested in it
		env: { TZ: 'America/Phoenix' }
	}
});
