import type { SupabaseClient } from '@supabase/supabase-js';

export function fail(message: string, code?: number): never;
export function makeSafeMessage(secrets: string[]): (error: unknown) => string;
export function loadAdmin(): { client: SupabaseClient; url: string; safeMessage: (error: unknown) => string };
