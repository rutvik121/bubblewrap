// One tick per pop. Browsers give a web page two ways to reach the motor:
//
//   vibrate  Android (Chrome, Samsung Internet, Edge, Opera…) has the
//            Vibration API, with a duration we control.
//   ios      iPhone and iPad have no Vibration API in any browser. Since
//            iOS 17.4, toggling a native switch control fires the system
//            haptic, so we toggle a hidden one. Fixed strength.
//   none     Desktops, older iPhones, and browsers that removed the API.
//            Nothing a page can do there; calls quietly do nothing.
//   native   The same code packaged as an installed app (Capacitor) gets the
//            phone's real haptic engine on both iOS and Android. This is the
//            only route that covers every phone.
//
// None of these involve a permission prompt: Android doesn't ask for one and
// iOS has none to give. Where it works, it works on the first touch.

const nativeHaptics = () => {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins ? cap.Plugins.Haptics : null;
};

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const hapticSupport = nativeHaptics()
  ? 'native'
  : typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    ? 'vibrate'
    : isIOS
      ? 'ios'
      : 'none';

// Durations long enough for weak motors to register at all.
const MS = { light: [14, 26], strong: [28, 48] };

function iosTick() {
  const label = document.createElement('label');
  label.ariaHidden = 'true';
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
}

/** The pop. level: off | light | strong; big marks one of the larger pops. */
export function haptic(big = false, level = 'light') {
  if (level === 'off' || hapticSupport === 'none') return;
  try {
    if (hapticSupport === 'native') {
      const style = level === 'strong' ? (big ? 'HEAVY' : 'MEDIUM') : big ? 'MEDIUM' : 'LIGHT';
      nativeHaptics().impact({ style });
    } else if (hapticSupport === 'vibrate') {
      navigator.vibrate(MS[level][big ? 1 : 0]);
    } else {
      iosTick();
    }
  } catch {
    // Blocked by the browser or the system: the pop still looks and sounds right.
  }
}

/**
 * The press. iOS is strict about haptics happening inside the touch itself,
 * and the pop lands a beat later, so there we also tick the moment the finger
 * goes down. Android doesn't need it.
 */
export function hapticPress(level = 'light') {
  if (level === 'off' || hapticSupport !== 'ios') return;
  try {
    iosTick();
  } catch {}
}
