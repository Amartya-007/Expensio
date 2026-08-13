import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { db, connectPowerSync } from './powersync/db';

type SpikeItem = { id: string; note: string; created_at: string };

// This screen exists to answer exactly one question: does a row written on
// this device show up in Postgres, and does a row written elsewhere show up
// here — including after killing the app and going offline? Nothing about
// Expensio's real UI belongs here yet; see docs/architecture/
// expensio-powersync-spike.md for what "pass" actually means.
export default function App() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<SpikeItem[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('starting…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // Anonymous sign-in by default, per architecture doc §3 — every
        // user (including a guest) gets a real auth.uid() the moment the
        // app opens, which is what both RLS and PowerSync's auth need.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setStatus('signing in…');
          const { error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
        }

        setStatus('connecting PowerSync…');
        await connectPowerSync();
        if (cancelled) return;
        setReady(true);
        setStatus('connected');
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    // Live query — fires immediately with whatever's already in local
    // SQLite, then again every time a sync (or a local write) changes the
    // result set. This is the actual thing being proven: no manual refresh,
    // no polling.
    //
    // NOTE: @powersync/web's watch() API is still moving (alpha/beta SDK —
    // see expensio-architecture.md §1). If this doesn't compile against
    // whatever version actually installs, check the current signature at
    // docs.powersync.com — the query and the intent below won't have
    // changed, just possibly the callback shape.
    const abortController = new AbortController();
    db.watch(
      'SELECT id, note, created_at FROM spike_items ORDER BY created_at DESC LIMIT 50',
      [],
      {
        onResult: (result) => setItems(result.rows?._array ?? []),
        onError: (err) => setError(String(err)),
      },
      { signal: abortController.signal }
    );

    return () => abortController.abort();
  }, [ready]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    // Writes to local SQLite immediately (shows up in the list instantly,
    // offline or not) and queues for upload — SupabaseConnector.uploadData
    // pushes it to Postgres as soon as there's connectivity.
    await db.execute('INSERT INTO spike_items (id, note, created_at) VALUES (?, ?, ?)', [
      crypto.randomUUID(),
      note.trim(),
      new Date().toISOString(),
    ]);
    setNote('');
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.25rem' }}>Expensio — PowerSync spike</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>Status: {status}</p>
      {error && (
        <p style={{ color: '#b00020', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{error}</p>
      )}

      <form onSubmit={addItem} style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Type something, then check another device"
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button type="submit" disabled={!ready}>
          Add
        </button>
      </form>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => (
          <li key={item.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
            <div>{item.note}</div>
            <div style={{ fontSize: '0.75rem', color: '#999' }}>{item.created_at}</div>
          </li>
        ))}
        {items.length === 0 && ready && <li style={{ color: '#999' }}>No items yet.</li>}
      </ul>
    </main>
  );
}
