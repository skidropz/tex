/* 2.1.30: mobile UI viewport, not a scroll/touchmove interceptor. */
(() => {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 900);
  if (!mobile) return;
  document.documentElement.classList.add('mobile-ui');
  document.documentElement.style.touchAction = 'pan-x pan-y';
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';
  // Safari may ignore viewport zoom restrictions. Only intercept its multi-finger gesture events.
  // Never install a non-passive touchmove handler: single-finger scrolling stays native.
  function preventPagePinch(e) { if (e.cancelable) e.preventDefault(); }
  document.addEventListener('gesturestart', preventPagePinch, { passive: false });
  document.addEventListener('gesturechange', preventPagePinch, { passive: false });
})();
