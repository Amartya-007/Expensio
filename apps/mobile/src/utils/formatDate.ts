/**
 * Shared date/time formatting helpers used across multiple screens.
 * Extracted from ActivityLogScreen and TripDetailScreen which both
 * defined identical formatTimestamp functions.
 */

/**
 * Formats an ISO timestamp into a short locale string: "Sep 7, 3:45 PM".
 * Used for expense created-at labels and activity-log entries.
 */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
