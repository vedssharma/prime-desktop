// Points the download buttons at the files in the latest GitHub release. Without JavaScript,
// or if the GitHub API is unreachable, every button keeps its link to the latest release page.
const REPO = 'vedssharma/prime-desktop';

// Installer suffixes from electron-builder's artifactName (Session-Dock-${version}-${os}-${arch}.${ext}).
export const ASSET_SUFFIXES = {
  'mac-dmg': '-mac-arm64.dmg',
  'mac-zip': '-mac-arm64.zip',
  deb: '-linux-amd64.deb',
  appimage: '-linux-x86_64.AppImage',
};

export function pickAssets(release) {
  const links = {};
  for (const asset of release?.assets ?? []) {
    if (asset.name === 'SHA256SUMS') links.sums = asset.browser_download_url;
    for (const [key, suffix] of Object.entries(ASSET_SUFFIXES)) {
      if (asset.name.startsWith('Session-Dock-') && asset.name.endsWith(suffix)) links[key] = asset.browser_download_url;
    }
  }
  return links;
}

export function detectPlatform(userAgent) {
  if (/Mac OS X|Macintosh/.test(userAgent) && !/iPhone|iPad/.test(userAgent)) return 'mac';
  if (/Linux|X11/.test(userAgent) && !/Android/.test(userAgent)) return 'linux';
  return null;
}

function formatSize(bytes) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

async function init() {
  const platform = detectPlatform(navigator.userAgent);
  if (platform) document.querySelector(`[data-platform="${platform}"]`)?.classList.add('is-current');

  let release;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return;
    release = await response.json();
  } catch {
    return;
  }
  const links = pickAssets(release);
  const sizes = Object.fromEntries((release.assets ?? []).map((asset) => [asset.browser_download_url, asset.size]));
  for (const element of document.querySelectorAll('[data-asset]')) {
    const url = links[element.dataset.asset];
    if (!url) continue;
    element.href = url;
    const size = element.querySelector('[data-size]');
    if (size && sizes[url]) size.textContent = formatSize(sizes[url]);
  }
  const version = document.querySelector('[data-version]');
  if (version && release.tag_name) {
    version.textContent = release.tag_name;
    version.href = release.html_url;
  }
}

if (typeof document !== 'undefined') init();
