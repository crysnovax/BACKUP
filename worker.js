// CRYSNOVA Backup & Restore API
// Deploy to Cloudflare Workers with KV namespace "BACKUP_KV"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Phone, X-Backup-Password, X-Admin-Key',
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

// XOR encryption
function encrypt(text, password) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
  }
  return Buffer.from(result).toString('base64');
}

function decrypt(encrypted, password) {
  try {
    const text = Buffer.from(encrypted, 'base64').toString();
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
  const key = `backup:${cleanPhone(phone)}`;
  const dataStr = JSON.stringify(data);
  const encrypted = encrypt(dataStr, password);
  
  const backup = {
    phone: cleanPhone(phone),
    encrypted: encrypted,
    timestamp: Date.now(),
    size: encrypted.length,
    version: '1.0'
  };

  await env.BACKUP_KV.put(key, JSON.stringify(backup));
  
  return jsonResponse({
    message: 'Backup saved successfully!',
    timestamp: new Date().toISOString(),
    size: encrypted.length
  });
}

async function handleBackupLoad(env, phone, password) {
  const key = `backup:${cleanPhone(phone)}`;
  const existing = await env.BACKUP_KV.get(key);
  
  if (!existing) return errorResponse('No backup found');

  try {
    const parsed = JSON.parse(existing);
    const decrypted = decrypt(parsed.encrypted, password);
    
    if (!decrypted) return errorResponse('Wrong password!');

    const data = JSON.parse(decrypted);
    
    return jsonResponse({
      message: 'Backup loaded successfully!',
      data: data,
      timestamp: new Date(parsed.timestamp).toISOString()
    });
  } catch (e) {
    return errorResponse('Wrong password or corrupted backup');
  }
}

async function handleBackupDelete(env, phone, password) {
  const key = `backup:${cleanPhone(phone)}`;
  const existing = await env.BACKUP_KV.get(key);
  
  if (!existing) return errorResponse('No backup found');

  const parsed = JSON.parse(existing);
  const decrypted = decrypt(parsed.encrypted, password);
  
  if (!decrypted) return errorResponse('Wrong password!');

  await env.BACKUP_KV.delete(key);
  
  return jsonResponse({ message: 'Backup deleted successfully!' });
}

// ==================== ADMIN HANDLERS ====================
async function handleAdminStats(env) {
  try {
    const backups = [];
    const list = await env.BACKUP_KV.list({ prefix: 'backup:' });
    
    let totalSize = 0;
    for (const key of list.keys) {
      const data = await env.BACKUP_KV.get(key.name);
      if (data) {
        const parsed = JSON.parse(data);
        backups.push({
          phone: parsed.phone,
          timestamp: new Date(parsed.timestamp).toISOString(),
          size: parsed.size,
          version: parsed.version
        });
        totalSize += parsed.size;
      }
    }

    return jsonResponse({
      totalBackups: backups.length,
      totalSize: totalSize,
      totalSizeFormatted: formatSize(totalSize),
      backups: backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    });
  } catch (e) {
    return jsonResponse({ totalBackups: 0, totalSize: 0, backups: [] });
  }
}

async function handleAdminDeleteByPhone(env, phone) {
  const key = `backup:${cleanPhone(phone)}`;
  const existing = await env.BACKUP_KV.get(key);
  
  if (!existing) return errorResponse('No backup found for this phone');
  
  await env.BACKUP_KV.delete(key);
  return jsonResponse({ message: `Backup for ${phone} deleted!` });
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// ==================== LANDING PAGE ====================
const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>💾 CRYSNOVA Backup API</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060a08;min-height:100vh;font-family:'Inter',sans-serif;color:#e2f5e8;overflow-x:hidden;position:relative}
    .bg-animation{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
    .bg-circle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,0.06),transparent 70%);animation:floatCircle 20s infinite ease-in-out}
    .bg-circle:nth-child(1){width:600px;height:600px;top:-200px;left:-100px;animation-delay:0s}
    .bg-circle:nth-child(2){width:500px;height:500px;bottom:-150px;right:-150px;animation-delay:-7s}
    @keyframes floatCircle{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-30px) scale(1.05)}}
    .container{max-width:1100px;margin:0 auto;position:relative;z-index:2;padding:2rem}
    .header{text-align:center;margin-bottom:3rem}
    .logo{font-size:5rem;display:block;margin-bottom:1rem;animation:bounceIn 0.8s ease}
    @keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{transform:scale(1.08)}100%{transform:scale(1)}}
    h1{font-size:3.5rem;font-weight:900;background:linear-gradient(135deg,#8b5cf6,#a78bfa,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.8rem}
    .subtitle{font-size:1.2rem;color:#8b7aaa;margin-bottom:1.5rem}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:3rem}
    .stat-card{background:linear-gradient(145deg,rgba(30,20,50,0.8),rgba(25,15,45,0.9));border:1px solid rgba(139,92,246,0.2);border-radius:24px;padding:2rem 1.5rem;text-align:center;backdrop-filter:blur(15px);transition:all 0.3s}
    .stat-card:hover{transform:translateY(-4px);box-shadow:0 20px 50px rgba(139,92,246,0.12);border-color:rgba(139,92,246,0.5)}
    .stat-number{font-size:2.8rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .stat-label{color:#8b7aaa;font-size:0.95rem;font-weight:500;margin-top:0.5rem;text-transform:uppercase}
    .section{margin-bottom:3rem}
    .section-title{font-size:1.5rem;font-weight:700;color:#8b5cf6;border-bottom:1px solid rgba(139,92,246,0.2);padding-bottom:0.5rem;margin-bottom:1.2rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .card{background:rgba(30,20,50,0.7);border:1px solid rgba(139,92,246,0.15);border-radius:18px;padding:1.3rem;transition:all 0.3s}
    .card:hover{border-color:#8b5cf6;transform:translateY(-2px)}
    .method{background:#8b5cf6;color:#fff;font-weight:700;padding:3px 10px;border-radius:8px;font-size:0.7rem;margin-right:8px}
    .path{font-family:monospace;color:#a78bfa;font-size:0.9rem}
    .desc{color:#8b7aaa;font-size:0.85rem;margin-top:8px}
    .admin-link{text-align:center;margin:2rem 0}
    .admin-btn{color:#8b5cf6;border:1px solid rgba(139,92,246,0.3);padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:600;transition:all 0.3s;display:inline-block}
    .admin-btn:hover{background:#8b5cf6;color:#fff}
    .footer{text-align:center;color:#5a4a7a;margin-top:3rem;padding-top:2rem;border-top:1px solid rgba(139,92,246,0.1)}
  </style>
</head>
<body>
  <div class="bg-animation">
    <div class="bg-circle"></div>
    <div class="bg-circle"></div>
  </div>
  <div class="container">
    <div class="header">
      <span class="logo">💾</span>
      <h1>CRYSN⎔VA Backup</h1>
      <p class="subtitle">Cloud Backup & Restore API • Encrypted Storage • Cross-Platform</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number" id="totalBackups">—</div><div class="stat-label">Total Backups</div></div>
      <div class="stat-card"><div class="stat-number" id="totalSize">—</div><div class="stat-label">Storage Used</div></div>
      <div class="stat-card"><div class="stat-number">🔐</div><div class="stat-label">Encrypted</div></div>
      <div class="stat-card"><div class="stat-number">🟢</div><div class="stat-label">Online</div></div>
    </div>
    <div class="section">
      <div class="section-title">📡 API Endpoints</div>
      <div class="grid">
        <div class="card"><span class="method">POST</span><span class="path">/backup/exists</span><div class="desc">Check if backup exists</div></div>
        <div class="card"><span class="method">POST</span><span class="path">/backup/save</span><div class="desc">Save encrypted backup</div></div>
        <div class="card"><span class="method">POST</span><span class="path">/backup/load</span><div class="desc">Load & decrypt backup</div></div>
        <div class="card"><span class="method">POST</span><span class="path">/backup/delete</span><div class="desc">Delete a backup</div></div>
      </div>
    </div>
    <div class="admin-link">
      <a href="/admin" class="admin-btn">🔐 Admin Dashboard</a>
    </div>
    <div class="footer">💾 CRYSN⚉VA Backup • Encrypted Cloud Storage • © 2026</div>
  </div>
  <script>
    async function load(){try{const r=await fetch('/admin/stats');const d=await r.json();document.getElementById('totalBackups').textContent=d.totalBackups||0;document.getElementById('totalSize').textContent=d.totalSizeFormatted||'0 B'}catch(e){}}
    load();
  </script>
</body>
</html>`;

// ==================== ADMIN DASHBOARD ====================
const ADMIN_LOGIN_HTML = `<!DOCTYPE html><html><head><title>🔐 Admin Login</title><style>body{background:#060a08;color:#e2f5e8;font-family:'Inter';display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.box{background:rgba(30,20,50,0.9);border:1px solid #8b5cf6;padding:2rem;border-radius:20px;text-align:center;width:350px}h2{color:#8b5cf6}input{background:#1a102a;border:1px solid #8b5cf6;color:#e2f5e8;padding:0.8rem;border-radius:10px;width:100%;margin:1rem 0}button{background:#8b5cf6;color:#fff;border:none;padding:0.8rem 2rem;border-radius:30px;cursor:pointer;font-weight:bold}#error{color:#ef4444;margin-top:0.5rem}</style></head><body><div class="box"><h2>🔐 Admin Login</h2><input type="password" id="pwd" placeholder="Admin Password"><button onclick="login()">Login</button><p id="error"></p></div><script>async function login(){const p=document.getElementById('pwd').value;const r=await fetch('/admin/stats',{headers:{'X-Admin-Key':p}});if(r.ok){localStorage.setItem('ak',p);window.location.href='/admin/dashboard'}else document.getElementById('error').textContent='Wrong password'}document.getElementById('pwd').addEventListener('keypress',function(e){if(e.key==='Enter')login()});</script></body></html>`;

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html><html><head><title>💾 Admin Dashboard</title><style>body{background:#060a08;color:#e2f5e8;font-family:'Inter';padding:1.5rem;margin:0}.container{max-width:1000px;margin:0 auto}h1{color:#8b5cf6}h2{color:#a78bfa;margin:1rem 0}.card{background:rgba(30,20,50,0.7);border:1px solid rgba(139,92,246,0.2);border-radius:16px;padding:1.5rem;margin:1rem 0}table{width:100%;border-collapse:collapse;font-size:0.9rem}th,td{padding:0.7rem;border-bottom:1px solid rgba(139,92,246,0.1);text-align:left}th{background:rgba(139,92,246,0.1);color:#8b5cf6;text-transform:uppercase;font-size:0.8rem}tr:hover{background:rgba(139,92,246,0.05)}input{background:#1a102a;border:1px solid #8b5cf6;color:#e2f5e8;padding:0.6rem;border-radius:8px;margin:0.3rem}button{background:#8b5cf6;color:#fff;border:none;padding:0.6rem 1.2rem;border-radius:8px;cursor:pointer;font-weight:bold;margin:0.2rem}#deleteBtn{background:#ef4444}.logout{float:right;color:#8b7aaa;cursor:pointer;text-decoration:underline}</style></head><body><div class="container"><h1>💾 Admin Dashboard <span class="logout" onclick="logout()">Logout</span></h1><div class="card"><h2>🗑️ Delete Backup</h2><input id="phoneDelete" placeholder="Phone number"><button id="deleteBtn" onclick="deleteBackup()">Delete Backup</button><p id="status" style="margin-top:0.5rem;font-size:0.9rem"></p></div><div class="card"><h2>📊 All Backups</h2><table id="table"><tr><th>Phone</th><th>Date</th><th>Size</th><th>Version</th></tr></table></div></div><script>const ak=localStorage.getItem('ak');if(!ak)window.location.href='/admin';function logout(){localStorage.removeItem('ak');window.location.href='/admin'}async function api(p,m='GET',b=null){const h={'X-Admin-Key':ak};if(b)h['Content-Type']='application/json';const r=await fetch(p,{method:m,headers:h,body:b?JSON.stringify(b):undefined});return r.json()}async function load(){const d=await api('/admin/stats');const t=document.getElementById('table');t.innerHTML='<tr><th>Phone</th><th>Date</th><th>Size</th><th>Version</th></tr>';if(d.backups)d.backups.forEach(b=>{t.innerHTML+='<tr><td>'+b.phone+'</td><td>'+new Date(b.timestamp).toLocaleString()+'</td><td>'+b.size+'</td><td>'+b.version+'</td></tr>'})}async function deleteBackup(){const p=document.getElementById('phoneDelete').value.trim();if(!p)return;if(!confirm('Delete backup for '+p+'?'))return;await api('/admin/delete','POST',{phone:p});document.getElementById('status').textContent='Deleted!';load()}load();</script></body></html>`;

// ==================== ROUTER ====================
const ROUTES = {
  'POST /backup/exists': async (env, body) => handleBackupExists(env, body.phone),
  'POST /backup/save': async (env, body) => handleBackupSave(env, body.phone, body.password, body.data),
  'POST /backup/load': async (env, body) => handleBackupLoad(env, body.phone, body.password),
  'POST /backup/delete': async (env, body) => handleBackupDelete(env, body.phone, body.password),
  'GET /admin/stats': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    return handleAdminStats(env);
  },
  'POST /admin/delete': async (env, req) => {
    if (req.headers.get('X-Admin-Key') !== env.ADMIN_PASSWORD) return errorResponse('Unauthorized', 401);
    const body = await req.json();
    return handleAdminDeleteByPhone(env, body.phone);
  },
};

// ==================== MAIN ====================
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Frontend
    if (method === 'GET' && path === '/') return new Response(LANDING_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin') return new Response(ADMIN_LOGIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin/dashboard') return new Response(ADMIN_DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

    let body = {};
    if (method === 'POST') { try { body = await request.json(); } catch(e) {} }

    if (path.startsWith('/admin/')) {
      const handler = ROUTES[`${method} ${path}`];
      if (!handler) return errorResponse('Not found', 404);
      return handler(env, request);
    }

    const handler = ROUTES[`${method} ${path}`];
    if (!handler) return errorResponse('Not found', 404);
    try { return await handler(env, body); } catch (err) { console.error(err); return errorResponse('Internal error', 500); }
  }
};