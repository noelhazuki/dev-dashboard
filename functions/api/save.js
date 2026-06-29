export async function onRequestPost(context) {
  const body = await context.request.text();

  await context.env.DEV_DASHBOARD_KV.put("dev_dashboard_v2", body);

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
}
