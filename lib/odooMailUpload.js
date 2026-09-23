import { odooCall } from "./odooClient.js";

/**
 * Log a snippet of text to the DevTools console.
 *
 * CRLF is normalized to LF, so the console renders real line breaks instead
 * of blank lines between every line. The text is passed as a separate %s
 * argument so the console evaluates \n instead of escaping it.
 *
 * @param {string} prefix log prefix
 * @param {string} text text to log
 * @param {number} max_length maximum number of characters to log
 */
export function log_snippet(prefix, text, max_length = 1000) {
  const snippet =
    text.slice(0, max_length) + (text.length > max_length ? "…" : "");
  console.debug(
    prefix + " (%d chars):\n%s",
    snippet.length,
    snippet.replace(/\r\n/g, "\n"),
  );
}

/**
 * Convert the binary string returned by messenger.messages.getRaw() into a
 * proper UTF-8 string.
 *
 * getRaw() yields a "binary string": each character's code unit is a byte
 * value (0-255). Feeding such a string straight into JSON.stringify mangles
 * multi-byte UTF-8 sequences, as each byte gets encoded as its own Latin-1
 * code point (e.g. "ü" = 0xC3 0xBC becomes "Ã¼"). Odoo then receives the
 * mojibake instead of the original text.
 *
 * We therefore re-interpret the bytes as UTF-8. If the content is not valid
 * UTF-8 (e.g. a legacy ISO-8859-1 encoded email), we fall back to the
 * original binary string, which – thanks to the 1:1 mapping of byte values
 * to Latin-1 code points – already represents the original characters
 * correctly for single-byte encodings.
 *
 * @param {string} rawMail binary string as returned by getRaw()
 * @returns {string} properly decoded message source
 */
export function decodeRawMail(rawMail) {
  const bytes = new Uint8Array(rawMail.length);
  for (let i = 0; i < rawMail.length; i++) {
    bytes[i] = rawMail.charCodeAt(i);
  }
  console.debug("decodeRawMail: raw length=" + rawMail.length + " bytes");
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    console.debug("decodeRawMail: decoded as UTF-8, length=" + decoded.length);
    return decoded;
  } catch (err) {
    console.warn(
      "decodeRawMail: not valid UTF-8 (" +
        err.message +
        "), falling back to Latin-1",
    );
    return rawMail;
  }
}

/**
 * Upload raw RFC822 email to Odoo
 * @param {Object} cfg Odoo config
 * @param {string} message Decoded RFC822 content (UTF-8 text)
 * @param {string} model Odoo model to import into (false for generic)
 * @param {Object|null} customValues Default field values for the new record
 *   (e.g. { team_id: 7 } for Helpdesk tickets) — same mechanism Odoo's own
 *   mail aliases use via alias_defaults.
 * @returns {Promise} result of the Odoo call
 *
 * Calls message_process which returns: thread_id (int), false (duplicate), null (ignored)
 */
export async function uploadMail(
  cfg,
  message,
  model = false,
  customValues = null,
) {
  console.debug(
    "uploadMail: model=" +
      (model || "<generic>") +
      " message length=" +
      message.length,
  );

  console.debug(
    "uploadMail: sending message length=" +
      message.length +
      " to " +
      cfg.url +
      "/json/2/mail.thread/message_process",
  );
  const params = {
    model: model,
    message: message,
  };
  if (customValues) params.custom_values = customValues;
  const result = await odooCall(cfg, "mail.thread/message_process", params);
  console.debug("uploadMail: result=" + JSON.stringify(result));
  return result;
}
