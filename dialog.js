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

  const container = document.getElementById("buttons");
  for (const btn of buttons) {
    container.appendChild(
      createButton(
        btn.title,
        () => {
          browser.runtime.sendMessage({
            action: "dialogChoice",
            windowId: win.id,
            choice: btn.value,
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
