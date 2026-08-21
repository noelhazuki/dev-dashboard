// src/index.js
const KV_KEY = "dev_dashboard_v2";

// 種類（type）定義
const TYPE_DEF = { APP: true, RES: true, DCK: true, ADM: true };

// 緊急度（アイゼンハワー・マトリクス）の定義
const PRIO_DEF = { urgent_important: true, important: true, urgent: true, neither: true };

// タグ（tags）の固定語彙
const TAGS_LIST = ["ポケカ", "競馬", "生活"];

// ステータスラベル（フロント側 slabel() と同一）
const STATUS_LABELS = { active: "稼働中", wip: "作業中", hold: "保留中", idea: "構想中", cancel: "中止", merged: "統合済み" };
function slabel(s) {
  if (!s) return "不明";
  return STATUS_LABELS[s] || "不明(" + s + ")";
}
function plabel(item) {
  const PRIO_LABELS = { urgent_important: "今すぐ", important: "計画的に", urgent: "サッと", neither: "後回し" };
  return item.priority ? (PRIO_LABELS[item.priority] || "") : "";
}

function nowStr() {
  // JST(UTC+9)固定オフセットで "YYYY-MM-DD HH:MM" を生成
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const iso = jst.toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 16);
}

function findItem(items, appId) {
  return items.find((a) => a.id === appId || a.name === appId) || null;
}

function addGlobalLog(dataObj, note) {
  if (!dataObj.globalLogs) dataObj.globalLogs = [];
  dataObj.globalLogs.unshift({ date: nowStr(), note });
  if (dataObj.globalLogs.length > 50) dataObj.globalLogs = dataObj.globalLogs.slice(0, 50);
}

