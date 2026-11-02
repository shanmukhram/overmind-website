// When signed builds ship. Edit this one line; the page fills every
// [data-signed-builds] spot from it. Keep the static copies in index.html
// (search for data-signed-builds) the same, for visitors without JavaScript.
const SIGNED_BUILDS = "Signed builds ship soon.";

(function () {
  "use strict";

  const COPIED_MS = 1600;

  function fillSignedBuilds(root) {
    root.querySelectorAll("[data-signed-builds]").forEach(function (el) {
      el.textContent = SIGNED_BUILDS;
    });
  }

  fillSignedBuilds(document);

  // SmartScreen notice: shown under the clicked download button. The click
  // is not blocked; the download starts as normal.
  const template = document.getElementById("download-notice");

  function clearNotices() {
    document.querySelectorAll(".notice-region").forEach(function (region) {
      region.replaceChildren();
    });
  }

  function showNotice(button) {
    const region = button.parentElement.querySelector(".notice-region");
    if (!region || !template) return;
    clearNotices();
    const notice = template.content.firstElementChild.cloneNode(true);
    fillSignedBuilds(notice);
    notice.querySelector(".notice-close").addEventListener("click", function () {
      region.replaceChildren();
      button.focus();
    });
    region.appendChild(notice);
  }

  document.querySelectorAll("[data-download]").forEach(function (button) {
    button.addEventListener("click", function () {
      showNotice(button);
    });
  });

  // While the intro builds the page (assets/intro.js), the load-time and
  // scroll-in motion below stays off: the intro shows every part arriving.
  const introOn = document.documentElement.classList.contains("intro-on");

  // Hero demo: the visitor approves or rejects the agent's example change.
  const demo = document.querySelector("[data-demo]");
  if (demo) {
    const card = demo.querySelector(".approval");
    const title = demo.querySelector("[data-demo-title]");
    const body = demo.querySelector("[data-demo-body]");
    const again = demo.querySelector('[data-demo-action="reset"]');
    const demoStatus = demo.querySelector("[data-demo-status]");
    const start = { title: title.textContent, body: body.textContent };
    // Play the chat in once, starting from a frame the browser really draws.
    // A hidden tab or a screenshot tool draws none, so it gets the finished
    // chat, never an empty window.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!calm && demo.animate && !introOn) {
      requestAnimationFrame(function () {
        if (document.visibilityState !== "visible") return;
        demo.querySelectorAll(".msg").forEach(function (msg, i) {
          msg.animate(
            [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }],
            { duration: 420, delay: 150 + i * 450, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "backwards" }
          );
        });
      });
    }

    const states = {
      approve: { state: "approved", title: "Approved", body: "Done: 37 files moved into 12 month folders." },
      reject: { state: "rejected", title: "Rejected", body: "Nothing changed in your files." }
    };

    demo.querySelectorAll("[data-demo-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        const action = button.getAttribute("data-demo-action");
        if (action === "reset") {
          card.setAttribute("data-state", "waiting");
          title.textContent = start.title;
          body.textContent = start.body;
          again.hidden = true;
          demoStatus.textContent = "Waiting for your approval again.";
          demo.querySelector('[data-demo-action="approve"]').focus();
          return;
        }
        const next = states[action];
        card.setAttribute("data-state", next.state);
        title.textContent = next.title;
        body.textContent = next.body;
        again.hidden = false;
        demoStatus.textContent = next.title + ". " + next.body;
        again.focus();
      });
    });
  }

  // Edit-mode picker: the table updates in CSS; tell screen readers what
  // changed, since a style change is not announced.
  const modeStatus = document.querySelector("[data-mode-status]");
  document.querySelectorAll('input[name="edit-mode"]').forEach(function (input) {
    input.addEventListener("change", function () {
      if (!modeStatus) return;
      const parts = [];
      document.querySelectorAll(".mode-table tbody tr").forEach(function (row) {
        const outcome = row.querySelector('[data-in~="' + input.value + '"]');
        if (outcome) parts.push(row.cells[0].textContent.trim() + ": " + outcome.textContent.trim());
      });
      const name = input.parentElement.querySelector(".mode-name").textContent;
      modeStatus.textContent = name + ". " + parts.join(". ") + ".";
    });
  });

  // Scroll-in motion for the results and the changelog.
  // Everything is drawn in full by default. Only parts still below the
  // screen, once the browser is really drawing frames, are set back to their
  // start and played as they scroll into view. Reduced motion skips it all.
  const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

  function onFirstSight(targets, play) {
    if (introOn || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window) || !document.body.animate) return;
    requestAnimationFrame(function () {
      const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          entry.target.classList.remove("is-pending");
          play(entry.target);
        });
      }, { rootMargin: "0px 0px -15% 0px" });
      targets.forEach(function (target) {
        if (target.getBoundingClientRect().top < window.innerHeight) return;
        target.classList.add("is-pending");
        io.observe(target);
      });
    });
  }

  // Results: each number fades in and counts up from zero, once.
  onFirstSight(document.querySelectorAll("[data-figure]"), function (figure) {
    const num = figure.querySelector(".figure-num");
    const counter = figure.querySelector("[data-count]");
    const target = Number(counter.getAttribute("data-count"));
    num.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
      { duration: 600, easing: EASE });
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / 1300, 1);
      counter.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  // Changelog: each release's Orbit closes and its notes rise in.
  onFirstSight(document.querySelectorAll(".timeline > .release"), function (release) {
    const ring = release.querySelector(".release-orbit .release-ring");
    if (ring) {
      ring.animate([{ strokeDasharray: "0 176" }, { strokeDasharray: "140 36" }],
        { duration: 900, easing: EASE, fill: "backwards" });
    }
    Array.prototype.forEach.call(release.children, function (child, i) {
      child.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }],
        { duration: 520, delay: 80 + i * 70, easing: EASE, fill: "backwards" });
    });
  });

  // Copy buttons for the SHA-256 and the verify command.
  const status = document.querySelector("[data-copy-status]");

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "absolute";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) resolve(); else reject(new Error("copy failed"));
    });
  }

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    const source = document.getElementById(button.getAttribute("data-copy"));
    if (!source) return;
    button.hidden = false;
    let timer = 0;
    button.addEventListener("click", function () {
      copyText(source.textContent.trim()).then(function () {
        button.textContent = "Copied";
        button.classList.add("is-copied");
        if (status) status.textContent = button.getAttribute("data-copied-message") || "Copied";
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.textContent = "Copy";
          button.classList.remove("is-copied");
          if (status) status.textContent = "";
        }, COPIED_MS);
      }, function () {
        // Copy is not allowed here; select the text so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(source);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
    });
  });
})();
