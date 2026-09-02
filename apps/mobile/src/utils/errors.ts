/**
 * Formats any error (PostgREST errors, Supabase Auth errors, Network errors, JS Errors)
 * into a clean, human-readable string instead of "[object Object]".
 */
export function formatError(err: unknown): string {
  if (!err) return 'An unknown error occurred';
  if (typeof err === 'string') return err;

  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;

    // Specific guidance for common Supabase and PowerSync configuration errors
    const message = typeof e.message === 'string' ? e.message : '';
    const fullText = `${message} ${JSON.stringify(e)}`.toLowerCase();

    if (fullText.includes('anonymous sign-ins are disabled')) {
      return 'Anonymous sign-ins are disabled in Supabase. Enable them in Supabase Dashboard → Authentication → Providers → Anonymous Sign-Ins.';
    }

    if (fullText.includes('null value in column "created_by"')) {
      return 'You are not signed in. Please ensure Anonymous Sign-Ins are enabled in Supabase Dashboard.';
    }

    if (fullText.includes('psync_s2105') || fullText.includes('unexpected "aud" claim value')) {
      return 'PowerSync Audience mismatch. In PowerSync Dashboard → Client Authentication, set Audience to "authenticated" (or select Supabase Auth provider).';
    }

    if (fullText.includes('psync_s2101') || fullText.includes('no key matched the token kid')) {
      return 'PowerSync JWKS mismatch. In PowerSync Dashboard → Client Authentication, set JWKS URL to your Supabase .well-known/jwks.json URL.';
    }

    // Check standard error fields
    if (message) {
      const details = typeof e.details === 'string' ? e.details.trim() : '';
      if (details) {
        return `${message}: ${details}`;
      }
      return message;
    }

    if (typeof e.error_description === 'string' && e.error_description) {
      return e.error_description;
    }

    if (typeof e.msg === 'string' && e.msg) {
      return e.msg;
    }

    if (typeof e.details === 'string' && e.details) {
      return e.details;
    }

    if (typeof e.hint === 'string' && e.hint) {
      return e.hint;
    }

    if (typeof e.code === 'string' || typeof e.code === 'number') {
      return `Database error (code ${e.code})`;
    }

    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') {
        return json;
      }
    } catch {
      // Ignore JSON stringify failure
    }
  }

  return String(err);
}
