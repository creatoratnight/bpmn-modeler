// Shared behaviour for the docs HTML companion:
// auto table-of-contents + scrollspy, copy buttons on code, and Mermaid rendering.
// The page only needs to provide content; this script wires up the rest.
(function () {
  // --- Mermaid (loaded via the CDN <script> before this file) ---
  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        primaryColor: "#e6f0fa",
        primaryBorderColor: "#0a4d8f",
        primaryTextColor: "#073764",
        lineColor: "#94a3b8",
        fontFamily: "Inter, Segoe UI, sans-serif",
      },
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var main = document.querySelector("main.content");

    // --- Build the right-hand table of contents from h2/h3 ---
    var tocNav = document.querySelector(".toc nav");
    if (main && tocNav) {
      var headings = main.querySelectorAll("h2, h3");
      headings.forEach(function (h, i) {
        if (!h.id) h.id = "sec-" + i;
        var a = document.createElement("a");
        a.href = "#" + h.id;
        a.textContent = h.textContent;
        if (h.tagName === "H3") a.className = "h3";
        tocNav.appendChild(a);
      });

      // --- Scrollspy: highlight the heading in view ---
      var links = Array.prototype.slice.call(tocNav.querySelectorAll("a"));
      var spy = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              links.forEach(function (l) { l.classList.remove("active"); });
              var active = tocNav.querySelector('a[href="#' + e.target.id + '"]');
              if (active) active.classList.add("active");
            }
          });
        },
        { rootMargin: "-80px 0px -70% 0px" }
      );
      headings.forEach(function (h) { spy.observe(h); });
    }

    // --- Copy buttons on code blocks (not on mermaid diagrams) ---
    document.querySelectorAll("pre:not(.mermaid)").forEach(function (pre) {
      var btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code") || pre;
        navigator.clipboard.writeText(code.textContent.trim()).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
        });
      });
      pre.appendChild(btn);
    });

    // --- Render Mermaid diagrams ---
    if (window.mermaid) window.mermaid.run();
  });
})();
