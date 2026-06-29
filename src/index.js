export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/load" && request.method === "GET") {
      const data = await env.DEV_DASHBOARD_KV.get("dev_dashboard_v2");
      return new Response(data === null ? "[]" : data, {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/api/save" && request.method === "POST") {
      const body = await request.text();
      await env.DEV_DASHBOARD_KV.put("dev_dashboard_v2", body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
