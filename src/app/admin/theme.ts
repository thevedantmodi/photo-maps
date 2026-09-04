export type Theme = "light" | "dark";

export function colors(theme: Theme) {
  return theme === "dark"
    ? {
        bg: "#0a0a0a",
        surface: "#1a1a1a",
        border: "#333",
        text: "#f0f0f0",
        muted: "#888",
        input: "#111",
        inputBorder: "#444",
        dropBg: "#111",
        dropBgActive: "#0d2d1a",
        btn: "#fff",
        btnText: "#000",
        cardBg: "#1e1e1e",
        captionText: "#aaa",
        progressBg: "#333",
        progressFill: "#fff",
        tabActive: "#fff",
        tabBorder: "#444",
        overlay: "rgba(0,0,0,0.75)",
        modalBg: "#1a1a1a",
        danger: "#e55",
        kbdBg: "#222",
        kbdBorder: "#3d3d3d",
        kbdText: "#ccc",
        chipBg: "#222",
        chipText: "#9aa",
        mapBg: "#111",
      }
    : {
        bg: "#fff",
        surface: "#fff",
        border: "#eee",
        text: "#111",
        muted: "#999",
        input: "#fff",
        inputBorder: "#ddd",
        dropBg: "#fafafa",
        dropBgActive: "#f0fff4",
        btn: "#000",
        btnText: "#fff",
        cardBg: "#f5f5f5",
        captionText: "#666",
        progressBg: "#eee",
        progressFill: "#000",
        tabActive: "#000",
        tabBorder: "#eee",
        overlay: "rgba(0,0,0,0.5)",
        modalBg: "#fff",
        danger: "#c00",
        kbdBg: "#f4f4f4",
        kbdBorder: "#dcdcdc",
        kbdText: "#444",
        chipBg: "#f0f0f0",
        chipText: "#666",
        mapBg: "#eee",
      };
}

export type AdminColors = ReturnType<typeof colors>;

/** Pin colour: readable on both the light and dark Mapbox styles. */
export const PIN_COLOR = "#e5484d";
