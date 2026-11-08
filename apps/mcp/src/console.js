(() => {
  const root = document.documentElement;
  root.dataset.js = "true";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const toast = document.querySelector(".toast");
  let toastTimer;
  function announce(message) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4500);
  }
  const readPreference = (key, fallback) => {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };
  const savePreference = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  let theme = readPreference("sample-theme", "system");
  let timeZone = readPreference("sample-time", "local");
  if (!["system", "light", "dark"].includes(theme)) theme = "system";
  if (!["local", "utc"].includes(timeZone)) timeZone = "local";
  function applyTheme() {
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-label]").forEach((el) => {
      el.textContent = theme[0].toUpperCase() + theme.slice(1);
    });
    document
      .querySelector("[data-theme-toggle]")
      ?.setAttribute("aria-label", `Color theme: ${theme}. Change theme`);
    document.querySelectorAll("[data-theme-select]").forEach((el) => {
      el.value = theme;
    });
  }
  applyTheme();
  document
    .querySelector("[data-theme-toggle]")
    ?.addEventListener("click", () => {
      theme =
        theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
      savePreference("sample-theme", theme);
      applyTheme();
      announce(`Theme changed to ${theme}.`);
    });
  document
    .querySelector("[data-theme-select]")
    ?.addEventListener("change", (event) => {
      theme = event.target.value;
      savePreference("sample-theme", theme);
      applyTheme();
      announce(`Theme changed to ${theme}.`);
    });
  function localTimes(scope = document) {
    scope
      .querySelectorAll("[data-local-time], [data-session-time]")
      .forEach((el) => {
        const date = new Date(el.getAttribute("datetime"));
        if (!Number.isFinite(date.getTime())) return;
        const compact = el.hasAttribute("data-compact");
        el.textContent = new Intl.DateTimeFormat(undefined, {
          ...(compact
            ? {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short",
              }
            : {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZoneName: "short",
              }),
          ...(el.hasAttribute("data-clock-only")
            ? { year: undefined, month: undefined, day: undefined }
            : {}),
          ...(el.hasAttribute("data-seconds") ? { second: "2-digit" } : {}),
          ...(timeZone === "utc"
            ? { timeZone: "UTC", timeZoneName: "short" }
            : {}),
        }).format(date);
      });
  }
  localTimes();
  document.querySelectorAll("[data-time-select]").forEach((el) => {
    el.value = timeZone;
    el.addEventListener("change", () => {
      timeZone = el.value;
      savePreference("sample-time", timeZone);
      localTimes();
      announce(
        `Times now use ${timeZone === "utc" ? "UTC" : "your local time zone"}.`,
      );
    });
  });
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navigation = document.querySelector("#navigation");
  const shade = document.querySelector("[data-nav-close]");
  function closeNavigation() {
    delete root.dataset.navOpen;
    navToggle?.setAttribute("aria-expanded", "false");
    navToggle?.setAttribute("aria-label", "Open navigation");
    if (shade) shade.hidden = true;
  }
  navToggle?.addEventListener("click", () => {
    if (root.dataset.navOpen) {
      closeNavigation();
      return;
    }
    delete root.dataset.searchOpen;
    searchToggle?.setAttribute("aria-expanded", "false");
    closeSearch();
    root.dataset.navOpen = "true";
    navToggle.setAttribute("aria-expanded", "true");
    navToggle.setAttribute("aria-label", "Close navigation");
    if (shade) shade.hidden = false;
    navigation?.querySelector("a")?.focus();
  });
  shade?.addEventListener("click", closeNavigation);
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (button) {
      try {
        if (button.dataset.copied) return;
        await navigator.clipboard.writeText(button.dataset.copy);
        const original = button.innerHTML,
          label = button.getAttribute("aria-label");
        button.innerHTML =
          '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
        button.setAttribute("aria-label", "Copied to clipboard");
        button.dataset.copied = "true";
        announce("Copied to clipboard.");
        setTimeout(() => {
          delete button.dataset.copied;
          button.innerHTML = original;
          button.setAttribute("aria-label", label);
        }, 1800);
      } catch {
        announce("Copy unavailable. Select and copy the text directly.");
      }
      return;
    }
    const row = event.target.closest("[data-row-href]");
    if (row && !event.target.closest("a,button,input,select,summary"))
      location.href = row.dataset.rowHref;
    const eventRow = event.target.closest("tr[data-event]");
    if (
      eventRow &&
      !event.target.closest("a,button,input,select,summary,details")
    )
      eventRow.querySelector("summary")?.click();
  });
  const dialog = document.querySelector(".event-dialog");
  let activeEvent = null;
  function closeEvent() {
    if (dialog?.open) dialog.close();
  }
  function openEvent(details) {
    if (!dialog) return;
    const panel = details.querySelector(".event-panel");
    if (!panel) return;
    activeEvent = details;
    details.open = false;
    dialog.replaceChildren(panel);
    dialog.showModal();
    const url = new URL(location.href);
    url.searchParams.set("event", details.dataset.eventId);
    history.replaceState(null, "", url);
    dialog.querySelector("[data-panel-close]")?.focus();
  }
  document.querySelectorAll(".event-detail").forEach((details) => {
    details.querySelector("summary").addEventListener("click", (event) => {
      event.preventDefault();
      openEvent(details);
    });
    if (details.open) openEvent(details);
  });
  dialog?.addEventListener("close", () => {
    if (activeEvent) {
      const panel = dialog.querySelector(".event-panel");
      if (panel) activeEvent.append(panel);
      activeEvent.querySelector("summary")?.focus();
      activeEvent = null;
    }
    const url = new URL(location.href);
    url.searchParams.delete("event");
    history.replaceState(null, "", url);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-panel-close]")) closeEvent();
  });
  dialog?.addEventListener("click", (event) => {
    if (
      event.target === dialog &&
      event.clientX < dialog.getBoundingClientRect().left
    )
      closeEvent();
  });
  const caseDialog = document.createElement("dialog");
  caseDialog.className = "case-dialog";
  caseDialog.setAttribute("aria-labelledby", "case-dialog-title");
  document.body.append(caseDialog);
  let activeCase = null;
  document.querySelectorAll(".case-detail").forEach((details) => {
    details.querySelector("summary").addEventListener("click", (event) => {
      event.preventDefault();
      const panel = details.querySelector("div");
      activeCase = details;
      details.open = false;
      panel.classList.add("case-panel");
      panel.querySelector("h3").id = "case-dialog-title";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "secondary case-close";
      close.textContent = "Close case";
      close.addEventListener("click", () => caseDialog.close());
      panel.prepend(close);
      caseDialog.replaceChildren(panel);
      caseDialog.showModal();
      close.focus();
    });
  });
  caseDialog.addEventListener("close", () => {
    if (!activeCase) return;
    const panel = caseDialog.querySelector(".case-panel");
    panel.querySelector(".case-close").remove();
    panel.querySelector("h3").removeAttribute("id");
    activeCase.append(panel);
    activeCase.querySelector("summary").focus();
    activeCase = null;
  });
  const controllers = new WeakMap();
  function setupTables(scope = document, saved) {
    scope.querySelectorAll("[data-table]").forEach((table) => {
      if (controllers.has(table)) return;
      const rows = [...table.querySelectorAll("[data-table-row]")];
      const search = table.querySelector("[data-table-search]");
      const filters = [...table.querySelectorAll("[data-field-filter]")];
      const sort = table.querySelector("[data-sort]");
      const size = table.querySelector("[data-page-size]");
      let page = saved?.page || 1,
        quick = saved?.quick || "all";
      if (search && saved?.query) search.value = saved.query;
      const params = new URLSearchParams(location.search);
      filters.forEach((field) => {
        const selected =
          saved?.filters?.[field.dataset.fieldFilter] ||
          (field.dataset.fieldFilter === "state" ? params.get("state") : null);
        if (
          selected &&
          [...field.options].some((option) => option.value === selected)
        )
          field.value = selected;
      });
      if (sort && saved?.sort) sort.value = saved.sort;
      if (size && saved?.size) size.value = saved.size;
      function update() {
        const query = search?.value.trim().toLowerCase() || "";
        const sorted = [...rows].sort((a, b) => {
          if (sort?.value === "oldest")
            return Number(a.dataset.created) - Number(b.dataset.created);
          if (sort?.value === "amount-asc")
            return Number(a.dataset.amount) - Number(b.dataset.amount);
          if (sort?.value === "amount-desc")
            return Number(b.dataset.amount) - Number(a.dataset.amount);
          return sort
            ? Number(b.dataset.created) - Number(a.dataset.created)
            : 0;
        });
        if (sort) sorted.forEach((row) => row.parentElement.append(row));
        const selected = sorted.filter((row) => {
          const state = row.dataset.state;
          const quickMatch =
            quick === "all" ||
            (quick === "HELD"
              ? state === "HELD"
              : [
                  "POSTED",
                  "DENIED",
                  "EXPIRED",
                  "TELLER_DENIED",
                  "UPSTREAM_REJECTED",
                ].includes(state));
          return (
            quickMatch &&
            filters.every(
              (field) =>
                field.value === "all" ||
                row.dataset[field.dataset.fieldFilter] === field.value,
            ) &&
            (!query ||
              (row.textContent + " " + (row.dataset.search || ""))
                .toLowerCase()
                .includes(query))
          );
        });
        const limit = Number(size?.value || 10),
          pages = Math.max(1, Math.ceil(selected.length / limit));
        page = Math.min(Math.max(1, page), pages);
        rows.forEach((row) => {
          row.hidden = true;
        });
        selected.slice((page - 1) * limit, page * limit).forEach((row) => {
          row.hidden = false;
        });
        table
          .querySelectorAll("[data-filter]")
          .forEach((button) =>
            button.setAttribute(
              "aria-pressed",
              String(button.dataset.filter === quick),
            ),
          );
        const empty = table.querySelector(".filter-empty");
        if (empty) empty.hidden = !rows.length || selected.length > 0;
        const count = table.querySelector("[data-result-count]");
        if (count)
          count.textContent = `${selected.length} of ${rows.length} records`;
        const info = table.querySelector("[data-page-info]");
        if (info)
          info.textContent = selected.length
            ? `${(page - 1) * limit + 1}–${Math.min(page * limit, selected.length)} of ${selected.length}`
            : "0 records";
        const prev = table.querySelector("[data-prev]"),
          next = table.querySelector("[data-next]");
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= pages;
      }
      table.addEventListener("input", (event) => {
        if (event.target === search) {
          page = 1;
          update();
        }
      });
      table.addEventListener("change", () => {
        page = 1;
        update();
      });
      table.addEventListener("click", (event) => {
        const quickButton = event.target.closest("[data-filter]");
        if (quickButton) {
          quick = quickButton.dataset.filter;
          filters.forEach((field) => {
            field.value = "all";
          });
          page = 1;
          update();
        }
        if (event.target.closest("[data-prev]")) {
          page--;
          update();
        }
        if (event.target.closest("[data-next]")) {
          page++;
          update();
        }
      });
      controllers.set(table, () => ({
        page,
        quick,
        query: search?.value,
        filters: Object.fromEntries(
          filters.map((field) => [field.dataset.fieldFilter, field.value]),
        ),
        sort: sort?.value,
        size: size?.value,
      }));
      update();
    });
  }
  setupTables();
  const search = document.querySelector("#global-search");
  const searchToggle = document.querySelector("[data-search-toggle]");
  function showSearch() {
    closeNavigation();
    root.dataset.searchOpen = "true";
    searchToggle?.setAttribute("aria-expanded", "true");
    search?.focus();
  }
  searchToggle?.addEventListener("click", showSearch);
  const results = document.querySelector("#search-results");
  let index = null,
    searchLoad = null;
  function applyIndex(data) {
    index = data;
    document
      .querySelector("[data-pending-link]")
      ?.setAttribute("aria-label", `${data.pending} pending approvals`);
    document.querySelectorAll("[data-pending-count]").forEach((el) => {
      el.textContent = String(data.pending);
    });
  }
  const indexTemplate = document.querySelector("[data-console-index]");
  if (indexTemplate) {
    try {
      applyIndex(JSON.parse(indexTemplate.content.textContent));
    } catch {}
  }
  async function loadIndex() {
    if (index) return true;
    if (searchLoad) return searchLoad;
    searchLoad = (async () => {
      try {
        const response = await fetch("/console/snapshot", {
          credentials: "same-origin",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Start a sample session to search."
              : "Search is unavailable. Try again.",
          );
        applyIndex(await response.json());
        return true;
      } catch (error) {
        results.replaceChildren(
          Object.assign(document.createElement("p"), {
            textContent: error.message,
          }),
        );
        return false;
      } finally {
        searchLoad = null;
      }
    })();
    return searchLoad;
  }
  function closeSearch() {
    if (results) results.hidden = true;
  }
  async function searchSession() {
    const query = search.value.trim().toLowerCase();
    if (!query) {
      closeSearch();
      return;
    }
    results.hidden = false;
    if (!index)
      results.replaceChildren(
        Object.assign(document.createElement("p"), {
          textContent: "Loading session records…",
        }),
      );
    if (!(await loadIndex())) return;
    if (search.value.trim().toLowerCase() !== query) return searchSession();
    const found = index.items.filter((item) =>
      `${item.title} ${item.detail} ${item.text}`.toLowerCase().includes(query),
    );
    results.replaceChildren();
    if (!found.length)
      results.append(
        Object.assign(document.createElement("p"), {
          textContent: "No matching records. Try a request key or event name.",
        }),
      );
    found.slice(0, 7).forEach((item) => {
      const link = document.createElement("a");
      link.href = item.url;
      link.append(
        Object.assign(document.createElement("span"), {
          className: "search-kind",
          textContent: item.kind,
        }),
        document.createTextNode(item.title),
        Object.assign(document.createElement("small"), {
          textContent: item.detail,
        }),
      );
      results.append(link);
    });
    if (found.length > 7) {
      const link = document.createElement("a");
      link.href = "/search?q=" + encodeURIComponent(search.value);
      link.textContent = `View all ${found.length} results`;
      results.append(link);
    }
  }
  search?.addEventListener("input", searchSession);
  search?.addEventListener("focus", () => {
    if (search.value) searchSession();
  });
  search?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      results?.querySelector("a")?.focus();
    }
  });
  results?.addEventListener("keydown", (event) => {
    const links = [...results.querySelectorAll("a")],
      current = links.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      links[(current + 1) % links.length]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (current <= 0) search.focus();
      else links[current - 1].focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".global-search")) closeSearch();
    document
      .querySelectorAll(".info[open],.session-menu[open]")
      .forEach((details) => {
        if (!details.contains(event.target)) details.open = false;
      });
  });
  document.addEventListener("pointerdown", () => {
    root.dataset.input = "pointer";
  });
  document.addEventListener("keydown", (event) => {
    root.dataset.input = "keyboard";
    const editing = event.target.closest(
      "input,textarea,select,[contenteditable=true]",
    );
    if (
      event.key === "/" &&
      !editing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      showSearch();
    }
    if (event.key === "Enter" && event.target.matches("tr[tabindex]")) {
      event.preventDefault();
      const row = event.target;
      if (row.dataset.rowHref) location.href = row.dataset.rowHref;
      else row.querySelector("summary")?.click();
    }
    if (event.key === "Escape") {
      const wasSearch = results && !results.hidden;
      closeSearch();
      if (wasSearch) search?.focus();
      if (root.dataset.searchOpen && matchMedia("(max-width:700px)").matches) {
        delete root.dataset.searchOpen;
        searchToggle?.setAttribute("aria-expanded", "false");
        searchToggle?.focus();
      }
      if (root.dataset.navOpen) {
        closeNavigation();
        navToggle?.focus();
      }
      if (dialog?.open) closeEvent();
      document
        .querySelectorAll(
          ".info[open],.session-menu[open],.approval-review[open],.case-detail[open]",
        )
        .forEach((details) => {
          details.open = false;
          details.querySelector("summary")?.focus();
        });
    }
    if (
      event.key === "Tab" &&
      root.dataset.navOpen &&
      matchMedia("(max-width:700px)").matches
    ) {
      const links = [navToggle, ...navigation.querySelectorAll("a")];
      if (event.shiftKey && document.activeElement === links[0]) {
        event.preventDefault();
        links.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === links.at(-1)) {
        event.preventDefault();
        navToggle.focus();
      }
    }
  });
  function enhanceApprovals(scope = document) {
    scope.querySelectorAll(".approval-review").forEach((details) =>
      details.addEventListener("toggle", () => {
        if (details.open)
          details.querySelector(".confirmation")?.scrollIntoView({
            block: "nearest",
            behavior: reduced.matches ? "instant" : "smooth",
          });
      }),
    );
  }
  enhanceApprovals();
  if (matchMedia("(max-width:700px)").matches)
    document.querySelectorAll(".arguments").forEach((details) => {
      details.open = false;
    });
  document.addEventListener("submit", (event) => {
    if (event.defaultPrevented || event.target.method.toLowerCase() !== "post")
      return;
    const form = event.target;
    form.setAttribute("aria-busy", "true");
    const request = form.closest("[data-request-id]");
    if (request) {
      try {
        sessionStorage.setItem("sample-decision", request.dataset.requestId);
      } catch {}
    }
    // Delay disabling until the browser has captured the native submitter name and value.
    setTimeout(
      () =>
        form.querySelectorAll("button").forEach((button) => {
          button.disabled = true;
        }),
      0,
    );
  });
  try {
    const previous = JSON.parse(
        sessionStorage.getItem("sample-balances") || "{}",
      ),
      next = {};
    document.querySelectorAll("[data-balance]").forEach((el) => {
      const value = Number(el.dataset.value),
        id = el.dataset.balance;
      next[id] = value;
      if (!Number.isSafeInteger(previous[id]) || previous[id] === value) return;
      const difference = value - previous[id];
      const change = document.createElement("span");
      change.className = "balance-change";
      change.textContent = `${difference > 0 ? "+" : "−"}${new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Math.abs(difference) / 100)} since previous view`;
      el.after(change);
      if (reduced.matches) return;
      const currentText = el.textContent,
        before = new Intl.NumberFormat("en-CA", {
          style: "currency",
          currency: "CAD",
        })
          .format(previous[id] / 100)
          .padStart(currentText.length, " ");
      el.setAttribute("aria-label", currentText);
      el.replaceChildren();
      [...currentText].forEach((character, i) => {
        if (!/\d/.test(character) || before[i] === character) {
          el.append(document.createTextNode(character));
          return;
        }
        const window = document.createElement("span");
        window.className = "digit-window";
        window.setAttribute("aria-hidden", "true");
        const track = document.createElement("span");
        track.className = "digit-track";
        track.append(
          Object.assign(document.createElement("span"), {
            textContent: before[i] || "0",
          }),
          Object.assign(document.createElement("span"), {
            textContent: character,
          }),
        );
        window.append(track);
        el.append(window);
        track.animate(
          [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }],
          { duration: 240, easing: "cubic-bezier(.23,1,.32,1)" },
        );
      });
    });
    if (Object.keys(next).length)
      sessionStorage.setItem("sample-balances", JSON.stringify(next));
    const decision = sessionStorage.getItem("sample-decision");
    const request = document.querySelector("[data-request-id]");
    if (decision && request?.dataset.requestId === decision) {
      sessionStorage.removeItem("sample-decision");
      const state = request.dataset.outcome;
      if (state === "POSTED" && !reduced.matches)
        request.querySelector(".posted-turn")?.animate(
          [
            { opacity: 0.4, transform: "translateY(4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 200, easing: "cubic-bezier(.23,1,.32,1)" },
        );
      announce(
        state === "POSTED"
          ? "Transfer posted in Teller."
          : state === "DENIED"
            ? "Request rejected. Nothing sent to Teller."
            : state === "HELD"
              ? "Request is still held. Review the current state."
              : "Decision recorded. Inspect the current Teller result.",
      );
    }
  } catch {}
  const loading = document.createElement("div");
  loading.className = "loading-indicator";
  loading.setAttribute("aria-hidden", "true");
  document.body.append(loading);
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (
      link &&
      link.origin === location.origin &&
      (link.pathname !== location.pathname ||
        link.search !== location.search) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !link.download &&
      !link.href.includes("/export")
    )
      root.dataset.loading = "true";
  });
  window.addEventListener("pageshow", () => {
    delete root.dataset.loading;
    document.querySelectorAll("form[aria-busy]").forEach((form) => {
      form.removeAttribute("aria-busy");
      form.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    });
  });
  const queue = document.querySelector("[data-live-queue]");
  if (!queue) return;
  let revision = queue.dataset.revision,
    polling = false,
    stopped = false,
    pending = false;
  const status = (message) => {
    const el = queue.querySelector("[data-sync-status]");
    if (el) el.textContent = message;
  };
  async function poll() {
    if (polling || stopped || document.hidden) return;
    polling = true;
    try {
      const response = await fetch("/queue/snapshot", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401) {
        stopped = true;
        status("Session ended · reconnect");
        announce(
          "Your sample session ended. Start a new session from your client.",
        );
        return;
      }
      if (!response.ok) throw new Error("Unavailable");
      const next = await response.json();
      if (next.index) {
        applyIndex(next.index);
        if (results && !results.hidden) searchSession();
      }
      if (next.revision !== revision) {
        if (queue.contains(document.activeElement)) {
          pending = true;
          status("New activity · waiting for focus to move");
          return;
        }
        const table = queue.querySelector("[data-table]"),
          saved = table && controllers.get(table)?.();
        queue.innerHTML = next.html;
        revision = next.revision;
        localTimes(queue);
        setupTables(queue, saved);
        announce("Transfer queue updated.");
      }
      pending = false;
      status("Up to date · checks every 15s");
    } catch {
      status("Updates paused · retrying");
    } finally {
      polling = false;
    }
  }
  queue.addEventListener("focusout", () =>
    queueMicrotask(() => {
      if (pending && !queue.contains(document.activeElement)) poll();
    }),
  );
  setInterval(poll, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });
})();
