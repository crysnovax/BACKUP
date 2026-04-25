// CRYSNOVA Backup & Restore API
// Deploy to Cloudflare Workers with KV namespace "BACKUP_KV"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function cleanPhone(phone) {
  return String(phone).replace(/[^0-9]/g, '');
}

// ✅ Fixed: No Buffer needed - uses browser-compatible encoding
function encrypt(text, password) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
  }
  return btoa(unescape(encodeURIComponent(result)));
}

function decrypt(encrypted, password) {
  try {
    const text = decodeURIComponent(escape(atob(encrypted)));
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
    }
    return result;
  } catch (e) {
    return null;
  }
}

// ==================== BACKUP HANDLERS ====================
async function handleBackupExists(env, phone) {
  const key = `backup:${cleanPhone(phone)}`;
  const existing = await env.BACKUP_KV.get(key);
  
  if (existing) {
    const parsed = JSON.parse(existing);
    return jsonResponse({
      exists: true,
      phone: cleanPhone(phone),
      timestamp: new Date(parsed.timestamp).toISOString(),
      size: parsed.size
    });
  }
  
  return jsonResponse({ exists: false });
}

async function handleBackupSave(env, phone, password, data) {
  try {
    const key = `backup:${cleanPhone(phone)}`;
    const dataStr = JSON.stringify(data);
    const encrypted = encrypt(dataStr, password);
    
    const backup = {
      phone: cleanPhone(phone),
      encrypted: encrypted,
      timestamp: Date.now(),
      size: encrypted.length
    };

    await env.BACKUP_KV.put(key, JSON.stringify(backup));
    
    return jsonResponse({
      message: 'Backup saved successfully!',
      timestamp: new Date().toISOString(),
      size: encrypted.length
    });
  } catch (err) {
    console.error('[SAVE ERROR]', err.message);
    return errorResponse('Failed to save backup: ' + err.message, 500);
  }
}

async function handleBackupLoad(env, phone, password) {
  try {
    const key = `backup:${cleanPhone(phone)}`;
    const existing = await env.BACKUP_KV.get(key);
    
    if (!existing) {
      return errorResponse('No backup found for this phone number');
    }

    const parsed = JSON.parse(existing);
    const decrypted = decrypt(parsed.encrypted, password);
    
    if (!decrypted || decrypted.length < 10) {
      return errorResponse('Wrong password! Cannot decrypt backup.');
    }

    const data = JSON.parse(decrypted);
    
    return jsonResponse({
      message: 'Backup loaded successfully!',
      data: data,
      timestamp: new Date(parsed.timestamp).toISOString()
    });
  } catch (err) {
    console.error('[LOAD ERROR]', err.message);
    return errorResponse('Wrong password or corrupted backup');
  }
}

async function handleBackupDelete(env, phone, password) {
  const key = `backup:${cleanPhone(phone)}`;
  const existing = await env.BACKUP_KV.get(key);
  
  if (!existing) return errorResponse('No backup found for this phone number');

  const parsed = JSON.parse(existing);
  const decrypted = decrypt(parsed.encrypted, password);
  
  if (!decrypted) return errorResponse('Wrong password! Cannot delete backup.');

  await env.BACKUP_KV.delete(key);
  
  return jsonResponse({ message: 'Backup deleted successfully!' });
}

// ==================== ADMIN HANDLERS ====================
async function handleAdminStats(env) {
  try {
    const backups = [];
    const list = await env.BACKUP_KV.list({ prefix: 'backup:' });
    
    for (const key of list.keys) {
      const data = await env.BACKUP_KV.get(key.name);
      if (data) {
        const parsed = JSON.parse(data);
        backups.push({
          phone: parsed.phone,
          timestamp: new Date(parsed.timestamp).toISOString(),
          size: parsed.size
        });
      }
    }

    return jsonResponse({
      totalBackups: backups.length,
      backups: backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    });
  } catch (e) {
    return jsonResponse({ totalBackups: 0, backups: [] });
  }
}

async function handleAdminDeleteByPhone(env, phone) {
  const key = `backup:${cleanPhone(phone)}`;
  await env.BACKUP_KV.delete(key);
  return jsonResponse({ message: `Backup for ${phone} deleted!` });
}

