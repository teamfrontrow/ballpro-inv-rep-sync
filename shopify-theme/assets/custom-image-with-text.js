(function () {
  if (window.__customImageWithTextAnimate) return;
  window.__customImageWithTextAnimate = true;

  var SELECTOR = '.custom-image-with-text__animate';
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -25% 0px', threshold: 0 });

  function observe(root) {
    var els = (root || document).querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.classList.contains('is-visible')) continue;
      if (prefersReducedMotion) {
        el.classList.add('is-visible');
        continue;
      }
      observer.observe(el);
    }
  }

  function init() {
    observe(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', function (evt) {
    observe(evt.target);
  });
})();
