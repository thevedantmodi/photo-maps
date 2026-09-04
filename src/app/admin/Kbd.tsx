"use client";

import { useSyncExternalStore } from "react";
import { colors, type Theme } from "./theme";

const noopSubscribe = () => () => {};
const readModKey = () =>
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘" : "Ctrl";
const serverModKey = () => "Ctrl";

/**
 * The platform modifier label. Renders as "Ctrl" on the server so hydration
 * matches, then resolves to ⌘ on Apple platforms.
 */
export function useModKey(): string {
  return useSyncExternalStore(noopSubscribe, readModKey, serverModKey);
}

export function Kbd({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  const c = colors(theme);
  return (
    <kbd
      style={{
        display: "inline-block",
        padding: "1px 5px",
        margin: "0 1px",
        background: c.kbdBg,
        border: `1px solid ${c.kbdBorder}`,
        borderBottomWidth: 2,
        borderRadius: 4,
        color: c.kbdText,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}

/** A muted line of helper text, used to advertise keyboard shortcuts. */
export function Hint({
  theme,
  children,
  style,
}: {
  theme: Theme;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const c = colors(theme);
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12,
        lineHeight: 1.6,
        color: c.muted,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
