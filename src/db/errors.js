// Never include driver messages: they can contain connection details or row data.
export function describeDatabaseError(error) {
  const codes = [error?.code, ...(error?.errors || []).map(cause => cause.code)];
  if (codes.includes('ENETUNREACH') || codes.includes('EHOSTUNREACH')) {
    return 'Database host is unreachable. Supabase direct connections can require IPv6. Use Connect > Session pooler (port 5432), copying its exact hostname and username into DATABASE_URL (and MIGRATION_DATABASE_URL if set).';
  }
  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
    return 'Cannot resolve the database hostname. Check the connection URL from Supabase Connect and your network/DNS access.';
  }
  if (codes.some(code => ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code))) {
    return 'Database TLS certificate verification failed. Check the hostname and configure DATABASE_CA_CERT_PATH with the PostgreSQL root certificate from Supabase. Keep verification enabled.';
  }
  if (codes.includes('28P01') || codes.includes('28000')) {
    return 'Database authentication failed. Check the database username and password, URL-encoding special password characters. A Supabase API key is not a database password.';
  }
  if (codes.includes('42P06') || codes.includes('42P07')) {
    return 'The application schema or table already exists. Inspect the portfolio schema and its migration history. Existing data has not been overwritten.';
  }
  if (codes.includes('42501')) {
    return 'The database role lacks permission. Use the schema owner connection in MIGRATION_DATABASE_URL for setup and grant the runtime role the required privileges.';
  }
  if (codes.includes('42P01') || codes.includes('3F000')) {
    return 'The application schema or an authentication table is missing. Run npm run db:migrate with the schema owner connection first.';
  }
  if (codes.includes('ECONNREFUSED') || codes.includes('ETIMEDOUT') || /timeout/i.test(error?.message || '')) {
    return 'Database connection refused or timed out. Check the host, port, project status, and network access in Supabase Connect.';
  }
  return 'Database operation failed. Check the connection, TLS configuration, schema, and role permissions. No credentials or database error details were printed.';
}
