/**
 * A light haptic tap, where the browser allows one.
 *
 * - Android (and anything else with the Vibration API): a short vibration.
 * - iPhone: Safari has no Vibration API, but since iOS 18 toggling a native switch
 *   (<input type="checkbox" switch>) plays the system's haptic. A hidden one is made,
 *   flipped and removed, the same way the ios-haptics library does it. Safari only plays
 *   it inside the handler of the user's own touch, so `tapOnRelease` waits for the
 *   finger's touchend rather than playing from the pointer events that come before it.
 * - Mac: no browser exposes the trackpad's haptics to web pages, so nothing happens.
 *
 * Never throws; anything unsupported simply does nothing.
 */

/** Whether the browser can vibrate on its own, mid-gesture (Android, not iPhone). */
export function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function isIOS() {
  return (
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
  );
}

function iosTap() {
  const focused = document.activeElement as HTMLElement | null;
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  label.remove();
  // The switch is gone, but don't leave focus stranded where it was.
  if (focused && focused !== document.activeElement && focused !== document.body) {
    focused.focus({ preventScroll: true });
  }
}

export function haptic(ms = 10) {
  try {
    if (canVibrate()) navigator.vibrate(ms);
    else if (isIOS()) iosTap();
  } catch {
    // No haptics here.
  }
}

/**
 * A tap as the finger lifts. Swipes decide in their pointerup handler, which on iPhone
 * comes just before the touchend Safari will play a haptic from; so the tap is armed
 * here and played from that touchend (or straight away where the device can vibrate).
 */
let armed = false;
let listening = false;

function onTouchEnd() {
  if (!armed) return;
  armed = false;
  haptic();
}

export function tapOnRelease() {
  if (typeof document === "undefined") return;
  if (canVibrate()) {
    haptic();
    return;
  }
  if (!isIOS()) return;
  if (!listening) {
    listening = true;
    // Capture, so it runs even where something else handles the touch.
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
  }
  armed = true;
  // A release that doesn't end in a touchend (a trackpad on an iPad, say) shouldn't
  // leave a tap waiting for some unrelated touch later.
  setTimeout(() => {
    armed = false;
  }, 400);
}
