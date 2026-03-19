/** Emergency full-screen overlay (z=100) */

export function showEmergency(text?: string, contentItemId?: string): void {
  import('../state.js').then(({ state }) => { state.emergencyActive = true; });
  const el = document.getElementById('emergency')!;
  el.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    background: #b91c1c;
    color: #fff;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 8vw;
    font-weight: 700;
    text-align: center;
    padding: 4vw;
    line-height: 1.3;
    position: absolute; inset: 0; z-index: 100;
  `;
  el.textContent = text ?? 'EMERGENCY ALERT';
}

export function clearEmergency(): void {
  import('../state.js').then(({ state }) => { state.emergencyActive = false; });
  const el = document.getElementById('emergency')!;
  el.style.display = 'none';
  el.textContent = '';
}
