export type SecretKind = 'sb_secret' | 'jwt-service-role';
export function findSecretKeys(text: string): SecretKind[];
