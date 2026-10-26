export function consoleHtml(apiBase: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Zolt Console</title>
  <style>
    :root { color-scheme:dark; --bg:#071018; --panel:#101826; --ink:#e8eefc; --muted:#8fa0bf; --accent:#3ee0b2; --warn:#ffb020; --bad:#ff5d6c; --line:#243049; --ok:#3ee0b2; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Segoe UI,sans-serif; background:radial-gradient(1200px 500px at 10% -10%, #123044 0%, var(--bg) 45%); color:var(--ink); }
    header { display:flex; gap:16px; flex-wrap:wrap; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--line); background:#0b1522cc; backdrop-filter:blur(8px); position:sticky; top:0; z-index:4; }
    nav { display:flex; gap:4px; overflow-x:auto; flex:1; }
    nav a { color:var(--muted); padding:8px 10px; border-radius:8px; text-decoration:none; white-space:nowrap; font-size:13px; }
    nav a.active, nav a:hover { color:var(--accent); background:#123044; }
    main { padding:20px; display:grid; gap:16px; }
    .card { background:var(--panel); padding:16px; border-radius:14px; border:1px solid var(--line); }
    .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; }
    .kpi { background:#0c1624; border:1px solid var(--line); border-radius:12px; padding:12px; }
    .kpi b { display:block; font-size:22px; margin-top:6px; }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; background:#243049; }
    .pill.high, .pill.critical { background:#4a1820; color:#ffb4bc; }
    .pill.ok { background:#14352c; color:var(--ok); }
    input, select, textarea, button { padding:8px 10px; border-radius:8px; border:1px solid #31405f; background:#0f1728; color:var(--ink); }
    button { background:var(--accent); color:#06281f; font-weight:700; cursor:pointer; }
    button.danger { background:var(--bad); color:white; }
    button.secondary { background:#243049; color:var(--ink); }
    :focus-visible { outline:3px solid var(--warn); outline-offset:2px; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); font-size:14px; }
    .muted { color:var(--muted); }
    .warn { color:var(--warn); }
    .bad { color:var(--bad); }
    canvas { width:100%; height:220px; background:#0c1624; border-radius:8px; }
    form { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    form.stack { flex-direction:column; align-items:stretch; max-width:420px; }
    form.stack input, form.stack button { width:100%; }
    .session { display:flex; gap:10px; align-items:center; }
    .error { color:var(--bad); min-height:1.2em; }
    .loading { min-height:120px; display:grid; place-items:center; }
    .timeline { display:grid; gap:10px; }
    .timeline article { border-left:3px solid var(--accent); padding:8px 12px; background:#0c1624; }
    a.rowlink { color:inherit; text-decoration:none; }
    @media (max-width:760px) { header { align-items:flex-start; padding:12px; } main { padding:12px; } nav { order:4; flex-basis:100%; } input, select, textarea, button { max-width:100%; } .kpis { grid-template-columns:1fr 1fr; } }
    @media (prefers-color-scheme:light) { :root { color-scheme:light; --bg:#f3f6fa; --panel:#fff; --ink:#142033; --muted:#5a6680; --line:#d7deea; } input, select, textarea { background:white; color:var(--ink); } body { background:var(--bg); } }
  </style>
</head>
<body>
  <header>
    <strong>Zolt Console</strong>
    <nav id="nav"></nav>
    <label id="tenantLabel" class="muted" hidden>Tenant <select id="tenantSwitch" aria-label="Active tenant"></select></label>
    <div id="sessionBar" class="session"></div>
  </header>
  <main id="app"></main>
  <script>
    const API = ${JSON.stringify(apiBase)};
    const publicPages = new Set(["#/login","#/invite","#/reset"]);
    const pages = [
      ["#/command","Command Centre"],["#/fleet","Fleet"],["#/assets","Assets"],["#/telemetry","Telemetry"],
      ["#/recommendations","Recommendations"],["#/incidents","Incidents"],["#/alerts","Alerts"],["#/integrations","Integrations"],
      ["#/webhooks","Webhooks"],["#/credentials","API credentials"],["#/users","Users"],["#/audit","Audit"],
      ["#/reports","Reports"],["#/health","System health"],["#/models","Models"],["#/optimisation","Optimisation"],["#/copilot","Copilot"],["#/profile","Profile"]
    ];
    const state = { token: localStorage.getItem("zoltToken") || "", tenantId: localStorage.getItem("zoltTenant") || "", permissions: [], email: "", name: "", userId: "", platformOperator: false };
    function headers(hasBody) {
      const h = {};
      if (hasBody) h["content-type"] = "application/json";
      if (state.token) h.authorization = "Bearer " + state.token;
      return h;
    }
    async function api(path, opts={}) {
      const method = String(opts.method || "GET").toUpperCase();
      if (["POST","PATCH","PUT","DELETE"].includes(method) && opts.body == null) opts = { ...opts, body: "{}" };
      const res = await fetch(API + path, { ...opts, headers: { ...headers(opts.body != null), ...(opts.headers||{}) } });
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      if (!res.ok) throw new Error((body && body.code) || text || res.status);
      return body;
    }
    function esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
    }
    function jsonHtml(value) { return esc(JSON.stringify(value, null, 2)); }
    function nav() {
      const adminOnly = new Set(["#/credentials", "#/users", "#/audit", "#/models", "#/health"]);
      const signedIn = Boolean(state.token);
      document.getElementById("nav").innerHTML = signedIn ? pages.filter(([href]) => !adminOnly.has(href) || state.permissions.includes("admin:manage") || (href==="#/audit" && state.permissions.includes("audit:read"))).map(([href,label]) =>
        '<a href="'+href+'" class="'+(location.hash===href?'active':'')+'">'+label+'</a>'
      ).join("") : '<a href="#/login" class="'+(location.hash==="#/login"||!location.hash?'active':'')+'">Sign in</a> <a href="#/invite">Accept invite</a>';
      document.getElementById("tenantLabel").hidden = !signedIn;
      const session = document.getElementById("sessionBar");
      if (!signedIn) {
        session.innerHTML = '<span class="muted">Signed out</span>';
        return;
      }
      session.innerHTML = '<span id="who">'+esc(state.name || state.email || "Signed in")+(state.email && state.name ? ' <span class="muted">('+esc(state.email)+')</span>' : "")+(state.platformOperator ? ' <span class="warn">Platform operator</span>' : "")+'</span><button type="button" id="signOut" class="secondary">Sign out</button>';
      document.getElementById("signOut").onclick = signOut;
    }
    function clearSession() {
      state.token = ""; state.tenantId = ""; state.permissions = []; state.email = ""; state.name = ""; state.userId = ""; state.platformOperator = false;
      localStorage.removeItem("zoltToken"); localStorage.removeItem("zoltTenant");
      document.getElementById("tenantSwitch").innerHTML = "";
    }
    async function signOut() {
      try { if (state.token) await api("/v1/auth/logout", { method:"POST", body: "{}" }); } catch {}
      clearSession();
      location.hash = "#/login";
      nav();
      render();
    }
    function card(title, body) { return '<section class="card"><h2>'+title+'</h2>'+body+'</section>'; }
    async function hydrateIdentity() {
      if (!state.token) return;
      const me = await api("/v1/me");
      state.permissions = me.permissions || [];
      state.email = me.email || "";
      state.name = me.name || "";
      state.userId = me.userId || "";
      state.platformOperator = me.platformOperator === true;
      if (me.tenantId) state.tenantId = me.tenantId;
      const memberships = await api("/v1/me/tenants");
      const select = document.getElementById("tenantSwitch");
      select.innerHTML = memberships.map(m => '<option value="'+esc(m.tenant.id)+'" '+(m.tenant.id===state.tenantId?'selected':'')+'>'+esc(m.tenant.name)+'</option>').join("");
      select.onchange = async () => {
        const switched = await api("/v1/auth/switch-tenant", { method:"POST", body:JSON.stringify({tenantId:select.value}) });
        state.token=switched.token; state.tenantId=switched.tenantId;
        localStorage.setItem("zoltToken",state.token); localStorage.setItem("zoltTenant",state.tenantId);
        await hydrateIdentity(); render();
      };
    }
    async function streamTelemetry(qs) {
      if (window.zoltStreamAbort) window.zoltStreamAbort.abort();
      const controller = new AbortController(); window.zoltStreamAbort = controller;
      const response = await fetch(API+"/v1/telemetry/stream?"+qs,{headers:headers(),signal:controller.signal});
      if (!response.ok || !response.body) throw new Error("TELEMETRY_STREAM_FAILED");
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffered="";
      while(true){ const part=await reader.read(); if(part.done) break; buffered+=decoder.decode(part.value,{stream:true});
        const frames=buffered.split("\\n\\n"); buffered=frames.pop()||"";
        frames.forEach(frame=>{ const line=frame.split("\\n").find(value=>value.startsWith("data: ")); if(!line)return;
          const rows=JSON.parse(line.slice(6)); drawChart(rows); document.getElementById("out").textContent=JSON.stringify(rows.slice(0,5),null,2);
          document.getElementById("sim").textContent=rows.some(d=>d.simulated)?"Includes SIMULATED telemetry — not live plant data.":"Live telemetry only.";
        });
      }
    }
    function drawChart(rows) {
      const canvas = document.getElementById("chart");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      canvas.width = canvas.clientWidth; canvas.height = 180;
      const values = rows.map(r => {
        const m = (r.measurements||[]).find(x => x.key==="powerKw");
        return typeof m?.value === "number" ? m.value : 0;
      }).reverse();
      if (!values.length) return;
      const max = Math.max(...values, 1);
      ctx.strokeStyle = "#3ee0b2"; ctx.beginPath();
      values.forEach((v,i) => {
        const x = (i/(values.length-1||1))*(canvas.width-10)+5;
        const y = canvas.height - (v/max)*(canvas.height-10) - 5;
        i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
      });
      ctx.stroke();
    }
    async function render() {
      nav();
      const app = document.getElementById("app");
      const route = (location.hash || "#/login").split("?")[0];
      try {
        app.innerHTML = card("Loading", '<p class="loading muted" role="status">Loading tenant data…</p>');
        if (route === "#/login") {
          if (state.token) { location.hash = "#/command"; return; }
          app.innerHTML = card("Sign in", '<form id="login" class="stack"><label>Email <input name="email" type="email" autocomplete="username" required/></label><label>Password <input name="password" type="password" autocomplete="current-password" required/></label><label>MFA code <input name="totpCode" inputmode="numeric" autocomplete="one-time-code" placeholder="if enabled"/></label><button type="submit">Sign in</button><p id="loginError" class="error" role="alert"></p></form><p class="muted"><a href="#/invite">Accept an invitation</a> · <a href="#/reset">Reset password</a></p><p class="muted">Advisory-only. No plant control.</p>');
          document.getElementById("login").onsubmit = async (e) => {
            e.preventDefault();
            const err = document.getElementById("loginError");
            err.textContent = "";
            try {
              const fd = new FormData(e.target);
              const payload = Object.fromEntries([...fd.entries()].filter(([,value]) => String(value).trim()));
              payload.deviceName = "Zolt Console";
              const result = await api("/v1/auth/login", { method:"POST", body: JSON.stringify(payload) });
              state.token = result.token; state.tenantId = result.tenantId; state.name = result.name || ""; state.email = result.email || ""; state.userId = result.userId || "";
              localStorage.setItem("zoltToken", result.token); localStorage.setItem("zoltTenant", result.tenantId);
              await hydrateIdentity();
              location.hash = "#/command";
              nav();
            } catch (error) {
              const code = error.message || "SIGN_IN_FAILED";
              err.textContent = code === "INVALID_CREDENTIALS" ? "Email or password is incorrect." : code === "ACCOUNT_LOCKED" ? "This account is locked. Try again later or request an unlock." : code === "MFA_REQUIRED" ? "Enter your MFA code to continue." : code === "EMAIL_NOT_VERIFIED" ? "Verify your email before signing in." : code;
            }
          };
          return;
        }
        if (route === "#/invite") {
          app.innerHTML = card("Accept invitation", '<form id="invite" class="stack"><label>Invitation token <input name="token" required autocomplete="off"/></label><label>Choose a password <input name="password" type="password" autocomplete="new-password" required minlength="12"/></label><button type="submit">Activate account</button><p id="inviteError" class="error" role="alert"></p></form><p class="muted"><a href="#/login">Back to sign in</a></p>');
          document.getElementById("invite").onsubmit = async (e) => {
            e.preventDefault();
            const err = document.getElementById("inviteError");
            err.textContent = "";
            try {
              const fd = new FormData(e.target);
              await api("/v1/auth/invitations/accept", { method:"POST", body: JSON.stringify(Object.fromEntries(fd)) });
              err.className = "muted"; err.textContent = "Account activated. Sign in with your email and new password.";
              setTimeout(() => { location.hash = "#/login"; }, 1200);
            } catch (error) { err.textContent = error.message || "INVITE_FAILED"; }
          };
          return;
        }
        if (route === "#/reset") {
          app.innerHTML = card("Reset password", '<form id="resetRequest" class="stack"><label>Email <input name="email" type="email" required/></label><button type="submit">Send reset</button></form><form id="resetConfirm" class="stack"><label>Reset token <input name="token" required/></label><label>New password <input name="password" type="password" autocomplete="new-password" required minlength="12"/></label><button type="submit">Set new password</button><p id="resetMsg" class="muted" role="status"></p></form><p class="muted"><a href="#/login">Back to sign in</a></p>');
          const msg = () => document.getElementById("resetMsg");
          document.getElementById("resetRequest").onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const result = await api("/v1/auth/password-reset/request", { method:"POST", body: JSON.stringify({ email: fd.get("email") }) });
            msg().textContent = result.developmentToken ? ("Development token: " + result.developmentToken) : "If that account exists, a reset was issued.";
          };
          document.getElementById("resetConfirm").onsubmit = async (e) => {
            e.preventDefault();
            try {
              const fd = new FormData(e.target);
              await api("/v1/auth/password-reset/confirm", { method:"POST", body: JSON.stringify(Object.fromEntries(fd)) });
              msg().textContent = "Password updated. Sign in with the new password.";
            } catch (error) { msg().className = "error"; msg().textContent = error.message; }
          };
          return;
        }
        if (!state.token && !publicPages.has(route)) { location.hash = "#/login"; return; }
        if (route === "#/command") {
          const centre = await api("/v1/command-centre");
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId));
          const health = await api("/v1/health/system");
          const sites = await api("/v1/installations");
          const high = recs.filter(r=>r.status==="PROPOSED"&&(r.severity==="HIGH"||r.severity==="CRITICAL"));
          app.innerHTML = '<div class="kpis">'+
            '<div class="kpi"><span class="muted">Sites online</span><b>'+esc(centre.sitesOnline)+'</b></div>'+
            '<div class="kpi"><span class="muted">Live MW</span><b>'+(centre.liveMwGeneration==null?"n/a":centre.liveMwGeneration)+'</b></div>'+
            '<div class="kpi"><span class="muted">Export MW</span><b>'+(centre.gridExportMw==null?"n/a":centre.gridExportMw)+'</b></div>'+
            '<div class="kpi"><span class="muted">Curtailment MW</span><b>'+(centre.curtailmentMw==null?"n/a":centre.curtailmentMw)+'</b></div>'+
            '<div class="kpi"><span class="muted">Open advisories</span><b>'+esc(centre.openRecommendations)+'</b></div>'+
            '<div class="kpi"><span class="muted">Critical alerts</span><b>'+esc(centre.criticalAlerts)+'</b></div>'+
            '<div class="kpi"><span class="muted">Open incidents</span><b>'+esc(centre.openIncidents)+'</b></div>'+
            '<div class="kpi"><span class="muted">Est. recovered</span><b>'+Number(centre.estimatedRevenueRecovered||0).toFixed(0)+'</b></div>'+
            '</div>'+
            card("Fleet command centre", "<p class='muted'>Advisory only. Predict → Optimise → Simulate → Human approve. No plant commands. Live MW stays n/a until a named plant publishes telemetry.</p><table><tr><th>Site</th><th>Status</th><th>Product</th></tr>"+(sites.map(r=>"<tr><td><a class='rowlink' href='#/fleet?site="+encodeURIComponent(r.id||r.name)+"'>"+esc(r.name)+"</a></td><td><span class='pill ok'>"+esc(r.status)+"</span></td><td>"+esc(r.product?.name||"")+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No installations</td></tr>")+"</table>")+
            card("Alarm workflow", high.map(r=>"<p><span class='pill high'>"+esc(r.severity)+"</span> "+esc(r.title)+"</p>").join("") || "<p class=muted>No high-risk alarms</p>")+
            card("System health", "<pre>"+jsonHtml(health)+"</pre>");
        } else if (route === "#/fleet") {
          const rows = await api("/v1/installations");
          const site = new URLSearchParams(location.hash.split("?")[1]||"").get("site");
          const selected = rows.find(r=>r.id===site||r.externalKey===site||r.name===site);
          app.innerHTML = card("Fleet / sites", "<table><tr><th>Name</th><th>Status</th><th>Product</th><th></th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.name)+"</td><td><span class='pill ok'>"+esc(r.status)+"</span></td><td>"+esc(r.product?.name||"")+"</td><td><a href='#/fleet?site="+encodeURIComponent(r.id||r.name)+"'>Drill down</a></td></tr>").join("")||"<tr><td colspan=4 class=muted>No installations</td></tr>")+"</table>") +
            (selected ? card("Site drill-down", "<p><strong>"+esc(selected.name)+"</strong> · "+esc(selected.status)+"</p><p class='muted'>Overview · topology · live power · inverter fleet · meter · battery · export point · weather · curtailment · recommendations · alerts · connectivity</p><p>Devices "+esc((selected.devices||[]).length)+" · Assets "+esc((selected.assets||[]).length)+"</p><pre>"+jsonHtml({topology:selected.topology||null, devices:selected.devices||[], assets:selected.assets||[]})+"</pre>") : "");
        } else if (route === "#/telemetry") {
          app.innerHTML = card("Realtime telemetry", '<form id="tel"><input name="productId" placeholder="product key"/><input name="installationId" placeholder="installation key"/><button>Stream</button></form><canvas id="chart"></canvas><p id="sim" class="warn"></p><pre id="out"></pre>');
          document.getElementById("tel").onsubmit = async (e) => {
            e.preventDefault(); const fd = new FormData(e.target);
            const qs = "tenantId="+encodeURIComponent(state.tenantId)+"&productId="+encodeURIComponent(fd.get("productId"))+"&installationId="+encodeURIComponent(fd.get("installationId"));
            const data = await api("/v1/telemetry?"+qs);
            drawChart(data);
            document.getElementById("sim").textContent = data.some(d=>d.simulated) ? "Includes SIMULATED telemetry — not live plant data." : "Live telemetry only.";
            document.getElementById("out").textContent = JSON.stringify(data.slice(0,5),null,2);
            void streamTelemetry(qs).catch(error => { if(error.name!=="AbortError") document.getElementById("sim").textContent=error.message; });
          };
        } else if (route === "#/users") {
          const rows = await api("/v1/users");
          const roles = await api("/v1/roles");
          const roleOptions = roles.map(r=>"<option value='"+esc(r.key)+"'>"+esc(r.key)+"</option>").join("");
          app.innerHTML = card("Users", "<table><tr><th>Email</th><th>Name</th><th>Status</th><th>Roles</th><th></th></tr>"+(rows.map(r=>{
            const roleKeys=(r.roles||[]).map(x=>x.role?.key).filter(Boolean);
            const self = r.id===state.userId;
            return "<tr><td>"+esc(r.email)+"</td><td>"+esc(r.name)+"</td><td>"+esc(r.status||"active")+"</td><td>"+esc(roleKeys.join(", "))+'</td><td><form data-user="'+esc(r.id)+'" class="role-form"><select name="roleKey" aria-label="Role for '+esc(r.email)+'">'+roleOptions+"</select><button>Assign role</button></form>"+(self?"":" <button class='danger' data-deactivate='"+esc(r.id)+"'>Deactivate</button>")+"</td></tr>";
          }).join("")||"<tr><td colspan=5 class=muted>No users</td></tr>")+"</table>") + card("Invite user", '<form id="inviteUser" class="stack"><input name="name" placeholder="Full name" required/><input name="email" type="email" placeholder="Email" required/><select name="roleKey" aria-label="Starting role">'+roleOptions+"</select><button>Send invite</button><p id='inviteResult' class='muted' role='status'></p></form>");
          document.getElementById("inviteUser").onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const created = await api("/v1/users/invite", { method:"POST", body: JSON.stringify({ name: fd.get("name"), email: fd.get("email"), roleKey: fd.get("roleKey") }) });
            document.getElementById("inviteResult").textContent = created.invitationToken ? ("Invite created. Share this token once: " + created.invitationToken) : "Invitation sent.";
            if (!created.invitationToken) render();
          };
          app.querySelectorAll("form.role-form").forEach(form => form.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            await api("/v1/users/"+encodeURIComponent(form.dataset.user)+"/roles", { method:"POST", body: JSON.stringify({ roleKey: fd.get("roleKey") }) });
            render();
          });
          app.querySelectorAll("button[data-deactivate]").forEach(btn => btn.onclick = async () => {
            if (!confirm("Deactivate this user and revoke their sessions?")) return;
            await api("/v1/users/"+encodeURIComponent(btn.dataset.deactivate)+"/deactivate", { method:"POST" });
            render();
          });
        } else if (route === "#/models") {
          const rows = await api("/v1/models");
          app.innerHTML = card("Model monitoring", "<table><tr><th>Name</th><th>Version</th><th>Status</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.name)+"</td><td>"+esc(r.version)+"</td><td>"+esc(r.status)+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No registered models</td></tr>")+"</table>");
        } else if (route === "#/optimisation") {
          app.innerHTML = card("Predict → Optimise → Simulate", '<form id="opt"><input name="forecastKw" placeholder="forecast kW"/><input name="exportLimitKw" placeholder="export limit"/><input name="loadKw" placeholder="load kW"/><button>Simulate plan</button></form><pre id="out"></pre><p class="muted">Human approval required. Automatic plant execution is outside this release.</p>');
          document.getElementById("opt").onsubmit = async (e) => { e.preventDefault(); const fd=new FormData(e.target); const data=await api("/v1/simulate",{method:"POST",body:JSON.stringify(Object.fromEntries(fd))}); document.getElementById("out").textContent=JSON.stringify(data,null,2); };
        } else if (route === "#/assets") {
          const rows = await api("/v1/installations");
          const assets = rows.flatMap(site => (site.assets||[]).map(asset => ({...asset, site: site.name, siteId: site.id})));
          app.innerHTML = card("Asset drill-down", "<table><tr><th>Asset</th><th>Type</th><th>Site</th><th></th></tr>"+(assets.map(r=>"<tr><td>"+esc(r.name||r.externalRef||r.id)+"</td><td>"+esc(r.type||"")+"</td><td>"+esc(r.site)+"</td><td><a href='#/fleet?site="+encodeURIComponent(r.siteId)+"'>Open site</a></td></tr>").join("")||"<tr><td colspan=4 class=muted>No assets yet. Live telemetry creates inverter/meter records.</td></tr>")+"</table><p class='muted'>Each asset should show live telemetry, expected vs actual, efficiency, alarms, communications, firmware, health score, anomaly history and maintenance records once a named plant is connected.</p>");
        } else if (route === "#/recommendations") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId));
          app.innerHTML = card("Recommendation workflow", '<form id="recFilter" class="stack"><label>Status <input name="status" placeholder="PROPOSED"/></label><label>Type <input name="type"/></label><label>Severity <input name="severity"/></label><button>Filter</button></form>') +
            card("Recommendation timeline", '<div class="timeline">'+(recs.map(r => '<article><p class="muted">'+esc(r.createdAt||"")+' · <span class="pill '+esc(String(r.severity||"").toLowerCase())+'">'+esc(r.severity)+'</span> · '+esc(r.status)+' · expires '+esc(r.expiresAt||"")+'</p><h3>'+esc(r.title)+'</h3><p>'+esc(r.summary)+'</p><p>confidence '+(Number(r.confidence)*100).toFixed(0)+'% · est. kWh '+esc(r.expectedEnergyKwh||0)+' · revenue '+esc(r.expectedRevenue||0)+' · carbon '+esc(r.expectedCarbonKg||0)+'</p><p>'+esc(r.rationale)+'</p><p class="muted">Assumptions: '+esc((r.assumptions||[]).join("; "))+' · Uncertainty: '+esc((r.uncertainties||[]).join("; "))+'</p><p class="warn">'+esc((r.dataQualityWarnings||[]).join("; "))+'</p><button data-id="'+esc(r.id)+'" data-status="ACKNOWLEDGED">Acknowledge</button> <button data-id="'+esc(r.id)+'" data-status="APPROVED">Approve</button> <button class="danger" data-id="'+esc(r.id)+'" data-status="REJECTED">Reject</button></article>').join("") || "<p class=muted>No recommendations</p>")+"</div>");
          document.getElementById("recFilter").onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const qs = ["tenantId="+encodeURIComponent(state.tenantId)];
            if (fd.get("status")) qs.push("status="+encodeURIComponent(fd.get("status")));
            if (fd.get("type")) qs.push("type="+encodeURIComponent(fd.get("type")));
            if (fd.get("severity")) qs.push("severity="+encodeURIComponent(fd.get("severity")));
            const filtered = await api("/v1/recommendations?"+qs.join("&"));
            document.querySelector(".timeline").innerHTML = filtered.map(r => '<article><h3>'+esc(r.title)+'</h3><p>'+esc(r.status)+' · '+esc(r.severity)+'</p></article>').join("") || "<p class=muted>No matching recommendations</p>";
          };
          app.querySelectorAll("button[data-id]").forEach(btn => btn.onclick = async () => {
            const comment = prompt("Decision comment") || "";
            await api("/v1/recommendations/"+btn.dataset.id+"/status", { method:"PATCH", body: JSON.stringify({ tenantId: state.tenantId, status: btn.dataset.status, comment }) });
            render();
          });
        } else if (route === "#/incidents") {
          const rows = await api("/v1/incidents");
          app.innerHTML = card("Incidents", "<p class='muted'>Incidents are not recommendations. Lifecycle: open → acknowledged → assigned → investigating → mitigated → resolved → post-incident review.</p><table><tr><th>Title</th><th>Severity</th><th>Status</th><th></th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.title)+"</td><td>"+esc(r.severity)+"</td><td>"+esc(r.status)+"</td><td><button data-incident='"+esc(r.id)+"'>Acknowledge</button></td></tr>").join("")||"<tr><td colspan=4 class=muted>No incidents</td></tr>")+"</table>") +
            card("Open incident", '<form id="newIncident" class="stack"><input name="title" placeholder="Title" required/><input name="severity" placeholder="HIGH" required/><textarea name="summary" placeholder="Summary"></textarea><button>Create</button></form>');
          document.getElementById("newIncident").onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            await api("/v1/incidents", { method:"POST", body: JSON.stringify({ title: fd.get("title"), severity: fd.get("severity"), summary: fd.get("summary") }) });
            render();
          };
          app.querySelectorAll("button[data-incident]").forEach(btn => btn.onclick = async () => {
            await api("/v1/incidents/"+encodeURIComponent(btn.dataset.incident), { method:"PATCH", body: JSON.stringify({ status: "ACKNOWLEDGED", comment: "Acknowledged from Console" }) });
            render();
          });
        } else if (route === "#/alerts") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId)+"&status=PROPOSED");
          app.innerHTML = card("Alerts centre", recs.filter(r=>r.severity==="HIGH"||r.severity==="CRITICAL").map(r=>"<p><strong>"+esc(r.severity)+"</strong> "+esc(r.title)+' <button data-alert-incident="'+esc(r.id)+'">Open incident</button></p>').join("") || "<p class=muted>No high-risk alerts</p>");
          app.querySelectorAll("button[data-alert-incident]").forEach(btn => btn.onclick = async () => {
            await api("/v1/incidents", { method:"POST", body: JSON.stringify({ title: "Alert "+btn.dataset.alertIncident, severity: "HIGH", recommendationIds: [btn.dataset.alertIncident] }) });
            location.hash = "#/incidents";
          });
        } else if (route === "#/integrations") {
          app.innerHTML = card("Integrations", "<p>GridFlex connector 1.0.0. Simulated telemetry is labelled and cannot be mistaken for live plant data.</p>");
        } else if (route === "#/webhooks") {
          const rows = await api("/v1/webhooks");
          app.innerHTML = card("Webhooks", "<table><tr><th>URL</th><th>Status</th><th>Failures</th><th>Actions</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.url)+"</td><td>"+esc(r.status)+"</td><td>"+esc(r.failureCount)+"</td><td><button data-webhook='"+esc(r.id)+"' data-action='test'>Test</button> <button class='secondary' data-webhook='"+esc(r.id)+"' data-action='rotate'>Rotate secret</button> <button class='secondary' data-webhook='"+esc(r.id)+"' data-action='history'>Deliveries</button></td></tr>").join("")||"<tr><td colspan=4 class=muted>No webhooks</td></tr>")+"</table><form id='wh'><input name='url' aria-label='Webhook URL' placeholder='https://example/webhook'/><button>Add</button></form><pre id='deliveries'></pre>");
          document.getElementById("wh").onsubmit = async (e) => { e.preventDefault(); const fd=new FormData(e.target); await api("/v1/webhooks",{method:"POST",body:JSON.stringify({url:fd.get("url")})}); render(); };
          app.querySelectorAll("button[data-webhook]").forEach(btn => btn.onclick = async () => {
            const id=encodeURIComponent(btn.dataset.webhook);
            if(btn.dataset.action==="test") await api("/v1/webhooks/"+id+"/test",{method:"POST"});
            if(btn.dataset.action==="rotate") { const value=await api("/v1/webhooks/"+id+"/rotate-secret",{method:"POST"}); alert("Copy the new secret now: "+value.secret); }
            if(btn.dataset.action==="history") { const value=await api("/v1/webhooks/"+id+"/deliveries"); document.getElementById("deliveries").textContent=JSON.stringify(value,null,2); }
          });
        } else if (route === "#/credentials") {
          const rows = await api("/v1/credentials");
          app.innerHTML = card("API credentials", "<table><tr><th>Name</th><th>Prefix</th><th>Status</th><th>Expires</th><th>Actions</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.name)+"</td><td>"+esc(r.keyPrefix)+"</td><td>"+esc(r.status)+"</td><td>"+esc(r.expiresAt||"")+"</td><td><button data-credential='"+esc(r.id)+"' data-action='rotate'>Rotate</button> <button class='danger' data-credential='"+esc(r.id)+"' data-action='revoke'>Revoke</button>"+(r.status==="PENDING_APPROVAL"?" <button data-credential='"+esc(r.id)+"' data-action='approve'>Approve</button>":"")+"</td></tr>").join("")||"<tr><td colspan=5 class=muted>No API credentials</td></tr>")+"</table><form id='credential'><input name='name' aria-label='Credential name' placeholder='credential name'/><select name='kind' aria-label='Credential kind'><option>API_INTEGRATION</option><option>SERVICE_ACCOUNT</option><option>DEVICE</option></select><input name='expiryDays' type='number' value='90' min='1' aria-label='Expiry days'/><button>Create</button></form><pre id='created'></pre>");
          document.getElementById("credential").onsubmit=async(e)=>{e.preventDefault();const fd=new FormData(e.target);const value=await api("/v1/credentials",{method:"POST",body:JSON.stringify({name:fd.get("name"),kind:fd.get("kind"),expiryDays:Number(fd.get("expiryDays"))})});document.getElementById("created").textContent=JSON.stringify(value,null,2);};
          app.querySelectorAll("button[data-credential]").forEach(btn=>btn.onclick=async()=>{const id=encodeURIComponent(btn.dataset.credential);await api("/v1/credentials/"+id+"/"+btn.dataset.action,{method:"POST"});render();});
        } else if (route === "#/audit") {
          const rows = await api("/v1/audit");
          app.innerHTML = card("Audit viewer", "<label>Search <input id='auditSearch' type='search'/></label> <button id='auditExport' class='secondary'>Export JSON</button><table id='auditTable'><tr><th>Time</th><th>Event</th><th>Actor</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.createdAt)+"</td><td>"+esc(r.eventType)+"</td><td>"+esc(r.actorType)+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No audit events</td></tr>")+"</table>");
          document.getElementById("auditSearch").oninput=e=>{const query=e.target.value.toLowerCase();document.querySelectorAll("#auditTable tr").forEach((row,index)=>{if(index)row.hidden=!row.textContent.toLowerCase().includes(query);});};
          document.getElementById("auditExport").onclick=()=>{const blob=new Blob([JSON.stringify(rows,null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="zolt-audit-"+state.tenantId+".json";link.click();URL.revokeObjectURL(link.href);};
        } else if (route === "#/reports") {
          const kinds = ["shift","site","fleet","curtailment","recommendation-effectiveness","incident","executive"];
          app.innerHTML = card("Operator reports", kinds.map(kind => "<p><button data-report='"+kind+"'>"+kind+"</button></p>").join("")) + card("Report output", "<pre id='reportOut'>Select a report</pre>");
          app.querySelectorAll("button[data-report]").forEach(btn => btn.onclick = async () => {
            const data = await api("/v1/reports/"+encodeURIComponent(btn.dataset.report));
            document.getElementById("reportOut").textContent = JSON.stringify(data, null, 2);
          });
        } else if (route === "#/health") {
          const health = await api("/v1/health/system"); const queues = await api("/v1/queues/health");
          app.innerHTML = card("System / queue / connector health", "<pre>"+jsonHtml({health,queues})+"</pre>");
        } else if (route === "#/copilot") {
          app.innerHTML = card("Zolt Copilot", '<form id="ask"><textarea name="question" rows="4" placeholder="Ask about a site, device, telemetry or recommendation"></textarea><button>Ask</button></form><pre id="out"></pre>');
          document.getElementById("ask").onsubmit = async (e) => {
            e.preventDefault(); const fd = new FormData(e.target);
            const data = await api("/v1/copilot/ask", { method:"POST", body: JSON.stringify({ question: fd.get("question") }) });
            document.getElementById("out").textContent = JSON.stringify(data,null,2);
          };
        } else if (route === "#/profile") {
          const me=await api("/v1/me"); const sessions=await api("/v1/me/sessions");
          app.innerHTML=card("Profile and sessions","<p>Signed in as <strong>"+esc(me.name||me.email||me.userId||"user")+"</strong></p><p class='muted'>"+esc(me.email||"")+" · Tenant "+esc(me.tenantId)+" · MFA "+(me.mfaEnabled?"enabled":"not enabled")+(me.platformOperator?" · Platform operator with access to every tenant":"")+"</p><table><tr><th>Device</th><th>IP</th><th>Last seen</th><th></th></tr>"+(sessions.map(session=>"<tr><td>"+esc(session.deviceName||session.userAgent||"Unknown")+"</td><td>"+esc(session.ipAddress||"")+"</td><td>"+esc(session.lastSeenAt)+"</td><td><button class='danger' data-session='"+esc(session.id)+"'>Revoke</button></td></tr>").join("")||"<tr><td colspan=4 class=muted>No active sessions</td></tr>")+"</table><p><button id='signOutHere' class='secondary'>Sign out this device</button> <button id='logoutAll' class='danger'>Sign out all sessions</button></p>");
          app.querySelectorAll("button[data-session]").forEach(btn=>btn.onclick=async()=>{await api("/v1/me/sessions/"+encodeURIComponent(btn.dataset.session),{method:"DELETE"});render();});
          document.getElementById("signOutHere").onclick=signOut;
          document.getElementById("logoutAll").onclick=async()=>{try{await api("/v1/me/sessions",{method:"DELETE"});}catch{} clearSession(); location.hash="#/login"; nav(); render();};
        }
      } catch (error) {
        app.innerHTML = card("Error", "<p class='bad' role='alert'>"+esc(error.message)+"</p><button onclick='render()'>Retry</button>");
      }
    }
    window.addEventListener("hashchange", render);
    window.render = render;
    hydrateIdentity().catch((error) => {
      const code = String(error && error.message || "");
      if (code === "UNAUTHORIZED" || code === "401" || code === "ACCOUNT_LOCKED") clearSession();
    }).finally(render);
  </script>
</body>
</html>`;
}
