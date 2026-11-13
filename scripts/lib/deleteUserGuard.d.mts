export const PROTECTED_USERNAME: string;
export function parseDeleteArgs(args: readonly string[]): { username: string; force: boolean } | { error: string };
export function refusalReason(input: { username: string; totalUsers: number; force: boolean }): string | null;
export function confirmationPhrase(input: { username: string; totalUsers: number; force: boolean }): string;
export function confirmationMatches(typed: unknown, expected: string): boolean;
export const COUNT_TABLES: readonly string[];
