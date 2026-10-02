export const isElectron = navigator.userAgent.includes('Electron');
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const findShortcut = mac ? '⌘ F' : 'Ctrl F';
export const newSessionShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ N' : 'Ctrl N';
export const paletteShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';
