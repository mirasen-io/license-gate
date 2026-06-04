// Post-build step: ensure dist/cli.js starts with a Node shebang and is executable.
// TypeScript preserves a top-of-file `#!/usr/bin/env node` line as a comment in
// the emitted JS, but the executable bit is not preserved by `tsc`. This script
// asserts the shebang is present and applies +x.

import { chmod, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, '..', 'dist', 'cli.js');

const SHEBANG = '#!/usr/bin/env node';

const source = await readFile(cliPath, 'utf8');
if (!source.startsWith(SHEBANG)) {
	console.error(
		`postbuild: ${cliPath} must start with "${SHEBANG}" but starts with: ${source.slice(0, 40)}`
	);
	process.exit(1);
}

await chmod(cliPath, 0o755);
console.log(`postbuild: ${cliPath} shebang verified, mode set to 0755`);
