// Runs background.js against a fake Thunderbird and a fake Odoo, with the
// Helpdesk team list simulated in storage (as cached by the options page).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeBrowser,
  installFakeOdoo,
  settle,
} from "./helpers/fakeBrowser.js";

const CONFIG = { url: "https://odoo.example.com", apikey: "k" };
const ONE_TEAM = [{ id: 3, name: "Customer Care" }];
const TEAMS = [
  { id: 3, name: "Customer Care" },
  { id: 7, name: "Sales & Support" },
  { id: 9, name: "Technical" },
];
const RAW_MAIL =
  "Message-ID: <new-1@example.com>\r\n" +
  "X-Original-To: support@example.com\r\n" +
  "Delivered-To: mbox@internal.example.com\r\n" +
  "From: customer@example.com\r\n" +
  "To: support@example.com\r\n" +
  "Subject: Help\r\n" +
  "\r\n" +
  "body\r\n";

const realFetch = globalThis.fetch;
const realDebug = console.debug;
let loadCount = 0;

afterEach(() => {
  globalThis.fetch = realFetch;
  console.debug = realDebug;
  delete globalThis.browser;
  delete globalThis.messenger;
});

/**
 * Loads a fresh copy of background.js with the given storage content.
 * The query string makes node evaluate the module again for each test.
 */
async function loadBackground(storage, { rawMail = RAW_MAIL, odoo = {} } = {}) {
  const requests = installFakeOdoo({
    "mail.thread/message_process": () => 42,
    ...odoo,
  });
  console.debug = () => {}; // background.js logs every step
  const fb = createFakeBrowser({ storage, rawMail });
  globalThis.browser = fb.browser;
  globalThis.messenger = fb.browser;
  // showResult() copies the record URL to the clipboard.
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  });
  await import("../background.js?instance=" + ++loadCount);
  return { ...fb, requests };
}

function importMenuIds(menus) {
  return [...menus.keys()].filter((id) => id.startsWith("odoo-import"));
}

async function clickMenu(fb, menuItemId) {
  await fb.browser.menus.onClicked.fire(
    { menuItemId, selectedMessages: { messages: [{ id: 1 }] } },
    {},
  );
  await settle();
}

function uploads(fb) {
  return fb.requests
    .filter((r) => r.route === "mail.thread/message_process")
    .map((r) => r.body);
}

// --- right-click menu ------------------------------------------------------

test("no menu while the add-on is not configured", async () => {
  const fb = await loadBackground({ helpdeskTeams: TEAMS });
  assert.equal(fb.menus.size, 0);
});

test("without Helpdesk teams the menu offers Opportunity and Generic only", async () => {
  const fb = await loadBackground({ ...CONFIG });
  assert.deepEqual(importMenuIds(fb.menus), [
    "odoo-import-opportunity",
    "odoo-import-generic",
  ]);
});

test("with one team there is a single Ticket entry and no team submenu", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: ONE_TEAM });
  assert.deepEqual(importMenuIds(fb.menus), [
    "odoo-import-ticket",
    "odoo-import-opportunity",
    "odoo-import-generic",
  ]);
});

test("with several teams the Ticket entry has one child per team", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: TEAMS });
  const children = [...fb.menus.values()].filter(
    (m) => m.parentId === "odoo-import-ticket",
  );
  assert.deepEqual(
    children.map((m) => [m.id, m.title]),
    [
      ["odoo-import-ticket-team-3", "Customer Care"],
      ["odoo-import-ticket-team-7", "Sales && Support"],
      ["odoo-import-ticket-team-9", "Technical"],
    ],
  );
});

test("the menu is rebuilt when teams are loaded, without a restart", async () => {
  const fb = await loadBackground({ ...CONFIG });
  assert.ok(!fb.menus.has("odoo-import-ticket"));

  await fb.browser.storage.local.set({ helpdeskTeams: TEAMS });
  await settle();
  assert.ok(fb.menus.has("odoo-import-ticket-team-7"));

  await fb.browser.storage.local.set({ helpdeskTeams: [] });
  await settle();
  assert.ok(!fb.menus.has("odoo-import-ticket"));
});

async function showMenu(fb, count) {
  const messages = Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
  await fb.browser.menus.onShown.fire({ selectedMessages: { messages } });
  await settle();
}

test("showing the menu without Helpdesk does not fail on the missing Ticket entry", async () => {
  const fb = await loadBackground({ ...CONFIG });
  await showMenu(fb, 1);
  assert.equal(fb.menus.get("odoo-import-opportunity").visible, true);
  assert.equal(fb.menus.get("odoo-import-generic").visible, true);
});

test("import entries are hidden when several emails are selected", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: TEAMS });
  await showMenu(fb, 2);
  for (const id of importMenuIds(fb.menus).filter((i) => !i.includes("-team-")))
    assert.equal(fb.menus.get(id).visible, false, id);
  assert.equal(fb.menus.get("odoo-verify").title, "Verify 2 messages");
});

// --- import from the right-click menu ---------------------------------------

