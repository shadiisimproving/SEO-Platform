/* Runs before everything else. With a server, every change carries the CSRF token and a lost session goes to the sign-in page,
   so no screen has to remember to. As a plain file there is no server and this does nothing. */
(() => {
  "use strict";
  window.ME = null;
  if (!location.protocol.startsWith("http")) return;
  const nativeFetch = window.fetch.bind(window);
  const safe = new Set(["GET", "HEAD", "OPTIONS"]);
  let csrf = null;
  let asked = null;
  const whoAmI = () => {
    asked = asked || nativeFetch("api/auth/me").then(async (reply) => {
      // 404: no login on this server (a test harness), kept. Anything else (a 429 in the load burst, signed out) is asked again next time.
      if (!reply.ok) { if (reply.status !== 404) asked = null; return null; }
      const me = await reply.json();
      csrf = me.csrf;
      window.ME = me.user;
      if (Array.isArray(me.team) && me.team.length) window.TEAM_NAMES = me.team;
      return me;
    }).catch(() => { asked = null; return null; });
    return asked;
  };
  window.whoAmI = whoAmI;
  /* Forget the answer and ask once more: COMP.api calls it after a 403 "This page is out of date", then sends the change again. */
  whoAmI.again = () => { asked = null; csrf = null; return whoAmI(); };
  window.fetch = async (input, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (!safe.has(method)) {
      await whoAmI();
      if (csrf) init = { ...init, headers: { ...(init.headers || {}), "X-CSRF-Token": csrf } };
    }
    const reply = await nativeFetch(input, init);
    if (reply.status === 401 || reply.status === 403) {
      const copy = await reply.clone().json().catch(() => ({}));
      if (copy.signed_out) {
        if (window.AUTH_HOOKS?.signedOut?.(reply) === true) return reply; // mockup.js keeps the half-typed work and signs in again in place
        location.replace("login");
      }
      else if (copy.must_change) location.replace("login?change=1");
    }
    return reply;
  };
  window.signOut = async () => { await window.fetch("api/auth/logout", { method: "POST" }); location.replace("login"); };
  whoAmI();
})();
