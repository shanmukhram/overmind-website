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
