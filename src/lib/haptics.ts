/**
 * A light haptic tap, where the browser allows one.
 *
 * - Android (and anything else with the Vibration API): a short vibration.
 * - iPhone: Safari has no Vibration API, but since iOS 18 toggling a native switch
 *   (<input type="checkbox" switch>) plays the system's haptic. A hidden one is flipped
 *   here. It only fires in response to the user (a tap or a finger lifting), not mid-drag.
 * - Mac: no browser exposes the trackpad's haptics to web pages, so nothing happens.
 *
 * Never throws; anything unsupported simply does nothing.
 */

let label: HTMLLabelElement | null = null;

function iosSwitch(): HTMLLabelElement | null {
  if (label?.isConnected) return label;
  if (typeof document === "undefined") return null;
  label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

/** Whether the browser can vibrate on its own, mid-gesture (Android, not iPhone). */
export function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function haptic(ms = 10) {
  try {
    if (canVibrate()) {
      navigator.vibrate(ms);
      return;
    }
    const isIOS =
      typeof navigator !== "undefined" &&
      (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    if (!isIOS) return;
    const el = iosSwitch();
    if (!el) return;
    // Flipping the switch mustn't take focus from wherever it is.
    const focused = document.activeElement as HTMLElement | null;
    el.click();
    if (el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
      if (focused && focused !== document.body) focused.focus({ preventScroll: true });
    }
  } catch {
    // No haptics here.
  }
}
