// panelStore.js
import fs from "fs";

const FILE = "./panels.json";

export function loadPanels() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePanels(panels) {
  fs.writeFileSync(FILE, JSON.stringify(panels, null, 2), "utf8");
}

// 追加・更新・削除
export function addPanel(panel) {
  const panels = loadPanels();
  panels.push(panel);
  savePanels(panels);
  return panel;
}

export function updatePanel(id, patch) {
  const panels = loadPanels();
  const idx = panels.findIndex(p => p.id === id);
  if (idx === -1) throw new Error("panel not found");
  panels[idx] = { ...panels[idx], ...patch };
  savePanels(panels);
  return panels[idx];
}

export function removePanel(id) {
  const panels = loadPanels();
  const next = panels.filter(p => p.id !== id);
  if (next.length === panels.length) throw new Error("panel not found");
  savePanels(next);
  return true;
}
