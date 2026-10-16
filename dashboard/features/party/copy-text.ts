/**
 * Copies text to the clipboard. The Clipboard API exists only in secure contexts, so a
 * console opened over plain HTTP by LAN address falls back to the legacy copy command,
 * which works there during a click.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Denied or unavailable; try the legacy command. */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  // The only clipboard write available outside secure contexts.
  // oxlint-disable-next-line typescript/no-deprecated
  try { return document.execCommand('copy'); }
  catch { return false; }
  finally { area.remove(); }
}
