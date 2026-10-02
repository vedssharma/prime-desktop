export const isElectron = navigator.userAgent.includes('Electron');
export const newSessionShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ N' : 'Ctrl N';
export const paletteShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';
