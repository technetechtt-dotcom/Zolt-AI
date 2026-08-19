export function consoleHtml(apiBase: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Zolt Console</title>
  <style>
    :root { color-scheme:dark; --bg:#0b1220; --panel:#121a2b; --ink:#e8eefc; --muted:#93a0bf; --accent:#3ee0b2; --warn:#ffb020; --bad:#ff5d6c; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Segoe UI,sans-serif; background:var(--bg); color:var(--ink); }
    header { display:flex; gap:16px; flex-wrap:wrap; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid #243049; }
    nav { display:flex; gap:14px; overflow-x:auto; flex:1; }
    nav a { color:var(--muted); margin-right:14px; text-decoration:none; }
    nav a.active, nav a:hover { color:var(--accent); }
    main { padding:24px; display:grid; gap:16px; }
    .card { background:var(--panel); padding:16px; border-radius:12px; }
    input, select, textarea, button { padding:8px 10px; border-radius:8px; border:1px solid #31405f; background:#0f1728; color:var(--ink); }
    button { background:var(--accent); color:#06281f; font-weight:700; cursor:pointer; }
    button.danger { background:var(--bad); color:white; }
    button.secondary { background:#243049; color:var(--ink); }
    :focus-visible { outline:3px solid var(--warn); outline-offset:2px; }
    table { width:100%; border-collapse:collapse; display:block; overflow-x:auto; }
    th, td { text-align:left; padding:8px; border-bottom:1px solid #243049; font-size:14px; }
    .muted { color:var(--muted); }
    .warn { color:var(--warn); }
    .bad { color:var(--bad); }
    canvas { width:100%; height:180px; background:#0f1728; border-radius:8px; }
    form { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .loading { min-height:120px; display:grid; place-items:center; }
    @media (max-width:760px) { header { align-items:flex-start; padding:12px; } main { padding:12px; } nav { order:4; flex-basis:100%; } input, select, textarea, button { max-width:100%; } }
    @media (prefers-color-scheme:light) { :root { color-scheme:light; --bg:#f3f6fa; --panel:#fff; --ink:#142033; --muted:#5a6680; } input, select, textarea { background:white; color:var(--ink); } }
  </style>
</head>
<body>
  <header>
    <strong>Zolt Console</strong>
    <nav id="nav"></nav>
    <label class="muted">Tenant <select id="tenantSwitch" aria-label="Active tenant"></select></label>
    <span id="who" class="muted"></span>
  </header>
  <main id="app"></main>
  <script>
    const API = ${JSON.stringify(apiBase)};
    const pages = [
      ["#/login","Login"],["#/command","Command Centre"],["#/fleet","Fleet"],["#/telemetry","Telemetry"],
      ["#/recommendations","Recommendations"],["#/alerts","Alerts"],["#/integrations","Integrations"],
      ["#/webhooks","Webhooks"],["#/credentials","API credentials"],["#/users","Users"],["#/audit","Audit"],
      ["#/reports","Reports"],["#/health","System health"],["#/models","Models"],["#/optimisation","Optimisation"],["#/copilot","Copilot"],["#/profile","Profile"]
    ];
    const state = { token: localStorage.getItem("zoltToken") || "", tenantId: localStorage.getItem("zoltTenant") || "", permissions: [] };
    function headers() {
      const h = { "content-type":"application/json" };
      if (state.token) h.authorization = "Bearer " + state.token;
      return h;
    }
    async function api(path, opts={}) {
      const res = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts.headers||{}) } });
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
      document.getElementById("nav").innerHTML = pages.filter(([href]) => !adminOnly.has(href) || state.permissions.includes("admin:manage") || (href==="#/audit" && state.permissions.includes("audit:read"))).map(([href,label]) =>
        '<a href="'+href+'" class="'+(location.hash===href?'active':'')+'">'+label+'</a>'
      ).join("");
      document.getElementById("who").textContent = state.tenantId ? ("Tenant " + state.tenantId) : "Signed out";
    }
    function card(title, body) { return '<section class="card"><h2>'+title+'</h2>'+body+'</section>'; }
    async function hydrateIdentity() {
      if (!state.token) return;
      const me = await api("/v1/me");
      state.permissions = me.permissions || [];
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
      const route = location.hash || "#/login";
      try {
        app.innerHTML = card("Loading", '<p class="loading muted" role="status">Loading tenant data…</p>');
        if (route === "#/login") {
          app.innerHTML = card("Login", '<form id="login"><input name="email" type="email" autocomplete="username" placeholder="email" required/><input name="password" type="password" autocomplete="current-password" placeholder="password" required/><input name="totpCode" inputmode="numeric" autocomplete="one-time-code" placeholder="MFA code (if enabled)"/><input name="tenantId" placeholder="tenant id (optional)"/><button>Sign in</button></form><p class="muted">Advisory-only. No plant control.</p>');
          document.getElementById("login").onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const result = await api("/v1/auth/login", { method:"POST", body: JSON.stringify(Object.fromEntries(fd)) });
            state.token = result.token; state.tenantId = result.tenantId;
            localStorage.setItem("zoltToken", result.token); localStorage.setItem("zoltTenant", result.tenantId);
            await hydrateIdentity();
            location.hash = "#/command";
          };
          return;
        }
        if (!state.token) { location.hash = "#/login"; return; }
        if (route === "#/command") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId));
          const health = await api("/v1/health/system");
          app.innerHTML = card("Command Centre", "<p>Open recommendations: "+recs.length+"</p><pre>"+jsonHtml(health)+"</pre>");
        } else if (route === "#/fleet") {
          const rows = await api("/v1/installations");
          app.innerHTML = card("Fleet / sites", "<table><tr><th>Name</th><th>Status</th><th>Product</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.name)+"</td><td>"+esc(r.status)+"</td><td>"+esc(r.product?.name||"")+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No installations</td></tr>")+"</table>");
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
          app.innerHTML = card("Users and RBAC", "<table><tr><th>Email</th><th>Name</th><th>Roles</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.email)+"</td><td>"+esc(r.name)+"</td><td>"+esc((r.roles||[]).map(x=>x.role?.key).join(", "))+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No users</td></tr>")+"</table><form id='role'><input name='userId' aria-label='User ID' placeholder='user id'/><select name='roleKey' aria-label='Tenant role'>"+roles.map(r=>"<option>"+esc(r.key)+"</option>").join("")+"</select><button>Assign tenant role</button></form>");
          document.getElementById("role").onsubmit = async (e) => { e.preventDefault(); const fd=new FormData(e.target); await api("/v1/users/"+encodeURIComponent(fd.get("userId"))+"/roles",{method:"POST",body:JSON.stringify({roleKey:fd.get("roleKey")})}); render(); };
        } else if (route === "#/models") {
          const rows = await api("/v1/models");
          app.innerHTML = card("Model monitoring", "<table><tr><th>Name</th><th>Version</th><th>Status</th></tr>"+(rows.map(r=>"<tr><td>"+esc(r.name)+"</td><td>"+esc(r.version)+"</td><td>"+esc(r.status)+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No registered models</td></tr>")+"</table>");
        } else if (route === "#/optimisation") {
          app.innerHTML = card("Advisory optimisation", '<form id="opt"><input name="forecastKw" placeholder="forecast kW"/><input name="exportLimitKw" placeholder="export limit"/><input name="loadKw" placeholder="load kW"/><button>Optimise</button></form><pre id="out"></pre><p class="muted">Advisory only. No plant dispatch.</p>');
          document.getElementById("opt").onsubmit = async (e) => { e.preventDefault(); const fd=new FormData(e.target); const data=await api("/v1/optimisation",{method:"POST",body:JSON.stringify(Object.fromEntries(fd))}); document.getElementById("out").textContent=JSON.stringify(data,null,2); };
        } else if (route === "#/recommendations") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId));
          app.innerHTML = card("Recommendations", recs.map(r => '<article class="card"><h3>'+esc(r.title)+'</h3><p>'+esc(r.summary)+'</p><p>Severity '+esc(r.severity)+' · confidence '+(Number(r.confidence)*100).toFixed(0)+'%</p><p>'+esc(r.rationale)+'</p><p class="muted">Assumptions: '+esc((r.assumptions||[]).join("; "))+'</p><p class="warn">'+esc((r.dataQualityWarnings||[]).join("; "))+'</p><button data-id="'+esc(r.id)+'" data-status="ACKNOWLEDGED">Acknowledge</button> <button data-id="'+esc(r.id)+'" data-status="APPROVED">Approve</button> <button class="danger" data-id="'+esc(r.id)+'" data-status="REJECTED">Reject</button></article>').join("") || "<p class=muted>No recommendations</p>");
          app.querySelectorAll("button[data-id]").forEach(btn => btn.onclick = async () => {
            const comment = prompt("Decision comment") || "";
            await api("/v1/recommendations/"+btn.dataset.id+"/status", { method:"PATCH", body: JSON.stringify({ tenantId: state.tenantId, status: btn.dataset.status, comment }) });
            render();
          });
        } else if (route === "#/alerts") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId)+"&status=PROPOSED");
          app.innerHTML = card("Alerts centre", recs.filter(r=>r.severity==="HIGH"||r.severity==="CRITICAL").map(r=>"<p><strong>"+esc(r.severity)+"</strong> "+esc(r.title)+"</p>").join("") || "<p class=muted>No high-risk alerts</p>");
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
          app.innerHTML = card("Reports", "<p>Use recommendations, telemetry and audit APIs to generate shift, site and executive reports. Copilot can draft summaries without issuing plant commands.</p>");
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
          app.innerHTML=card("Profile and sessions","<p>Signed in as "+esc(me.userId||"user")+"</p><p class='muted'>Tenant: "+esc(me.tenantId)+" · MFA: "+(me.mfaEnabled?"enabled":"not enabled")+"</p><table><tr><th>Device</th><th>IP</th><th>Last seen</th><th></th></tr>"+(sessions.map(session=>"<tr><td>"+esc(session.deviceName||session.userAgent||"Unknown")+"</td><td>"+esc(session.ipAddress||"")+"</td><td>"+esc(session.lastSeenAt)+"</td><td><button class='danger' data-session='"+esc(session.id)+"'>Revoke</button></td></tr>").join("")||"<tr><td colspan=4 class=muted>No active sessions</td></tr>")+"</table><button id='logoutAll' class='danger'>Log out all sessions</button>");
          app.querySelectorAll("button[data-session]").forEach(btn=>btn.onclick=async()=>{await api("/v1/me/sessions/"+encodeURIComponent(btn.dataset.session),{method:"DELETE"});render();});
          document.getElementById("logoutAll").onclick=async()=>{await api("/v1/me/sessions",{method:"DELETE"});localStorage.removeItem("zoltToken");state.token="";location.hash="#/login";};
        }
      } catch (error) {
        app.innerHTML = card("Error", "<p class='bad' role='alert'>"+esc(error.message)+"</p><button onclick='render()'>Retry</button>");
      }
    }
    window.addEventListener("hashchange", render);
    hydrateIdentity().catch(()=>{}).finally(render);
  </script>
</body>
</html>`;
}
