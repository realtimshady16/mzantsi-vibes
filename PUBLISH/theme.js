/* Light / night theme.
 *
 * Load this in <head>, before the page paints, so the right theme is on the page
 * from the first frame (no flash of the wrong one). The choice is the visitor's
 * saved one if they have made one, otherwise their device's setting.
 *
 * Any button with class "theme-toggle" flips it. Storage can be blocked (private
 * windows), so every read and write is guarded, and the page works without it.
 */
(function () {
  'use strict';

  var KEY = 'mv-theme';
  var CHROME = { light: '#faf5ea', dark: '#051c1e' }; // matches --page, for the phone's address bar

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function save(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) { /* not fatal */ }
  }

  function deviceTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || saved() || deviceTheme();
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', CHROME[theme]);
    var buttons = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < buttons.length; i++) {
      // The label names what pressing it does.
      buttons[i].textContent = theme === 'dark' ? 'Light mode' : 'Night mode';
      buttons[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  // Before first paint.
  document.documentElement.setAttribute('data-theme', saved() || deviceTheme());

  document.addEventListener('DOMContentLoaded', function () {
    apply(current());

    var buttons = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var next = current() === 'dark' ? 'light' : 'dark';
        save(next);
        apply(next);
      });
    }
  });

  // If they have never chosen, follow the device when it changes (e.g. at sunset).
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if (!saved()) apply(deviceTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();
