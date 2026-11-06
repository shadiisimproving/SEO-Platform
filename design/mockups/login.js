/* The sign-in page, and the first-login password change. It talks only to /api/auth. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let csrf = "";
  const fail = (text) => { $("err").textContent = text; $("err").hidden = !text; };
  async function send(path, body) {
    let reply;
    try {
      reply = await fetch(`api/auth/${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    } catch { throw new Error("Can't reach the app. Check it's running, then try again."); }
    const data = await reply.json().catch(() => ({}));
    if (!reply.ok) throw new Error(data.error || "That didn't work. Try again.");
    return data;
  }
  function askForNewPassword(known) {
    $("sign-in").hidden = true; $("change").hidden = false;
    $("title").textContent = "Choose your password";
    $("sub").textContent = "Your temporary password only works once.";
    if (known) { $("current").value = known; $("current").closest(".field").hidden = true; $("next").focus(); } else $("current").focus();
  }
  const enter = () => location.replace("./");
  $("sign-in").addEventListener("submit", async (e) => {
    e.preventDefault(); fail("");
    const email = $("email").value.trim(), password = $("password").value;
    if (!email || !password) { fail("Enter your username and password."); return; }
    $("go").disabled = true;
    try {
      const data = await send("login", { email, password });
      csrf = data.csrf;
      if (data.user.must_change_password) askForNewPassword(password); else enter();
    } catch (err) { fail(err.message); $("password").value = ""; $("password").focus(); } finally { $("go").disabled = false; }
  });
  $("change").addEventListener("submit", async (e) => {
    e.preventDefault(); fail("");
    if (e.submitter) e.submitter.disabled = true; // a second click would be refused: the first has already changed the session
    try { await send("password", { current: $("current").value, new: $("next").value }); enter(); } catch (err) { fail(err.message); $("next").focus(); } finally { if (e.submitter) e.submitter.disabled = false; }
  });
  // Sent here with a temporary password still to change, by a session that's already signed in.
  if (new URLSearchParams(location.search).has("change")) {
    fetch("api/auth/me").then((r) => (r.ok ? r.json() : null)).then((me) => { if (me?.user?.must_change_password) { csrf = me.csrf; askForNewPassword(""); } });
  }
})();
