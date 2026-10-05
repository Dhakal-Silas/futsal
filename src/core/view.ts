/** Logical canvas size. Height is fixed at 720; width follows the window aspect so the game fills the screen. */
export const VIEW = { w: 1280, h: 720, minW: 960, maxW: 1920 };

export function updateViewSize(innerW: number, innerH: number) {
  const aspect = innerW / Math.max(1, innerH);
  VIEW.w = Math.round(Math.min(VIEW.maxW, Math.max(VIEW.minW, VIEW.h * aspect)));
}

export function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } catch { /* ignore */ }
}
