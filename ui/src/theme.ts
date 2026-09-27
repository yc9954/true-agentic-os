// Live accent theming. Customize writes these onto :root; App applies the saved
// one on boot. Tailwind reads --accent-rgb / --accentsoft / --onaccent.
export interface Theme {
  id: string;
  name: string;
  rgb: string; // "r g b" for rgb(var(--accent-rgb) / <alpha>)
  soft: string;
  on: string;
  swatch: string;
}

export const THEMES: Theme[] = [
  { id: "teal",   name: "Teal",   rgb: "45 212 191",  soft: "#0f2e2b", on: "#04211d", swatch: "#2DD4BF" },
  { id: "violet", name: "Violet", rgb: "167 139 250", soft: "#241b40", on: "#160b2e", swatch: "#A78BFA" },
  { id: "amber",  name: "Amber",  rgb: "245 158 11",  soft: "#3a2a08", on: "#1c1404", swatch: "#F59E0B" },
  { id: "blue",   name: "Blue",   rgb: "96 165 250",  soft: "#142a45", on: "#08182e", swatch: "#60A5FA" },
];

export function applyTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const r = document.documentElement.style;
  r.setProperty("--accent-rgb", t.rgb);
  r.setProperty("--accentsoft", t.soft);
  r.setProperty("--onaccent", t.on);
}
export function storedTheme(): string {
  return localStorage.getItem("tao.theme") || "teal";
}
export function storeTheme(id: string): void {
  localStorage.setItem("tao.theme", id);
  applyTheme(id);
}

export function storedTarget(): string {
  return localStorage.getItem("tao.target") || "auto";
}
export function storeTarget(t: string): void {
  localStorage.setItem("tao.target", t);
}