// ==================== FRONTEND ====================
const LANDING_HTML = `<!DOCTYPE html><html><head><title>💾 Backup API</title><style>body{background:#060a08;color:#8b5cf6;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}h1{font-size:3rem}</style></head><body><div style="text-align:center"><span style="font-size:5rem">💾</span><h1>CRYSNOVA Backup API</h1><p>Running ✅</p></div></body></html>`;
const ADMIN_LOGIN = `<!DOCTYPE html><html><head><title>Login</title><style>body{background:#060a08;color:#e2f5e8;font-family:Inter;display:flex;justify-content:center;align-items:center;height:100vh}.box{background:rgba(30,20,50,0.9);border:1px solid #8b5cf6;padding:2rem;border-radius:20px;text-align:center;width:350px}h2{color:#8b5cf6}input{background:#1a102a;border:1px solid #8b5cf6;color:#e2f5e8;padding:0.8rem;border-radius:10px;width:100%;margin:1rem 0}button{background:#8b5cf6;color:#fff;border:none;padding:0.8rem 2rem;border-radius:30px;cursor:pointer;font-weight:bold}</style></head><body><div class="box"><h2>🔐 Admin Login</h2><input type="password" id="pwd" placeholder="Password"><button onclick="login()">Login</button><p id="error" style="color:#ef4444"></p></div><script>async function login(){const p=document.getElementById("pwd").value;const r=await fetch("/admin/stats",{headers:{"X-Admin-Key":p}});if(r.ok){localStorage.setItem("ak",p);window.location.href="/admin/dashboard"}else document.getElementById("error").textContent="Wrong password"}</script></body></html>`;
const ADMIN_DASH = `<!DOCTYPE html><html><head><title>Dashboard</title><style>body{background:#060a08;color:#e2f5e8;font-family:Inter;padding:1.5rem}h1{color:#8b5cf6}.card{background:rgba(30,20,50,0.7);border:1px solid rgba(139,92,246,0.2);border-radius:16px;padding:1.5rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th,td{padding:0.7rem;border-bottom:1px solid rgba(139,92,246,0.1);text-align:left}th{background:rgba(139,92,246,0.1);color:#8b5cf6}button{background:#ef4444;color:#fff;border:none;padding:0.5rem 1rem;border-radius:8px;cursor:pointer}.logout{float:right;color:#8b7aaa;cursor:pointer;text-decoration:underline}</style></head><body><div style="max-width:1000px;margin:0 auto"><h1>💾 Backup Admin <span class="logout" onclick="logout()">Logout</span></h1><div class="card"><h2>Delete Backup</h2><input id="phone" placeholder="Phone"><button onclick="del()">Delete</button><p id="status"></p></div><div class="card"><h2>All Backups</h2><table id="t"><tr><th>Phone</th><th>Date</th></tr></table></div></div><script>const ak=localStorage.getItem("ak");if(!ak)window.location.href="/admin";function logout(){localStorage.removeItem("ak");window.location.href="/admin"}async function api(u,m="GET",b=null){const h={"X-Admin-Key":ak};if(b)h["Content-Type"]="application/json";const r=await fetch(u,{method:m,headers:h,body:b?JSON.stringify(b):undefined});return r.json()}async function load(){const d=await api("/admin/stats");const t=document.getElementById("t");t.innerHTML="<tr><th>Phone</th><th>Date</th></tr>";if(d.backups)d.backups.forEach(b=>{t.innerHTML+="<tr><td>"+b.phone+"</td><td>"+new Date(b.timestamp).toLocaleString()+"</td></tr>"})}async function del(){const p=document.getElementById("phone").value.trim();if(!p)return;await api("/admin/delete","POST",{phone:p});document.getElementById("status").textContent="Deleted!";load()}load()</script></body></html>`;

// ==================== ROUTER ====================
const ROUTES = {
  'POST /backup/exists': (e, b) => handleBackupExists(e, b.phone),
  'POST /backup/save': (e, b) => handleBackupSave(e, b.phone, b.password, b.data),
  'POST /backup/load': (e, b) => handleBackupLoad(e, b.phone, b.password),
  'POST /backup/delete': (e, b) => handleBackupDelete(e, b.phone, b.password),
  'GET /admin/stats': async (e, r) => r.headers.get('X-Admin-Key') === e.ADMIN_PASSWORD ? handleAdminStats(e) : errorResponse('Unauthorized', 401),
  'POST /admin/delete': async (e, r) => {
    if (r.headers.get('X-Admin-Key') !== e.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const b = await r.json();
    return handleAdminDeleteByPhone(e, b.phone);
  },
};

// ==================== MAIN ====================
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/') return new Response(LANDING_HTML, { headers: { 'Content-Type': 'text/html' } });
    if (method === 'GET' && path === '/admin') return new Response(ADMIN_LOGIN, { headers: { 'Content-Type': 'text/html' } });
    if (method === 'GET' && path === '/admin/dashboard') return new Response(ADMIN_DASH, { headers: { 'Content-Type': 'text/html' } });

    let body = {};
    if (method === 'POST') { try { body = await request.json(); } catch(e) {} }

    if (path.startsWith('/admin/')) {
      const h = ROUTES[`${method} ${path}`];
      return h ? h(env, request) : errorResponse('Not found', 404);
    }

    const h = ROUTES[`${method} ${path}`];
    if (!h) return errorResponse('Not found', 404);
    try { return await h(env, body); } catch (err) { return errorResponse('Error: ' + err.message, 500); }
  }
};
