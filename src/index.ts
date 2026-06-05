/**
 * Public programmatic API for @mirasen/license-gate.
 *
 * Use these from custom CI scripts or pre-commit hooks instead of shelling
 * out to the binary.
 *
 * Both `runCheck` and `runCollect` accept an options object and return a
 * detailed result. The library never calls `process.exit`; the caller
 * decides what to do with the exit code.
 *
 * Public types:
 *   - InstalledPackageRecord
 *   - Decision (closed discriminated union)
 *   - ViolationReason (closed discriminated union — exactly two top-level
 *     reasons: `license-not-in-allowlist`, `package-not-in-allowlist`)
 *   - ConfigError + LicenseGateConfigError (thrown for usage/config issues)
 *   - CheckResult / CollectResult / CollectedRecord
 */

export { runCheck } from './commands/check.js';
export type { CheckOptions, CheckCliResult } from './commands/check.js';

export { runCollect } from './commands/collect.js';
export type { CollectOptions, CollectCliResult } from './commands/collect.js';

export { LICENSE_COULD_NOT_DETERMINE, LicenseGateConfigError } from './types.js';
export type {
	AllowedHardList,
	AllowedPackages,
	AllowedPackagesRule,
	CheckResult,
	CollectedRecord,
	CollectResult,
	ConfigError,
	Decision,
	InstalledPackageRecord,
	LicenseCouldNotDetermine,
	ViolationReason
} from './types.js';

export { renderCheckJson, renderCollectJson } from './report/json.js';
export type { CheckJsonReport, CollectJsonReport } from './report/json.js';
export { renderCheckHuman, renderCollectHuman } from './report/human.js';
