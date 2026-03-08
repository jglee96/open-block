import type { SavedState } from "../worker/protocol";

export function saveState(saveKey: string, state: SavedState) {
  try {
    localStorage.setItem(saveKey, JSON.stringify(state));
  } catch (err) {
    console.warn("Failed to save state:", err);
  }
}

export function loadState(saveKey: string): SavedState | null {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedState;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch (err) {
    console.warn("Failed to load state:", err);
    return null;
  }
}
