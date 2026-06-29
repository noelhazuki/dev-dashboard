export async function onRequestGet(context) {
  const data = await context.env.DEV_DASHBOARD_KV.get("dev_dashboard_v2");

  if (data === null) {
    return new Response("[]", {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(data, {
    headers: { "Content-Type": "application/json" }
  });
}
