import nodemailer from "nodemailer";
import Config from "../config/config.js";

/**
 * Outgoing mail for the auth module.
 *
 * Same convention as the identity providers (helpers/providers.js) and BinaryStore:
 * a capability the deployment has not configured is not offered at all, rather than
 * offered and then failing. `isConfigured()` is what /auth/config reports as
 * `passwordResetEnabled`, so a login page never shows a "forgot password" link that
 * cannot work.
 *
 * The transport is created lazily and kept, because env files are loaded by the app
 * after this module is imported -- reading process.env at import time would see
 * nothing.
 */
let transport;

function isConfigured() {
  const { host, from, appUrl } = Config.mail();
  return Boolean(host && from && appUrl);
}

function getTransport() {
  if (!transport) {
    const { host, port, user, password } = Config.mail();
    transport = nodemailer.createTransport({
      host,
      port,
      // 465 is implicit TLS, everything else upgrades with STARTTLS. Free one-way
      // senders differ on which they offer, so it follows the port instead of being
      // another environment variable to get wrong.
      secure: port === 465,
      // An open relay on localhost has no credentials; sending `auth: { user: undefined }`
      // makes nodemailer try to authenticate and fail.
      auth: user ? { user, pass: password } : undefined,
      // Bounded on purpose: /auth/password/reset-request awaits the send, so an SMTP
      // server that accepts the connection and then goes quiet would hang the HTTP
      // request indefinitely. Ten seconds is long for a mail hop and short for a person
      // waiting on a form.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  return transport;
}

async function send({ to, subject, text, html }) {
  if (!isConfigured()) {
    throw new Error("Mail is not configured (SMTP_HOST, MAIL_FROM and APP_URL are required)");
  }
  return getTransport().sendMail({ from: Config.mail().from, to, subject, text, html });
}

/** Absolute link into the login page's reset mode. See caio-ui/static/login/. */
function getPasswordResetUri(token) {
  const base = Config.mail().appUrl.replace(/\/+$/, "");
  return `${base}/login.html?reset=${encodeURIComponent(token)}`;
}

async function sendPasswordReset({ to, token, name }) {
  const uri = getPasswordResetUri(token);
  const minutes = Math.round(Config.passwordReset.tokenLifetimeMs / 60000);
  const greeting = name ? `Dobrý den, ${name},` : "Dobrý den,";
  const text = [
    greeting,
    "",
    "někdo (nejspíš vy) požádal o nastavení nového hesla. Odkaz níž platí " + minutes + " minut:",
    "",
    uri,
    "",
    "Pokud jste o nic nežádali, nic nedělejte -- heslo zůstává beze změny.",
  ].join("\n");

  const html = `<p>${greeting}</p>
<p>někdo (nejspíš vy) požádal o nastavení nového hesla. Odkaz níž platí ${minutes} minut:</p>
<p><a href="${uri}">Nastavit nové heslo</a></p>
<p>Pokud jste o nic nežádali, nic nedělejte &mdash; heslo zůstává beze změny.</p>`;

  return send({ to, subject: "Nastavení nového hesla", text, html });
}

export default { isConfigured, send, sendPasswordReset, getPasswordResetUri };