// ブラウザ側 applyJson() のサーバー実装版。
// バリデーションエラーは throw して呼び出し側でハンドリングする（KVへは反映させない）。
function applyEntry(dataObj, json) {
  const dateStr = json.date || nowStr();
  dataObj.lastUpdated = dateStr.slice(0, 10);

  // new_item はそのまま処理
  if (json.type === "new_item") {
    if (!json.name) {
      const err = new Error("new_item には name が必要です");
      err.code = "invalid_json";
      throw err;
    }
    dataObj.items.push({
      id: json.id || String(json.name).replace(/\s/g, "_") + "_" + Date.now(),
      type: json.itemType && TYPE_DEF[json.itemType] ? json.itemType : "APP",
      tags: json.tags && TAGS_LIST.includes(json.tags) ? json.tags : null,
      name: json.name,
      url: json.url || "",
      status: json.status || "wip",
      statusLabel: slabel(json.status || "wip"),
      fileGroups: json.fileGroups || [],
      currentWork: json.currentWork || null,
      createdAt: dateStr,
      logs: [{ date: dateStr, note: "新規登録" + (json.note ? ": " + json.note : "") }],
    });
    addGlobalLog(dataObj, json.name + " 追加");
    return;
  }

  // 未登録appは自動で登録しない
  const item = findItem(dataObj.items, json.app);
  if (!item) {
    const err = new Error("unknown_app");
    err.code = "unknown_app";
    err.app = json.app;
    throw err;
  }

  // priority / itemType / tags / name / next は type に関係なく反映
  if (json.priority !== undefined) {
    item.priority = json.priority && PRIO_DEF[json.priority] ? json.priority : null;
  }
  if (json.itemType !== undefined) {
    item.type = json.itemType && TYPE_DEF[json.itemType] ? json.itemType : item.type;
  }
  if (json.tags !== undefined) {
    item.tags = json.tags && TAGS_LIST.includes(json.tags) ? json.tags : null;
  }
  if (json.name !== undefined && json.name !== null && String(json.name).trim()) {
    item.name = String(json.name).trim();
  }
  if (json.next !== undefined) {
    if (!item.currentWork) item.currentWork = { summary: "", spec: null, touchingFiles: [] };
    item.currentWork.next = json.next || "";
  }

  switch (json.type) {
    case "log": {
      if (!item.logs) item.logs = [];
      item.logs.push({ date: dateStr, note: json.note });
      if (json.status) {
        item.status = json.status;
        item.statusLabel = slabel(json.status);
      }
      item.lastTouched = dateStr;
      addGlobalLog(dataObj, item.name + " 更新");
      break;
    }
    case "work": {
      item.currentWork = { summary: json.summary || "", spec: json.spec || null, touchingFiles: json.touchingFiles || [] };
      if (!item.logs) item.logs = [];
      item.logs.push({ date: dateStr, note: "作業内容更新: " + (json.summary || "") });
      if (json.status) {
        item.status = json.status;
        item.statusLabel = slabel(json.status);
      }
      item.lastTouched = dateStr;
      addGlobalLog(dataObj, item.name + " 作業内容更新");
      break;
    }
    case "files": {
      if (json.fileGroups) {
        item.fileGroups = json.fileGroups;
      } else if (json.files) {
        item.fileGroups = [{ label: "ファイル", files: json.files }];
      }
      if (!item.logs) item.logs = [];
      item.logs.push({ date: dateStr, note: "ファイル構成更新" });
      item.lastTouched = dateStr;
      addGlobalLog(dataObj, item.name + " ファイル構成更新");
      break;
    }
    case "status": {
      if (!json.status) {
        const err = new Error("statusフィールドが空です");
        err.code = "invalid_json";
        throw err;
      }
      item.status = json.status;
      item.statusLabel = slabel(json.status);
      if (item.statusLabel === json.status) {
        const err = new Error('不明なステータス値: "' + json.status + '"');
        err.code = "invalid_json";
        throw err;
      }
      if (json.mergedInto) item.mergedInto = json.mergedInto;
      if (!item.logs) item.logs = [];
      item.logs.push({ date: dateStr, note: "ステータス → " + item.statusLabel + (json.note ? ": " + json.note : "") });
      item.lastTouched = dateStr;
      addGlobalLog(dataObj, item.name + " ステータス変更 → " + item.statusLabel);
      break;
    }
    case "priority": {
      // priorityフィールドは上で反映済み
      if (!item.logs) item.logs = [];
      item.logs.push({ date: dateStr, note: "緊急度 → " + (plabel(item) || "未設定") });
      item.lastTouched = dateStr;
      addGlobalLog(dataObj, item.name + " 緊急度変更 → " + (plabel(item) || "未設定"));
      break;
    }
    default: {
      const err = new Error('未知のtype: "' + json.type + '"');
      err.code = "unknown_type";
      throw err;
    }
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function checkAuth(request, env) {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.SYNC_TOKEN}`;
}

var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/load" && request.method === "GET") {
      if (!checkAuth(request, env)) {
        return jsonResp({ error: "unauthorized" }, 401);
      }
      const data = await env.DEV_DASHBOARD_KV.get(KV_KEY);
      return new Response(data === null ? "[]" : data, {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/save" && request.method === "POST") {
      if (!checkAuth(request, env)) {
        return jsonResp({ error: "unauthorized" }, 401);
      }
      const body = await request.text();
      await env.DEV_DASHBOARD_KV.put(KV_KEY, body);
      return jsonResp({ success: true });
    }

    if (url.pathname === "/api/import" && request.method === "POST") {
      if (!checkAuth(request, env)) {
        return jsonResp({ success: false, error: "unauthorized" }, 401);
      }

      let payload;
      try {
        const bodyText = await request.text();
        payload = JSON.parse(bodyText);
      } catch (e) {
        return jsonResp({ success: false, error: "invalid_json" }, 400);
      }

      const entries = Array.isArray(payload) ? payload : [payload];

      let dataObj;
      try {
        const raw = await env.DEV_DASHBOARD_KV.get(KV_KEY);
        dataObj = raw ? JSON.parse(raw) : { items: [], lastUpdated: "", globalLogs: [] };
      } catch (e) {
        return jsonResp({ success: false, error: "invalid_json" }, 500);
      }
      if (!Array.isArray(dataObj.items)) dataObj.items = [];

      // 全件検証後に反映：1件でも失敗したらKVへは一切書き込まない
      for (const entry of entries) {
        try {
          applyEntry(dataObj, entry);
        } catch (e) {
          if (e.code === "unknown_app") {
            return jsonResp({ success: false, error: "unknown_app", app: e.app }, 400);
          }
          if (e.code === "unknown_type") {
            return jsonResp({ success: false, error: "unknown_type" }, 400);
          }
          return jsonResp({ success: false, error: "invalid_json", message: e.message }, 400);
        }
      }

      await env.DEV_DASHBOARD_KV.put(KV_KEY, JSON.stringify(dataObj));
      return jsonResp({ success: true, count: entries.length });
    }

    return env.ASSETS.fetch(request);
  },
};
export { index_default as default };
