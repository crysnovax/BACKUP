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

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// ✅ Browser-compatible encryption (no Buffer)
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
      size: parsed.size,
      sizeFormatted: formatSize(parsed.size)
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
      size: encrypted.length,
      sizeFormatted: formatSize(encrypted.length)
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
          sizeFormatted: formatSize(parsed.size)
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
    return jsonResponse({ totalBackups: 0, totalSize: 0, totalSizeFormatted: '0 B', backups: [] });
  }
}

async function handleAdminDeleteByPhone(env, phone) {
  const key = `backup:${cleanPhone(phone)}`;
  await env.BACKUP_KV.delete(key);
  return jsonResponse({ message: `Backup for ${phone} deleted!` });
}

// ==================== PREMIUM LANDING PAGE ====================
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
    .powered{display:inline-block;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);padding:8px 22px;border-radius:50px;font-size:0.9rem;margin-bottom:1.2rem}
    .status-pill{display:inline-flex;align-items:center;gap:10px;background:rgba(30,20,50,0.7);border:1px solid rgba(139,92,246,0.3);padding:10px 26px;border-radius:50px;font-size:0.95rem}
    .pulse-dot{width:12px;height:12px;background:#8b5cf6;border-radius:50%;position:relative}
    .pulse-dot::after{content:'';position:absolute;top:-4px;left:-4px;width:20px;height:20px;background:rgba(139,92,246,0.3);border-radius:50%;animation:pulse 2s infinite}
    @keyframes pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2.5);opacity:0}}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:3rem}
    .stat-card{background:linear-gradient(145deg,rgba(30,20,50,0.8),rgba(25,15,45,0.9));border:1px solid rgba(139,92,246,0.2);border-radius:24px;padding:2rem 1.5rem;text-align:center;backdrop-filter:blur(15px);transition:all 0.3s;cursor:default}
    .stat-card:hover{transform:translateY(-4px);box-shadow:0 20px 50px rgba(139,92,246,0.12);border-color:rgba(139,92,246,0.5)}
    .stat-number{font-size:2.8rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .stat-label{color:#8b7aaa;font-size:0.95rem;font-weight:500;margin-top:0.5rem;text-transform:uppercase;letter-spacing:0.05em}
    .section{margin-bottom:3rem}
    .section-title{font-size:1.5rem;font-weight:700;color:#8b5cf6;border-bottom:1px solid rgba(139,92,246,0.2);padding-bottom:0.5rem;margin-bottom:1.2rem;display:flex;align-items:center;gap:10px}
    .badge{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;padding:3px 12px;border-radius:20px;font-size:0.8rem;font-weight:700}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .card{background:rgba(30,20,50,0.7);border:1px solid rgba(139,92,246,0.15);border-radius:18px;padding:1.3rem;transition:all 0.3s;cursor:pointer;position:relative;overflow:hidden}
    .card:hover{border-color:#8b5cf6;transform:translateY(-2px)}
    .card::after{content:'';position:absolute;bottom:0;left:0;width:0;height:2px;background:linear-gradient(90deg,#8b5cf6,#a78bfa);transition:width 0.4s ease}
    .card:hover::after{width:100%}
    .method{background:#8b5cf6;color:#fff;font-weight:700;padding:3px 10px;border-radius:8px;font-size:0.7rem;margin-right:8px;letter-spacing:0.04em}
    .path{font-family:'SF Mono','Fira Code',monospace;color:#a78bfa;font-size:0.9rem}
    .desc{color:#8b7aaa;font-size:0.85rem;margin-top:8px;line-height:1.5}
    .admin-section{text-align:center;margin:3rem 0 2rem}
    .admin-btn{display:inline-flex;align-items:center;gap:8px;color:#8b5cf6;border:1px solid rgba(139,92,246,0.3);padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:600;font-size:1rem;transition:all 0.3s;background:rgba(139,92,246,0.05)}
    .admin-btn:hover{background:#8b5cf6;color:#fff;transform:translateY(-3px);box-shadow:0 15px 40px rgba(139,92,246,0.25)}
    .footer{text-align:center;color:#5a4a7a;margin-top:3rem;padding-top:2rem;border-top:1px solid rgba(139,92,246,0.1);letter-spacing:0.03em}
    @media(max-width:768px){h1{font-size:2.2rem}.stat-number{font-size:2rem}}
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
      <div class="powered">🔐 ENCRYPTED CLOUD BACKUP SYSTEM</div>
      <div class="subtitle">Secure Backup & Restore API • Cross-Platform • Password Protected</div>
      <div class="status-pill"><span class="pulse-dot"></span>🌐 All Systems Operational</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number" id="totalBackups">—</div>
        <div class="stat-label">Total Backups</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" id="totalSize">—</div>
        <div class="stat-label">Storage Used</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">🔐</div>
        <div class="stat-label">Encrypted Storage</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">🟢</div>
        <div class="stat-label">API Status</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📡 API Endpoints <span class="badge">4</span></div>
      <div class="grid">
        <div class="card"><span class="method">POST</span><span class="path">/backup/exists</span><div class="desc">Check if a backup exists for a phone number</div></div>
        <div class="card"><span class="method">POST</span><span class="path">/backup/save</span><div class="desc">Save an encrypted backup to cloud storage</div></div>
        <div class="card"><span class="method">POST</span><span class="path">/backup/load</span><div class="desc">Load and decrypt a backup from cloud</div></div>
        <div class="card"><span class="method">POST</span><span class="path">/backup/delete</span><div class="desc">Delete a backup (requires password)</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🛡️ Security Features</div>
      <div class="grid">
        <div class="card"><div class="desc" style="font-size:1rem;color:#e2f5e8">🔐 <strong>Password Encrypted</strong><br>All data is XOR-encrypted with your password</div></div>
        <div class="card"><div class="desc" style="font-size:1rem;color:#e2f5e8">📱 <strong>Phone-Based ID</strong><br>Your phone number identifies your backup</div></div>
        <div class="card"><div class="desc" style="font-size:1rem;color:#e2f5e8">☁️ <strong>Cloud Storage</strong><br>Stored on Cloudflare's global edge network</div></div>
        <div class="card"><div class="desc" style="font-size:1rem;color:#e2f5e8">🔄 <strong>Cross-Platform</strong><br>Restore to any new deployment instantly</div></div>
      </div>
    </div>

    <div class="admin-section">
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

// ==================== ADMIN LOGIN ====================
const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔐 Admin Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060a08;min-height:100vh;font-family:'Inter',sans-serif;display:flex;justify-content:center;align-items:center}
    .bg-circle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,0.06),transparent 70%);animation:float 20s infinite}
    .bg-circle:nth-child(1){width:500px;height:500px;top:-100px;left:-50px}
    .bg-circle:nth-child(2){width:400px;height:400px;bottom:-80px;right:-80px;animation-delay:-8s}
    @keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(20px,-20px)}}
    .login-box{position:relative;z-index:1;background:linear-gradient(145deg,rgba(30,20,50,0.95),rgba(25,15,45,0.95));border:1px solid rgba(139,92,246,0.3);border-radius:28px;padding:3rem 2.5rem;text-align:center;width:400px;backdrop-filter:blur(20px);box-shadow:0 30px 80px rgba(0,0,0,0.5)}
    .lock-icon{font-size:4rem;display:block;margin-bottom:1.2rem;animation:bounceIn 0.8s ease}
    @keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{transform:scale(1.08)}100%{transform:scale(1)}}
    h2{font-size:1.8rem;font-weight:700;background:linear-gradient(135deg,#8b5cf6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.5rem}
    .subtitle{color:#8b7aaa;font-size:0.9rem;margin-bottom:2rem}
    input{width:100%;background:rgba(20,15,35,0.8);border:1px solid rgba(139,92,246,0.3);color:#e2f5e8;padding:1rem 1.2rem;border-radius:14px;font-size:1rem;outline:none;transition:all 0.3s;margin-bottom:1.2rem}
    input:focus{border-color:#8b5cf6;box-shadow:0 0 0 4px rgba(139,92,246,0.1)}
    button{width:100%;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;padding:1rem;border-radius:14px;font-size:1.05rem;font-weight:700;cursor:pointer;transition:all 0.3s}
    button:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(139,92,246,0.3)}
    #error{color:#ef4444;font-size:0.9rem;margin-top:1rem;min-height:20px}
    .back-link{display:block;margin-top:1.2rem;color:#5a4a7a;text-decoration:none;font-size:0.9rem}
    .back-link:hover{color:#8b5cf6}
  </style>
</head>
<body>
  <div class="bg-circle"></div>
  <div class="bg-circle"></div>
  <div class="login-box">
    <span class="lock-icon">🔐</span>
    <h2>Admin Access</h2>
    <p class="subtitle">Enter your credentials to continue</p>
    <input type="password" id="pwd" placeholder="Admin Password" autofocus autocomplete="off">
    <button onclick="login()">Authenticate →</button>
    <p id="error"></p>
    <a href="/" class="back-link">← Back to API</a>
  </div>
  <script>
    async function login(){
      const p=document.getElementById('pwd').value;
      if(!p){document.getElementById('error').textContent='Enter password';return}
      document.getElementById('error').textContent='Verifying...';
      try{
        const r=await fetch('/admin/stats',{headers:{'X-Admin-Key':p}});
        if(r.ok){localStorage.setItem('adminKey',p);window.location.href='/admin/dashboard'}
        else document.getElementById('error').textContent='❌ Wrong password'
      }catch(e){document.getElementById('error').textContent='Connection error'}
    }
    document.getElementById('pwd').addEventListener('keypress',function(e){if(e.key==='Enter')login()});
  </script>
</body>
</html>`;

// ==================== ADMIN DASHBOARD ====================
const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>💾 Admin Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060a08;min-height:100vh;font-family:'Inter',sans-serif;color:#e2f5e8;padding:1.5rem}
    .container{max-width:1000px;margin:0 auto}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;flex-wrap:wrap;gap:1rem}
    h1{font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .logout-btn{background:transparent;border:1px solid rgba(239,68,68,0.4);color:#fca5a5;padding:0.6rem 1.5rem;border-radius:12px;cursor:pointer;font-weight:600;font-size:0.9rem;transition:all 0.3s}
    .logout-btn:hover{background:rgba(239,68,68,0.15);border-color:#ef4444}
    .card{background:linear-gradient(145deg,rgba(30,20,50,0.8),rgba(25,15,45,0.9));border:1px solid rgba(139,92,246,0.2);border-radius:22px;padding:1.8rem;margin-bottom:1.5rem;animation:fadeIn 0.5s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    h2{color:#a78bfa;font-size:1.2rem;font-weight:700;margin-bottom:1rem}
    .actions{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:1rem}
    input{background:rgba(20,15,35,0.8);border:1px solid rgba(139,92,246,0.3);color:#e2f5e8;padding:0.7rem 1rem;border-radius:10px;font-size:0.95rem;min-width:200px;outline:none;transition:all 0.3s}
    input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,0.1)}
    button{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;padding:0.7rem 1.5rem;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem;transition:all 0.3s}
    button:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(139,92,246,0.25)}
    .btn-danger{background:linear-gradient(135deg,#ef4444,#dc2626)}
    .btn-danger:hover{box-shadow:0 8px 25px rgba(239,68,68,0.25)}
    #status{padding:0.5rem 1rem;border-radius:8px;font-size:0.9rem;margin-top:0.8rem;display:none}
    .success{background:rgba(16,185,129,0.15);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3);display:block}
    .error{background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);display:block}
    table{width:100%;border-collapse:collapse;font-size:0.9rem;border-radius:12px;overflow:hidden}
    thead{background:rgba(139,92,246,0.1)}
    th{color:#8b5cf6;font-weight:700;padding:1rem 0.8rem;text-align:left;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em}
    td{padding:0.9rem 0.8rem;border-bottom:1px solid rgba(139,92,246,0.08)}
    tbody tr:hover{background:rgba(139,92,246,0.04)}
    .empty{text-align:center;padding:3rem;color:#5a4a7a}
    @media(max-width:768px){.actions{flex-direction:column}input{width:100%}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💾 Admin Dashboard</h1>
      <button class="logout-btn" onclick="logout()">🚪 Logout</button>
    </div>

    <div class="card">
      <h2>🗑️ Manage Backups</h2>
      <div class="actions">
        <input id="phoneInput" placeholder="Phone number (e.g. 2348077528901)" autocomplete="off">
        <button onclick="deleteBackup()">🗑️ Delete Backup</button>
        <button class="btn-danger" onclick="deleteAll()">💣 Delete ALL</button>
      </div>
      <div id="status"></div>
    </div>

    <div class="card">
      <h2>📊 All Stored Backups</h2>
      <table>
        <thead><tr><th>📱 Phone</th><th>📅 Date</th><th>📏 Size</th><th>🔐 Status</th></tr></thead>
        <tbody id="tableBody"><tr><td colspan="4"><div class="empty">Loading backups...</div></td></tr></tbody>
      </table>
    </div>
  </div>

  <script>
    const ak=localStorage.getItem('adminKey');
    if(!ak)window.location.href='/admin';

    function logout(){localStorage.removeItem('adminKey');window.location.href='/admin'}

    async function api(url,method='GET',body=null){
      const headers={'X-Admin-Key':ak};
      if(body)headers['Content-Type']='application/json';
      const r=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined});
      return r.json()
    }

    function showStatus(msg,type){
      const el=document.getElementById('status');
      el.textContent=msg;el.className=type;setTimeout(()=>{el.textContent='';el.className=''},4000)
    }

    async function load(){
      const d=await api('/admin/stats');
      const t=document.getElementById('tableBody');
      if(!d.backups||!d.backups.length){t.innerHTML='<tr><td colspan="4"><div class="empty">📭 No backups stored yet</div></td></tr>';return}
      t.innerHTML=d.backups.map(b=>{
        return '<tr><td><strong>'+b.phone+'</strong></td><td>'+new Date(b.timestamp).toLocaleString()+'</td><td>'+b.sizeFormatted+'</td><td>🔐 Encrypted</td></tr>'
      }).join('')
    }

    async function deleteBackup(){
      const p=document.getElementById('phoneInput').value.trim();
      if(!p){showStatus('Enter phone number','error');return}
      if(!confirm('Delete backup for '+p+'?'))return;
      await api('/admin/delete','POST',{phone:p});
      showStatus('✅ Deleted!','success');
      document.getElementById('phoneInput').value='';
      load()
    }

    async function deleteAll(){
      if(!confirm('⚠️ Delete ALL backups? This cannot be undone!'))return;
      if(!confirm('FINAL WARNING: Delete everything?'))return;
      const d=await api('/admin/stats');
      if(d.backups){for(const b of d.backups){await api('/admin/delete','POST',{phone:b.phone})}}
      showStatus('✅ All backups deleted!','success');
      load()
    }

    load();
    document.getElementById('phoneInput').addEventListener('keypress',function(e){if(e.key==='Enter')deleteBackup()});
  </script>
</body>
</html>`;

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

    if (method === 'GET' && path === '/') return new Response(LANDING_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin') return new Response(ADMIN_LOGIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    if (method === 'GET' && path === '/admin/dashboard') return new Response(ADMIN_DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

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