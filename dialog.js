function renderMessage(text) {
  const el = document.getElementById("message");
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  for (const part of parts) {
    if (part.match(/^https?:\/\//)) {
      el.appendChild(makeLink(part));
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

function renderSelects(selectsConfig) {
  const selectEls = {};
  if (!Array.isArray(selectsConfig) || selectsConfig.length === 0) {
    return selectEls;
  }

  const container = document.getElementById("dialogSelects");
  for (const selectConfig of selectsConfig) {
    const row = document.createElement("div");
    row.className = "select-row";
    row.id = "select-row-" + selectConfig.id;

    if (selectConfig.label) {
      const label = document.createElement("label");
      label.textContent = selectConfig.label;
      label.htmlFor = "select-" + selectConfig.id;
      row.appendChild(label);
    }

    const selectEl = document.createElement("select");
    selectEl.id = "select-" + selectConfig.id;
    for (const opt of selectConfig.options || []) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.title) o.title = opt.title;
      selectEl.appendChild(o);
    }
    if (selectConfig.selected != null)
      selectEl.value = String(selectConfig.selected);

    row.appendChild(selectEl);
    container.appendChild(row);
    selectEls[selectConfig.id] = selectEl;
  }

  // Wire up conditional visibility (a select only shown while another
  // select has a specific value, e.g. the Helpdesk team picker only while
  // "Import as" is set to Ticket).
  for (const selectConfig of selectsConfig) {
    if (!selectConfig.showWhen) continue;
    const row = document.getElementById("select-row-" + selectConfig.id);
    const trigger = selectEls[selectConfig.showWhen.id];
    if (!row || !trigger) continue;
    const update = () => {
      row.style.display =
        trigger.value === selectConfig.showWhen.equals ? "" : "none";
    };
    trigger.addEventListener("change", update);
    update();
  }

  return selectEls;
}

(async () => {
  const params = new URLSearchParams(location.search);
  document.title = params.get("title") || "Odoo Email Connector";
  renderMessage(params.get("message") || "");

  const win = await browser.windows.getCurrent();
  let buttons;
  try {
    buttons = JSON.parse(params.get("buttons"));
  } catch {
    buttons = [];
  }

  let selectsConfig = null;
  try {
    selectsConfig = JSON.parse(params.get("selects"));
  } catch {
    selectsConfig = null;
  }

  const selectEls = renderSelects(selectsConfig);
  const hasSelects = Object.keys(selectEls).length > 0;

  const container = document.getElementById("buttons");
  for (const btn of buttons) {
    container.appendChild(
      createButton(
        btn.title,
        () => {
          let choice = btn.value;
          if (hasSelects) {
            const selections = {};
            for (const id in selectEls) selections[id] = selectEls[id].value;
            choice = { value: btn.value, selections };
          }
          browser.runtime.sendMessage({
            action: "dialogChoice",
            windowId: win.id,
            choice,
          });
          window.close();
        },
        btn.tooltip,
      ),
    );
  }

  if (buttons.length === 0) {
    container.appendChild(createButton("OK", () => window.close()));
  }

  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a");
    if (anchor) {
      e.preventDefault();
      window.open(anchor.href, "_blank");
    }
  });
})();
