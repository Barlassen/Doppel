"use strict";
// The settings form. It never receives a saved key: only whether one exists.
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("form");
  let view = null;
  let clearKey = false;

  const mode = () => new FormData(form).get("mode") || "offline";

  function showStatus() {
    const status = view.status;
    const on = Boolean(status && status.configured);
    $("dot").classList.toggle("on", on);
    if (!view.running) $("status").textContent = "The built-in server is not running.";
    else if (on) $("status").textContent = `Assistant configured: ${status.textModel} at ${status.provider}. The first question tests the key.`;
    else {
      const why = { NO_KEY: "no key", BAD_BASE_URL: "the endpoint URL is not valid", NO_TEXT_MODEL: "the endpoint needs a text model name" }[status && status.reason];
      $("status").textContent = `Not connected${why ? ` (${why})` : ""}. Doppel works offline.`;
    }
  }

  function layout() {
    const current = mode();
    const custom = current === "custom";
    const saved = custom ? view.hasCustomKey : view.hasOpenRouterKey;
    $("base-url-field").hidden = !custom;
    $("key-field").hidden = current === "offline";
    $("models").hidden = current === "offline";
    $("limits").hidden = current === "offline";
    $("key-label").textContent = custom ? "API key (leave empty for a local server)" : "OpenRouter API key";
    $("api-key").placeholder = saved && !clearKey ? "A key is saved. Leave empty to keep it." : custom ? "" : "sk-or-…";
    $("key-hint").textContent = "";
    if (custom && saved && !clearKey) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link";
      remove.textContent = "Remove the saved key";
      remove.addEventListener("click", () => {
        clearKey = true;
        layout();
      });
      $("key-hint").append(remove);
    } else if (custom && clearKey) {
      $("key-hint").textContent = "The saved key is removed when you save.";
    }
    $("text-model").placeholder = custom ? "llama3.2" : "default";
    $("vision-model").placeholder = custom ? "llama3.2-vision" : "default";
  }

  function fill() {
    form.elements.mode.value = view.mode;
    $("base-url").value = view.baseUrl;
    $("text-model").value = view.textModel;
    $("vision-model").value = view.visionModel;
    $("budget-usd").value = view.budgetUsd;
    $("budget-tokens").value = view.budgetTokens;
    $("api-key").value = "";
    $("limits").open = Boolean(view.budgetUsd || view.budgetTokens);
    clearKey = false;
    showStatus();
    layout();
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "mode") layout();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("error");
    error.hidden = true;
    if (mode() === "openrouter" && !view.hasOpenRouterKey && !$("api-key").value.trim()) {
      error.textContent = "Enter your OpenRouter key, or choose Offline.";
      error.hidden = false;
      return;
    }
    $("save").disabled = true;
    $("save").textContent = "Restarting…";
    try {
      view = await window.doppelShell.saveSettings({
        mode: mode(),
        apiKey: $("api-key").value,
        clearKey,
        baseUrl: $("base-url").value,
        textModel: $("text-model").value,
        visionModel: $("vision-model").value,
        budgetUsd: $("budget-usd").value,
        budgetTokens: $("budget-tokens").value,
      });
      fill();
    } catch (failure) {
      error.textContent = String(failure.message || failure).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
      error.hidden = false;
    } finally {
      $("save").disabled = false;
      $("save").textContent = "Save and restart";
    }
  });
  $("cancel").addEventListener("click", () => window.doppelShell.action("closeSettings"));
  $("show-env").addEventListener("click", () => window.doppelShell.action("showEnv"));

  window.doppelShell.loadSettings().then((loaded) => {
    view = loaded;
    fill();
  });
})();
