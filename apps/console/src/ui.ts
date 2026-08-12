export function consoleHtml(apiBase: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Zolt Console</title>
  <style>
    :root { --bg:#0b1220; --panel:#121a2b; --ink:#e8eefc; --muted:#93a0bf; --accent:#3ee0b2; --warn:#ffb020; --bad:#ff5d6c; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Segoe UI,sans-serif; background:var(--bg); color:var(--ink); }
    header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid #243049; }
    nav a { color:var(--muted); margin-right:14px; text-decoration:none; }
    nav a.active, nav a:hover { color:var(--accent); }
    main { padding:24px; display:grid; gap:16px; }
    .card { background:var(--panel); padding:16px; border-radius:12px; }
    input, select, textarea, button { padding:8px 10px; border-radius:8px; border:1px solid #31405f; background:#0f1728; color:var(--ink); }
    button { background:var(--accent); color:#06281f; font-weight:700; cursor:pointer; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:8px; border-bottom:1px solid #243049; font-size:14px; }
    .muted { color:var(--muted); }
    .warn { color:var(--warn); }
    .bad { color:var(--bad); }
    pre { white-space:pre-wrap; }
  </style>
</head>
<body>
  <header>
    <strong>Zolt Console</strong>
    <nav id="nav"></nav>
    <span id="who" class="muted"></span>
  </header>
  <main id="app"></main>
  <script>
    const API = ${JSON.stringify(apiBase)};
    const pages = [
      ["#/login","Login"],["#/command","Command Centre"],["#/fleet","Fleet"],["#/telemetry","Telemetry"],
      ["#/recommendations","Recommendations"],["#/alerts","Alerts"],["#/integrations","Integrations"],
      ["#/webhooks","Webhooks"],["#/credentials","API credentials"],["#/users","Users"],["#/audit","Audit"],
      ["#/reports","Reports"],["#/health","System health"],["#/copilot","Copilot"]
    ];
    const state = { token: localStorage.getItem("zoltToken") || "", tenantId: localStorage.getItem("zoltTenant") || "" };
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
    function nav() {
      document.getElementById("nav").innerHTML = pages.map(([href,label]) =>
        '<a href="'+href+'" class="'+(location.hash===href?'active':'')+'">'+label+'</a>'
      ).join("");
      document.getElementById("who").textContent = state.tenantId ? ("Tenant " + state.tenantId) : "Signed out";
    }
    function card(title, body) { return '<section class="card"><h2>'+title+'</h2>'+body+'</section>'; }
    async function render() {
      nav();
      const app = document.getElementById("app");
      const route = location.hash || "#/login";
      try {
        if (route === "#/login") {
          app.innerHTML = card("Login", '<form id="login"><input name="email" placeholder="email" value="admin@zolt.local"/><input name="password" type="password" placeholder="password"/><input name="tenantId" placeholder="tenant id"/><button>Sign in</button></form><p class="muted">Advisory-only. No plant control.</p>');
          document.getElementById("login").onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const result = await api("/v1/auth/login", { method:"POST", body: JSON.stringify(Object.fromEntries(fd)) });
            state.token = result.token; state.tenantId = result.tenantId;
            localStorage.setItem("zoltToken", result.token); localStorage.setItem("zoltTenant", result.tenantId);
            location.hash = "#/command";
          };
          return;
        }
        if (!state.token) { location.hash = "#/login"; return; }
        if (route === "#/command") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId));
          const health = await api("/v1/health/system");
          app.innerHTML = card("Command Centre", "<p>Open recommendations: "+recs.length+"</p><pre>"+JSON.stringify(health,null,2)+"</pre>");
        } else if (route === "#/fleet") {
          const rows = await api("/v1/installations");
          app.innerHTML = card("Fleet / sites", "<table><tr><th>Name</th><th>Status</th><th>Product</th></tr>"+(rows.map(r=>"<tr><td>"+r.name+"</td><td>"+r.status+"</td><td>"+(r.product?.name||"")+"</td></tr>").join("")||"<tr><td colspan=3 class=muted>No installations</td></tr>")+"</table>");
        } else if (route === "#/telemetry") {
          app.innerHTML = card("Telemetry", '<form id="tel"><input name="productId" placeholder="product key"/><input name="installationId" placeholder="installation key"/><button>Load</button></form><pre id="out"></pre>');
          document.getElementById("tel").onsubmit = async (e) => {
            e.preventDefault(); const fd = new FormData(e.target);
            const data = await api("/v1/telemetry?tenantId="+encodeURIComponent(state.tenantId)+"&productId="+fd.get("productId")+"&installationId="+fd.get("installationId"));
            document.getElementById("out").textContent = JSON.stringify(data,null,2);
          };
        } else if (route === "#/recommendations") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId));
          app.innerHTML = card("Recommendations", recs.map(r => '<article class="card"><h3>'+r.title+'</h3><p>'+r.summary+'</p><p>Severity '+r.severity+' · confidence '+(r.confidence*100).toFixed(0)+'%</p><p>'+r.rationale+'</p><p class="muted">Assumptions: '+(r.assumptions||[]).join("; ")+'</p><p class="warn">'+(r.dataQualityWarnings||[]).join("; ")+'</p><button data-id="'+r.id+'" data-status="ACKNOWLEDGED">Acknowledge</button> <button data-id="'+r.id+'" data-status="APPROVED">Approve</button> <button data-id="'+r.id+'" data-status="REJECTED">Reject</button></article>').join("") || "<p class=muted>None</p>");
          app.querySelectorAll("button[data-id]").forEach(btn => btn.onclick = async () => {
            const comment = prompt("Decision comment") || "";
            await api("/v1/recommendations/"+btn.dataset.id+"/status", { method:"PATCH", body: JSON.stringify({ tenantId: state.tenantId, status: btn.dataset.status, comment }) });
            render();
          });
        } else if (route === "#/alerts") {
          const recs = await api("/v1/recommendations?tenantId="+encodeURIComponent(state.tenantId)+"&status=PROPOSED");
          app.innerHTML = card("Alerts centre", recs.filter(r=>r.severity==="HIGH"||r.severity==="CRITICAL").map(r=>"<p><strong>"+r.severity+"</strong> "+r.title+"</p>").join("") || "<p class=muted>No high-risk alerts</p>");
        } else if (route === "#/integrations") {
          app.innerHTML = card("Integrations", "<p>GridFlex connector 1.0.0. Simulated telemetry is labelled and cannot be mistaken for live plant data.</p>");
        } else if (route === "#/webhooks") {
          const rows = await api("/v1/webhooks");
          app.innerHTML = card("Webhooks", "<table><tr><th>URL</th><th>Status</th><th>Failures</th></tr>"+rows.map(r=>"<tr><td>"+r.url+"</td><td>"+r.status+"</td><td>"+r.failureCount+"</td></tr>").join("")+"</table><form id='wh'><input name='url' placeholder='https://example/webhook'/><button>Add</button></form>");
          document.getElementById("wh").onsubmit = async (e) => { e.preventDefault(); const fd=new FormData(e.target); await api("/v1/webhooks",{method:"POST",body:JSON.stringify({url:fd.get("url")})}); render(); };
        } else if (route === "#/credentials") {
          const rows = await api("/v1/credentials");
          app.innerHTML = card("API credentials", "<table><tr><th>Name</th><th>Prefix</th><th>Status</th><th>Last used</th></tr>"+rows.map(r=>"<tr><td>"+r.name+"</td><td>"+r.keyPrefix+"</td><td>"+r.status+"</td><td>"+(r.lastUsedAt||"")+"</td></tr>").join("")+"</table>");
        } else if (route === "#/users") {
          const rows = await api("/v1/users");
          app.innerHTML = card("Users and roles", "<table><tr><th>Email</th><th>Name</th></tr>"+rows.map(r=>"<tr><td>"+r.email+"</td><td>"+r.name+"</td></tr>").join("")+"</table>");
        } else if (route === "#/audit") {
          const rows = await api("/v1/audit");
          app.innerHTML = card("Audit viewer", "<table><tr><th>Time</th><th>Event</th><th>Actor</th></tr>"+rows.map(r=>"<tr><td>"+r.createdAt+"</td><td>"+r.eventType+"</td><td>"+r.actorType+"</td></tr>").join("")+"</table>");
        } else if (route === "#/reports") {
          app.innerHTML = card("Reports", "<p>Use recommendations, telemetry and audit APIs to generate shift, site and executive reports. Copilot can draft summaries without issuing plant commands.</p>");
        } else if (route === "#/health") {
          const health = await api("/v1/health/system");
          app.innerHTML = card("System / queue / connector health", "<pre>"+JSON.stringify(health,null,2)+"</pre>");
        } else if (route === "#/copilot") {
          app.innerHTML = card("Zolt Copilot", '<form id="ask"><textarea name="question" rows="4" placeholder="Ask about a site, device, telemetry or recommendation"></textarea><button>Ask</button></form><pre id="out"></pre>');
          document.getElementById("ask").onsubmit = async (e) => {
            e.preventDefault(); const fd = new FormData(e.target);
            const data = await api("/v1/copilot/ask", { method:"POST", body: JSON.stringify({ question: fd.get("question") }) });
            document.getElementById("out").textContent = JSON.stringify(data,null,2);
          };
        }
      } catch (error) {
        app.innerHTML = card("Error", "<p class='bad'>"+error.message+"</p>");
      }
    }
    window.addEventListener("hashchange", render);
    render();
  </script>
</body>
</html>`;
}
