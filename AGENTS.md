<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Motion rules

Follow these for any animation you add or change. The design system's Motion section
carries the same list alongside the app's existing durations.

- **Entrances**: start from `scale: 0.97` with `opacity: 0`, never from scale 0.
- **Buttons**: scale to 0.97 while pressed — `button:active { scale: 0.97 }` with
  `transition: scale 150ms ease-out`.
- **Wrong passwords**: shake the field (`translateX` 0, -10, 10, -6, 6, -3, 0px over 360ms)
  as well as turning it red.
- **Steppers**: slide the next step in from the direction you're going instead of
  crossfading.
- **Accordions**: `:root { interpolate-size: allow-keywords }`, so `height: auto` animates
  smoothly.
- **Moving things**: animate `transform`, never `top` or `left`, so the browser doesn't
  repaint every frame.
- **Theme switches**: turn transitions off while the theme changes, with
  `.theme-switching * { transition: none !important }`.
- **Tooltips**: delay only the first one; once one is open, show the rest instantly.
- **Flicks and drags**: on release, hand off to a spring that keeps the release velocity,
  like `animate(y, 0, { type: "spring", duration: 0.5, bounce: 0, velocity })`, instead of a
  fixed-duration transition.
- **Carousels**: past either end, add resistance that grows the further you pull, then
  spring back.
