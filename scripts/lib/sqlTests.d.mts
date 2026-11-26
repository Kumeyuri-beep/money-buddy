export const STATEMENT_TIMEOUT_MS: number;
export interface Outcome {
  passed: boolean;
  code: string;
  message: string;
}
export function sqlProblems(sql: string): string[];
export function classifyOutcome(error: { code?: string; message?: string } | null): Outcome;
export function runOne(client: { query(sql: string): Promise<unknown> }, sql: string): Promise<Outcome>;
export function parseDbUrl(
  raw: string | undefined,
): { ok: true; config: { host: string; port: number; user: string; password: string; database: string }; ref: string } | { ok: false; message: string };
export function projectRefProblem(ref: string, supabaseUrl: string): string | null;
export function safeText(text: string, secrets: string[]): string;
export function selectFiles(available: string[], args: string[]): { ok: true; files: string[] } | { ok: false; message: string };
