let debugAssets = false;
export function setLocalDebugAssets(value: boolean) { debugAssets = value; }
export function gameImageUrl(url: string) {
  if (!debugAssets || !url.startsWith('https://adventure.land/images/')) return url;
  return '/debug-assets' + url.slice('https://adventure.land'.length);
}
