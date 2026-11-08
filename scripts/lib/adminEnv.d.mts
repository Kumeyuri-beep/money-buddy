export const ADMIN_DIR_NAME: string;
export const ADMIN_FILE_NAME: string;
export function adminEnvPath(home: string, sep?: string): string;
export function isInsideDir(child: string, parent: string): boolean;
export function redact(text: string, secrets: readonly (string | undefined)[]): string;
export function generateTempPassword(fill?: (bytes: Uint8Array) => Uint8Array, length?: number): string;
