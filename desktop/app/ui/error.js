"use strict";
(async () => {
  const info = await window.doppelShell.errorInfo();
  if (info.message) document.getElementById("message").textContent = info.message;
  document.getElementById("log-path").textContent = info.logPath || "";
  const tail = document.getElementById("tail");
  if (info.tail) {
    tail.textContent = info.tail;
    tail.hidden = false;
    tail.scrollTop = tail.scrollHeight;
  }
  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", () => window.doppelShell.action(button.dataset.action));
  }
})();
