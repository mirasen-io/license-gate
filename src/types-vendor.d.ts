/**
 * Minimal type declarations for runtime dependencies that ship without their
 * own .d.ts files. We type only the surface we actually use.
 */

declare module '@npmcli/arborist' {
	export interface ArboristOptions {
		path: string;
	}
	export default class Arborist {
		constructor(opts: ArboristOptions);
		loadActual(): Promise<unknown>;
	}
}

declare module 'spdx-expression-parse' {
	type Leaf = { license: string; exception?: string };
	type Compound = { left: Node; conjunction: 'and' | 'or'; right: Node };
	type Node = Leaf | Compound;
	function parse(expression: string): Node;
	export default parse;
}