test("Import as Ticket with one team leaves the team to Odoo", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: ONE_TEAM });
  await clickMenu(fb, "odoo-import-ticket");
  assert.equal(fb.dialogs.length, 0);
  const [body] = uploads(fb);
  assert.equal(body.model, "helpdesk.ticket");
  assert.ok(!("custom_values" in body));
});

test("the team picked in the submenu is passed as team_id", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 3,
  });
  await clickMenu(fb, "odoo-import-ticket-team-7");
  const [body] = uploads(fb);
  assert.equal(body.model, "helpdesk.ticket");
  assert.deepEqual(body.custom_values, { team_id: 7 });
});

test("Import as Ticket uses the configured default team", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    helpdeskTeams: ONE_TEAM,
    helpdeskTeamId: 3,
  });
  await clickMenu(fb, "odoo-import-ticket");
  assert.deepEqual(uploads(fb)[0].custom_values, { team_id: 3 });
});

test("a default team no longer in the team list is not sent", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    helpdeskTeams: ONE_TEAM,
    helpdeskTeamId: 99,
  });
  await clickMenu(fb, "odoo-import-ticket");
  assert.ok(!("custom_values" in uploads(fb)[0]));
});

test("Import as Opportunity and Generic work as before", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: TEAMS });
  await clickMenu(fb, "odoo-import-opportunity");
  // The first import cached the email as found; use a new Message-ID.
  fb.browser.messages.getRaw = async () => RAW_MAIL.replace("new-1@", "new-2@");
  await clickMenu(fb, "odoo-import-generic");
  const [lead, generic] = uploads(fb);
  assert.equal(lead.model, "crm.lead");
  assert.ok(!("custom_values" in lead));
  assert.equal(generic.model, false);
});

test("an email already in Odoo is not uploaded again", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: TEAMS },
    {
      odoo: {
        "mail.message/search_read": () => [
          {
            id: 5,
            message_id: "<new-1@example.com>",
            model: "helpdesk.ticket",
            res_id: 11,
          },
        ],
      },
    },
  );
  await clickMenu(fb, "odoo-import-ticket-team-7");
  assert.equal(uploads(fb).length, 0);
});

test("an Odoo error is shown in a dialog", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: ONE_TEAM },
    {
      odoo: {
        "mail.thread/message_process": () => {
          throw new Error("Invalid field team_id");
        },
      },
    },
  );
  await clickMenu(fb, "odoo-import-ticket");
  assert.equal(fb.dialogs.length, 1);
  assert.match(fb.dialogs[0].get("message"), /Invalid field team_id/);
});

// --- import from the status bar ("Add") --------------------------------------

async function addFromStatusBar(fb, choice) {
  const msg = { action: "addMessage", messageId: 1 };
  if (choice) msg.choice = choice;
  const [result] = await fb.browser.runtime.onMessage.fire(msg, {});
  await settle();
  return result;
}

test("Add without a choice keeps importing as Opportunity without Helpdesk", async () => {
  const fb = await loadBackground({ ...CONFIG });
  const result = await addFromStatusBar(fb);
  assert.equal(result.success, true);
  assert.equal(uploads(fb)[0].model, "crm.lead");
});

test("a stored Ticket default falls back to Opportunity without Helpdesk", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    defaultImportAs: "helpdesk.ticket",
  });
  await addFromStatusBar(fb);
  assert.equal(uploads(fb)[0].model, "crm.lead");
});

test("Add without a choice imports as Ticket once teams are loaded", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 9,
  });
  await addFromStatusBar(fb);
  const [body] = uploads(fb);
  assert.equal(body.model, "helpdesk.ticket");
  assert.deepEqual(body.custom_values, { team_id: 9 });
});

test("Add passes the model and team chosen in the status bar", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: TEAMS });
  await addFromStatusBar(fb, { model: "helpdesk.ticket", teamId: "7" });
  assert.deepEqual(uploads(fb)[0].custom_values, { team_id: 7 });
});

test("a Generic default is honored", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    defaultImportAs: "generic",
  });
  await addFromStatusBar(fb);
  assert.equal(uploads(fb)[0].model, false);
});

// --- Delivered-To option -----------------------------------------------------

test("Delivered-To is sent unchanged while the option is off", async () => {
  const fb = await loadBackground({ ...CONFIG });
  await clickMenu(fb, "odoo-import-opportunity");
  assert.match(
    uploads(fb)[0].message,
    /^Delivered-To: mbox@internal\.example\.com$/m,
  );
});

test("Delivered-To is replaced with X-Original-To when the option is on", async () => {
  const fb = await loadBackground({ ...CONFIG, rewriteDeliveredTo: true });
  await clickMenu(fb, "odoo-import-opportunity");
  const { message } = uploads(fb)[0];
  assert.match(message, /^Delivered-To: support@example\.com$/m);
  assert.doesNotMatch(message, /internal\.example\.com/);
});

// --- listHelpdeskTeams --------------------------------------------------------

test("listHelpdeskTeams reports a missing Helpdesk app as an error", async () => {
  const fb = await loadBackground({ ...CONFIG });
  const [result] = await fb.browser.runtime.onMessage.fire(
    { action: "listHelpdeskTeams" },
    {},
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /helpdesk\.team/);
});
