import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		passWithNoTests: true,
		coverage: {
			reportsDirectory: './coverage-test',
			provider: 'istanbul', // or 'v8'
			// provider: 'v8',
			include: ['src/**/*.{js,ts}'],
			reporter: ['text', 'html', 'clover', 'json', 'lcov']
		}
	}
});
