export const STATEMENT_TIMEOUT_MS: number;
export interface Outcome {
  passed: boolean;
  code: string;
  message: string;
  note?: string;
  inTransaction?: boolean | null;
}
export interface DbClient {
  query(sql: string, params?: string[]): Promise<unknown>;
}
export function sqlProblems(sql: string): string[];
export function classifyOutcome(error: { code?: string; message?: string } | null): Outcome;
export function runOne(client: DbClient, sql: string): Promise<Outcome>;
export const PROBES: { name: string; expect: string; sql: string }[];
export function runProbes(
  connect: () => Promise<DbClient & { end(): Promise<unknown> }>,
): Promise<{ ok: boolean; results: { name: string; ok: boolean; code: string }[] }>;
export function pgEnvProblem(env: Record<string, string | undefined>): string | null;
export const OUTSIDE_TX_EXTENSIONS: string[];
export function serverProblem(state: { extensions: string[]; foreignServers: number }): string | null;
export const FINGERPRINT_SQL: string;
export function snapshotChanges(before: Map<string, string>, after: Map<string, string>): string[];
export function parseDbUrl(
  raw: string | undefined,
): { ok: true; config: { host: string; port: number; user: string; password: string; database: string }; ref: string } | { ok: false; message: string };
export function projectRefProblem(ref: string, supabaseUrl: string): string | null;
export function safeText(text: string, secrets: string[]): string;
export function reportDetail(outcome: { code?: string; message?: string; note?: string }, secrets: string[]): string;
export function selectFiles(available: string[], args: string[]): { ok: true; files: string[] } | { ok: false; message: string };
