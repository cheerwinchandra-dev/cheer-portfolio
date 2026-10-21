// Runs before the page paints: enables the intro animation only when
// JavaScript works, and never leaves content hidden for long.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.classList.add('reduced');
    }
  } catch (e) {
    /* ignore */
  }
  // Safety net: show everything even if site.js fails to load.
  window.setTimeout(function () {
    root.classList.add('is-ready');
  }, 2600);
  window.setTimeout(function () {
    if (!root.classList.contains('site-running')) {
      var hidden = document.querySelectorAll('[data-reveal]');
      for (var i = 0; i < hidden.length; i++) hidden[i].classList.add('is-in');
    }
  }, 3200);
})();
