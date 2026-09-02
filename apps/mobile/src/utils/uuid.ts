/**
 * RFC4122 version 4 UUID generator for React Native environments where
 * global crypto.randomUUID may not be available natively.
 */
export function randomUUID(): string {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      // fallback
    }
  }

  // RFC4122 v4 compliant fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Polyfill globalThis.crypto.randomUUID if missing in React Native environment
if (typeof globalThis !== 'undefined') {
  if (!globalThis.crypto) {
    // @ts-expect-error - polyfilling crypto object for react-native
    globalThis.crypto = { randomUUID };
  } else if (typeof globalThis.crypto.randomUUID !== 'function') {
    // @ts-expect-error - polyfilling randomUUID
    globalThis.crypto.randomUUID = randomUUID;
  }
}
