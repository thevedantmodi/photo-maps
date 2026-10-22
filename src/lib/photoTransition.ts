/**
 * Where a photo's thumbnail sat on screen when it was clicked, so the photo page can grow
 * the photo out of that exact spot and, on close, shrink it back in. Module state in the
 * browser: it only needs to live from the click on the map to the photo page closing.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let last: { slug: string; rect: Rect; at: number; el: Element } | null = null;

/** How long after the click the growing animation still makes sense. */
const FRESH_MS = 4000;

export function rememberOpen(slug: string, el: Element) {
  const r = el.getBoundingClientRect();
  last = { slug, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, at: Date.now(), el };
}

/** The thumbnail's rect for growing the photo, if this photo was just clicked. */
export function openOrigin(slug: string): Rect | null {
  if (!last || last.slug !== slug || Date.now() - last.at > FRESH_MS) return null;
  return last.rect;
}

/** The rect to shrink back into on close. The map hasn't moved underneath, so no age limit. */
export function closeTarget(slug: string): Rect | null {
  return last && last.slug === slug ? last.rect : null;
}

/**
 * Hands keyboard focus back to the thumbnail the photo was opened from, once the photo has
 * closed, so the next Tab carries on from there. Skipped if that thumbnail has since left
 * the page (a folded wheel, a filtered year).
 */
export function returnFocus(slug: string) {
  const el = last && last.slug === slug ? last.el : null;
  if (!(el instanceof HTMLElement)) return;
  // The map stays inert until the photo has fully gone, so wait for it (about half a
  // second at most) rather than focusing too early and having it ignored.
  let tries = 30;
  const attempt = () => {
    if (!el.isConnected) return;
    if (el.closest('[inert]')) {
      if (--tries > 0) requestAnimationFrame(attempt);
      return;
    }
    el.focus({ preventScroll: true });
  };
  requestAnimationFrame(attempt);
}

export function forget(slug: string) {
  if (last?.slug === slug) last = null;
}

/**
 * Which way the last Previous/Next went, so the photo arriving can slide in from that
 * side. Only fresh for a moment, so a later, unrelated visit just appears.
 */
export interface Step {
  dir: 1 | -1;
  /** Clicked Previous/Next, so focus goes back to that button on the new photo. */
  button: boolean;
  /**
   * The new photo's proportions, when it slid into place before the page changed: it is
   * then drawn straight away, exactly where it landed, with no entrance.
   */
  ratio: number | null;
  /** The words on the photo being left, so the new ones can grow out of them. */
  words: StepWords | null;
}

export interface StepWords {
  title: string;
  /** The old title's size and height, so its ghost matches and the block eases between them. */
  titleFont: string;
  titleLineHeight: string;
  titleHeight: number;
  kicker: string;
  facts: Record<string, string>;
  /** Already morphed in place before the page changed: the new page just shows them. */
  settled?: boolean;
}

let step: (Step & { at: number }) | null = null;

export function rememberStep(dir: 1 | -1, button: boolean, ratio: number | null, words: StepWords | null) {
  step = { dir, button, ratio, words, at: Date.now() };
}

export function takeStep(): Step | null {
  const s = step;
  step = null;
  return s && Date.now() - s.at < 4000 ? { dir: s.dir, button: s.button, ratio: s.ratio, words: s.words } : null;
}
