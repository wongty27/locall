const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The inline problem matcher in .vscode/tasks.json reads these log lines.
// A shared counter means "finished" only prints once every bundle is done.
let activeBuilds = 0;

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			if (activeBuilds++ === 0) {
				console.log('[watch] build started');
			}
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			if (--activeBuilds === 0) {
				console.log('[watch] build finished');
			}
		});
	},
};

const shared = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: 'silent',
	plugins: [
		/* add to the end of plugins array */
		esbuildProblemMatcherPlugin,
	],
};

async function main() {
	const contexts = await Promise.all([
		esbuild.context({
			...shared,
			entryPoints: ['src/extension.ts'],
			format: 'cjs',
			platform: 'node',
			outfile: 'dist/extension.js',
			external: ['vscode'],
		}),
		esbuild.context({
			...shared,
			entryPoints: ['src/webview/main.tsx'],
			format: 'iife',
			platform: 'browser',
			target: 'es2022',
			outfile: 'dist/webview.js',
			jsx: 'automatic',
			jsxImportSource: 'preact',
		}),
	]);
	if (watch) {
		await Promise.all(contexts.map((ctx) => ctx.watch()));
	} else {
		const results = await Promise.allSettled(contexts.map((ctx) => ctx.rebuild()));
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
		if (results.some((result) => result.status === 'rejected')) {
			process.exit(1);
		}
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
