export type Theme = "light" | "dark";

/**
 * The admin's palette is the site's: CSS variables from globals.css, so it follows the
 * Light | Dark switch like every other page. Only the warning red differs by theme.
 */
export function colors(theme: Theme) {
  return {
    bg: "var(--bg)",
    surface: "var(--bg)",
    border: "var(--rule)",
    text: "var(--ink)",
    muted: "var(--muted)",
    input: "transparent",
    inputBorder: "var(--ink)",
    dropBg: "var(--map)",
    dropBgActive: "var(--faint)",
    btn: "var(--ink)",
    btnText: "var(--bg)",
    cardBg: "var(--map)",
    captionText: "var(--muted)",
    progressBg: "var(--rule)",
    progressFill: "var(--ink)",
    tabActive: "var(--ink)",
    tabBorder: "var(--ink)",
    overlay: "rgba(0, 0, 0, 0.6)",
    modalBg: "var(--bg)",
    danger: theme === "dark" ? "#ff7b72" : "#b42318",
    kbdBg: "var(--map)",
    kbdBorder: "var(--rule)",
    kbdText: "var(--ink)",
    chipBg: "var(--map)",
    chipText: "var(--muted)",
    mapBg: "var(--map)",
  };
}

export type AdminColors = ReturnType<typeof colors>;

/** Pin colour: readable on both the light and dark Mapbox styles. */
export const PIN_COLOR = "#e5484d";
