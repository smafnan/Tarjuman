// Types for launch.mjs, which stays plain JavaScript because it runs before anything is installed.
export declare const INSTALL_INPUTS: readonly string[];
export declare const BUILD_INPUTS: readonly string[];
export declare function fingerprint(root: string, entries: readonly string[]): string;
export declare function isStale(stampFile: string, print: string): boolean;
export declare function stamp(stampFile: string, print: string): void;
export declare function main(root?: string): number;
