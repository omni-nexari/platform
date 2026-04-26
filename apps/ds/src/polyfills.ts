// Polyfill crypto.randomUUID for non-secure HTTP contexts (e.g. LAN IP access).
// This file must be the first import in main.tsx so it runs before any module
// that calls crypto.randomUUID() at the top level.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as any).randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) => {
      const n = parseInt(c, 10);
      return (n ^ ((crypto.getRandomValues(new Uint8Array(1))[0]!) & (15 >> (n / 4)))).toString(16);
    }) as `${string}-${string}-${string}-${string}-${string}`;
  };
}
