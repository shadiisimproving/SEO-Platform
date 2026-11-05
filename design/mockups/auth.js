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
      if (!reply.ok) return null; // no login on this server (a test harness), or signed out
      const me = await reply.json();
      csrf = me.csrf;
      window.ME = me.user;
      if (Array.isArray(me.team) && me.team.length) window.TEAM_NAMES = me.team;
      return me;
    }).catch(() => null);
    return asked;
  };
  window.whoAmI = whoAmI;
  window.fetch = async (input, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (!safe.has(method)) {
      await whoAmI();
      if (csrf) init = { ...init, headers: { ...(init.headers || {}), "X-CSRF-Token": csrf } };
    }
    const reply = await nativeFetch(input, init);
    if (reply.status === 401 || reply.status === 403) {
      const copy = await reply.clone().json().catch(() => ({}));
      if (copy.signed_out) location.replace("login");
      else if (copy.must_change) location.replace("login?change=1");
    }
    return reply;
  };
  window.signOut = async () => { await window.fetch("api/auth/logout", { method: "POST" }); location.replace("login"); };
  whoAmI();
})();
