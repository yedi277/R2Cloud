/**
 * name = "mycloud-webdav-ui"
 * 单用户版 —— WebDAV + 网页UI 双模式
 *
 * 网页访问：/ → 登录 → 文件管理
 * WebDAV端点：/dav/
 *
 * [[r2_buckets]]
 * binding = "R2_BUCKET"
 * bucket_name = "你的R2桶名"
 *
 * [vars]
 * ADMIN_PASSWORD = "你的管理员密码"
 */

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function normalizePath(p) {
  if (!p) return '';
  if (p.startsWith('/')) p = p.slice(1);
  return p.replace(/\/+$/, '');
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
}

async function deleteR2Folder(env, key) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: key + '/', cursor });
    if (batch.objects?.length) {
      await env.R2_BUCKET.delete(batch.objects.map(obj => obj.key));
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  await env.R2_BUCKET.delete(key).catch(() => {});
}

async function copyR2Folder(env, srcKey, dstKey) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: srcKey + '/', cursor });
    if (batch.objects?.length) {
      const srcObjects = await Promise.all(
        batch.objects.map(obj => env.R2_BUCKET.get(obj.key))
      );
      await Promise.all(
        batch.objects.map((obj, i) => {
          const srcObj = srcObjects[i];
          if (!srcObj) return Promise.resolve();
          const newKey = dstKey + obj.key.slice(srcKey.length);
          return env.R2_BUCKET.put(newKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
        })
      );
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
}

async function parseDavDestination(request, davPath) {
  const destHeader = request.headers.get('Destination');
  if (!destHeader) return new Response('Missing Destination header', { status: 400 });
  try {
    const destUrl = new URL(destHeader);
    let destPath = destUrl.pathname;
    if (destPath.startsWith('/dav/')) destPath = destPath.slice(5);
    if (destPath.startsWith('/')) destPath = destPath.slice(1);
    return { srcKey: davPath, dstKey: destPath.replace(/\/$/, '') };
  } catch {
    return new Response('Invalid Destination URL', { status: 400 });
  }
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rfc1123Date(d) {
  return new Date(d).toUTCString();
}

function davXmlResponse(body, status = 207) {
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n' + body;
  return new Response(xml, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
}

// DAV 下载/HEAD 共用响应头：含 Accept-Ranges，供 Range 续传
function davHeaders(obj, filename) {
  return new Headers({
    'Content-Type': obj.httpMetadata?.contentType || getMimeType(filename) || 'application/octet-stream',
    'Content-Length': obj.size,
    'ETag': obj.etag ? `"${obj.etag}"` : (obj.httpEtag || ''),
    'Last-Modified': rfc1123Date(obj.uploaded),
    'Accept-Ranges': 'bytes'
  });
}

// 协商缓存判定：比对 If-None-Match(ETag) / If-Modified-Since，命中返回 true（调用方回 304）
// 有 If-None-Match 时按 RFC 优先于 If-Modified-Since，不再回退到时间比对
function notModified(meta, request) {
  if (!meta) return false;
  const etag = meta.etag ? `"${meta.etag}"` : (meta.httpEtag || '');

  const inm = request.headers.get('If-None-Match');
  if (inm) {
    if (inm.trim() === '*') return true;
    if (!etag) return false;
    return inm.split(',').some(v => v.trim().replace(/^W\//, '') === etag);
  }

  const ims = request.headers.get('If-Modified-Since');
  if (ims && meta.uploaded) {
    const since = Date.parse(ims);
    if (!Number.isNaN(since)) {
      // HTTP 时间精度只到秒，比对时统一截断到秒，避免亚秒误差导致误判未命中
      return Math.floor(new Date(meta.uploaded).getTime() / 1000) <= Math.floor(since / 1000);
    }
  }
  return false;
}

// 构造 304 响应头：只带校验相关字段，不带 body 相关字段
function notModifiedHeaders(meta) {
  return {
    'ETag': meta.etag ? `"${meta.etag}"` : (meta.httpEtag || ''),
    'Last-Modified': rfc1123Date(meta.uploaded),
    'Accept-Ranges': 'bytes'
  };
}

// 判断 key 是否为「集合」(目录)：存在子对象或子前缀即视为目录
async function isCollection(env, key) {
  const list = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
  return (list.objects?.length > 0 || list.delimitedPrefixes?.length > 0);
}

// 生成单个 DAV 资源的 <d:response> 片段（根目录 / 文件夹 / 文件 共用）
// etag 仅在传入（含空串）时输出，集合传 undefined 则不生成 <d:getetag>
function davItemXml(href, displayName, { isCollection, size, mtime, contentType, etag } = {}) {
  const etagLine = etag !== undefined ? `        <d:getetag>"${etag}"</d:getetag>\n` : '';
  return `  <d:response>
    <d:href>${xmlEscape(href)}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(displayName)}</d:displayname>
        ${isCollection ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>'}
        <d:getlastmodified>${rfc1123Date(mtime)}</d:getlastmodified>
        <d:getcontentlength>${size}</d:getcontentlength>
${etagLine}        <d:getcontenttype>${xmlEscape(contentType)}</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
}

// 列出某前缀下的直接子项（delimiter 分隔一层）：文件对象 + 文件夹名集合
// handleApiList 与 handleDavPropfind 共用，避免列表逻辑重复
async function listDir(env, prefix) {
  const objects = [];
  const folders = new Set();
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix, delimiter: '/', limit: 1000, cursor });
    if (batch.objects) {
      for (const obj of batch.objects) {
        if (obj.key.endsWith('/.keep')) continue;
        objects.push(obj);
      }
    }
    if (batch.delimitedPrefixes) {
      for (const dp of batch.delimitedPrefixes) {
        const name = dp.replace(prefix, '').replace(/\/$/, '');
        if (name) folders.add(name);
      }
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  return { objects, folders };
}

async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6));
      const colon = decoded.indexOf(':');
      const pass = decoded.slice(colon + 1);
      if (pass === env.ADMIN_PASSWORD) return { role: 'admin' };
    } catch {}
  }
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/token=([^;]+)/);
  if (match) {
    try {
      const payload = JSON.parse(atob(match[1].split('.')[1]));
      if (payload.exp > Date.now() / 1000 && payload.pass === env.ADMIN_PASSWORD) {
        return { role: 'admin' };
      }
    } catch {}
  }
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp > Date.now() / 1000 && payload.pass === env.ADMIN_PASSWORD) {
        return { role: 'admin' };
      }
    } catch {}
  }
  return null;
}

function makeToken(pass) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({ role: 'admin', pass, exp: now + 86400 * 7 }));
  return `${header}.${payload}.signed`;
}

function makeTokenCookie(token) {
  return `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${86400 * 7}`;
}

const CSS_STYLES = `<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #333; min-height: 100vh; }
.header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
.header h1 { font-size: 20px; font-weight: 600; }
.header-right { display: flex; align-items: center; gap: 12px; }
.btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
.btn-primary { background: rgba(255,255,255,0.2); color: white; }
.btn-primary:hover { background: rgba(255,255,255,0.3); }
.btn-danger { background: #ff4d4f; color: white; }
.container { max-width: 1200px; margin: 24px auto; padding: 0 24px; }
.breadcrumb { display: flex; align-items: center; gap: 4px; margin-bottom: 16px; font-size: 14px; color: #666; }
.breadcrumb a { color: #667eea; text-decoration: none; }
.breadcrumb a:hover { text-decoration: underline; }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar .btn { background: white; color: #333; border: 1px solid #d9d9d9; }
.toolbar .btn:hover { border-color: #667eea; color: #667eea; }
.file-list { background: white; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
.file-item { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; transition: background 0.15s; cursor: pointer; }
.file-item:hover { background: #f5f7ff; }
.file-item:last-child { border-bottom: none; }
.file-icon { width: 36px; height: 36px; margin-right: 12px; font-size: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta { font-size: 12px; color: #999; margin-top: 2px; }
.file-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.file-item:hover .file-actions { opacity: 1; }
.file-actions .btn { padding: 4px 8px; font-size: 12px; background: none; border: 1px solid #d9d9d9; border-radius: 4px; }
.file-actions .btn:hover { border-color: #667eea; color: #667eea; }
.empty-state { text-align: center; padding: 60px 20px; color: #999; }
.empty-state .icon { font-size: 48px; margin-bottom: 12px; }
.modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 1000; justify-content: center; align-items: center; }
.modal-overlay.active { display: flex; }
.modal { background: white; border-radius: 12px; padding: 24px; min-width: 360px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal h3 { margin-bottom: 16px; font-size: 16px; }
.modal input { width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; margin-bottom: 12px; }
.modal-buttons { display: flex; gap: 8px; justify-content: flex-end; }
.modal-buttons .btn { background: #f0f0f0; color: #333; }
.modal-buttons .btn-primary { background: #667eea; color: white; }
.progress-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 2000; justify-content: center; align-items: center; }
.progress-overlay.active { display: flex; }
.progress-box { background: white; border-radius: 12px; padding: 24px; min-width: 320px; text-align: center; }
.progress-bar-bg { width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; margin: 12px 0; overflow: hidden; }
.progress-bar-fill { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 4px; transition: width 0.3s; width: 0%; }
#fileInput { display: none; }
.login-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.login-box { background: white; border-radius: 12px; padding: 40px; min-width: 360px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
.login-box h2 { text-align: center; margin-bottom: 24px; color: #333; }
.login-box input { width: 100%; padding: 10px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
.login-box .btn { width: 100%; padding: 10px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 6px; font-size: 15px; }
.login-error { color: #ff4d4f; font-size: 13px; margin-bottom: 12px; display: none; }
.toast { position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; color: white; font-size: 14px; z-index: 3000; transform: translateX(120%); transition: transform 0.3s; }
.toast.active { transform: translateX(0); }
.toast-success { background: #52c41a; }
.toast-error { background: #ff4d4f; }
.toast-warning { background: #faad14; color: #333; }
</style>`;

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>登录 - 网盘</title>${CSS_STYLES}</head>
<body>
<div class="login-container">
  <div class="login-box">
    <h2>🔒 网盘登录</h2>
    <div class="login-error" id="error">密码错误</div>
    <input type="password" id="password" placeholder="请输入密码" autofocus />
    <button class="btn" onclick="doLogin()">登录</button>
  </div>
</div>
<script>
async function doLogin() {
  const pass = document.getElementById('password').value;
  const resp = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pass}) });
  const data = await resp.json();
  if(data.success) { document.cookie = 'token='+data.token+'; Path=/; Max-Age='+(86400*7); location.href='/'; }
  else { document.getElementById('error').style.display='block'; }
}
document.getElementById('password').addEventListener('keypress', e => { if(e.key==='Enter') doLogin(); });
</script>
</body>
</html>`;

function getIndexPage(currentPath) {
  const pathDisplay = currentPath || '/';
  const parentPath = currentPath ? currentPath.split('/').slice(0, -1).join('/') : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>网盘 - ${pathDisplay}</title>${CSS_STYLES}</head>
<body>
<div class="header">
  <h1>📁 我的网盘</h1>
  <div class="header-right">
    <span>管理员</span>
    <button class="btn btn-primary" onclick="doLogout()">退出</button>
  </div>
</div>
<div class="container">
  <div class="breadcrumb" id="breadcrumb"></div>
  <div class="toolbar">
    <button class="btn" onclick="goBack()">⬆ 返回上级</button>
    <button class="btn" onclick="showMkdir()">📁 新建文件夹</button>
    <button class="btn" onclick="document.getElementById('fileInput').click()">⬆ 上传文件</button>
    <button class="btn" onclick="doRefresh()">🔄 刷新</button>
  </div>
  <div class="file-list" id="fileList"><div class="empty-state"><div class="icon">⏳</div>加载中...</div></div>
</div>

<input type="file" id="fileInput" multiple />
<div class="modal-overlay" id="mkdirModal">
  <div class="modal"><h3>新建文件夹</h3><input type="text" id="folderName" placeholder="请输入文件夹名称" /><div class="modal-buttons"><button class="btn" onclick="hideMkdir()">取消</button><button class="btn btn-primary" onclick="doMkdir()">创建</button></div></div>
</div>
<div class="modal-overlay" id="renameModal">
  <div class="modal"><h3>重命名</h3><input type="text" id="renameInput" /><div class="modal-buttons"><button class="btn" onclick="hideRename()">取消</button><button class="btn btn-primary" onclick="doRename()">确定</button></div></div>
</div>
<div class="progress-overlay" id="progressOverlay">
  <div class="progress-box"><h3 id="progressTitle">上传中...</h3><div class="progress-bar-bg"><div class="progress-bar-fill" id="progressFill"></div></div><div id="progressPct">0%</div></div>
</div>

<script>
let currentPath = ${JSON.stringify(currentPath || '')};
let renameOldName = '';

function getAuth() { return { headers: { 'Authorization': 'Bearer '+getToken() } }; }
function getToken() { return document.cookie.match(/token=([^;]+)/)?.[1] || ''; }
function apiPathToFilePath(p) { return p ? '/'+p : ''; }

async function loadFiles() {
  const resp = await fetch('/api/list?path='+encodeURIComponent(currentPath), getAuth());
  const data = await resp.json();
  if(!data.success) { if(resp.status===401) location.href='/login'; return; }
  renderFiles(data.files);
}

function renderFiles(files) {
  const list = document.getElementById('fileList');
  let html = '';
  files.forEach(f => {
    const icon = f.type==='folder' ? '📁' : getFileIcon(f.name);
    const href = f.type==='folder' ? '?path='+encodeURIComponent(currentPath ? currentPath+'/'+f.name : f.name) : '/api/download?path='+encodeURIComponent(apiPathToFilePath(currentPath))+'&name='+encodeURIComponent(f.name);
    const click = f.type==='folder' ? 'onclick="enterFolder(\\''+f.name.replace(/'/g,'\\\\\\'')+'\\')"' : '';
    html += '<div class="file-item" '+click+'>' +
      '<div class="file-icon">'+icon+'</div>' +
      '<div class="file-info"><div class="file-name"><a href="'+href+'" '+(f.type!=='folder'?'target="_blank"':'')+'>'+escHtml(f.name)+'</a></div>' +
      '<div class="file-meta">'+formatSize(f.size)+(f.modified?' · '+f.modified:'')+'</div></div>' +
      '<div class="file-actions">' +
        '<button class="btn" onclick="event.stopPropagation();showRename(\\''+f.name.replace(/'/g,'\\\\\\'')+'\\',\\''+f.type+'\\')">✏️</button>' +
        '<button class="btn" onclick="event.stopPropagation();doDelete(\\''+f.name.replace(/'/g,'\\\\\\'')+'\\',\\''+f.type+'\\')">🗑️</button>' +
      '</div></div>';
  });
  list.innerHTML = html || '<div class="empty-state"><div class="icon">📭</div>暂无文件</div>';
  renderBreadcrumb();
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  let html = '<a href="/">🏠 根目录</a>';
  if(currentPath) {
    const parts = currentPath.split('/');
    let p = '';
    parts.forEach((part,i) => {
      p += (i? '/':'') + part;
      html += ' / <a href="?path='+encodeURIComponent(p)+'">'+escHtml(part)+'</a>';
    });
  }
  bc.innerHTML = html;
}

function enterFolder(name) {
  currentPath = currentPath ? currentPath+'/'+name : name;
  history.pushState(null,'', '?path='+encodeURIComponent(currentPath));
  loadFiles();
}

function goBack() {
  if(!currentPath) return;
  const parts = currentPath.split('/');
  parts.pop();
  currentPath = parts.join('/');
  history.pushState(null,'', currentPath ? '?path='+encodeURIComponent(currentPath) : '/');
  loadFiles();
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  currentPath = params.get('path') || '';
  loadFiles();
});

async function doDelete(name, type) {
  if(!confirm('确定删除 '+name+' 吗？')) return;
  const path = currentPath ? currentPath+'/'+name : name;
  const resp = await fetch('/api/delete?path='+encodeURIComponent(apiPathToFilePath(path)), { method: 'DELETE', ...getAuth() });
  const data = await resp.json();
  showToast(data.message, data.success?'success':'error');
  if(data.success) loadFiles();
}

function showMkdir() { document.getElementById('mkdirModal').classList.add('active'); document.getElementById('folderName').value=''; document.getElementById('folderName').focus(); }
function hideMkdir() { document.getElementById('mkdirModal').classList.remove('active'); }
async function doMkdir() {
  const name = document.getElementById('folderName').value.trim();
  if(!name) return;
  const path = currentPath ? currentPath+'/'+name : name;
  const resp = await fetch('/api/mkdir', { method: 'POST', ...getAuth(), headers: {...getAuth().headers, 'Content-Type':'application/json'}, body: JSON.stringify({path: apiPathToFilePath(path)}) });
  const data = await resp.json();
  showToast(data.message, data.success?'success':'error');
  if(data.success) { hideMkdir(); loadFiles(); }
}

function showRename(name, type) { renameOldName = name; document.getElementById('renameInput').value=name; document.getElementById('renameModal').classList.add('active'); document.getElementById('renameInput').focus(); }
function hideRename() { document.getElementById('renameModal').classList.remove('active'); }
async function doRename() {
  const newName = document.getElementById('renameInput').value.trim();
  if(!newName || newName===renameOldName) { hideRename(); return; }
  const oldPath = currentPath ? currentPath+'/'+renameOldName : renameOldName;
  const newPath = currentPath ? currentPath+'/'+newName : newName;
  const resp = await fetch('/api/rename', { method: 'POST', ...getAuth(), headers: {...getAuth().headers, 'Content-Type':'application/json'}, body: JSON.stringify({oldPath: apiPathToFilePath(oldPath), newPath: apiPathToFilePath(newPath)}) });
  const data = await resp.json();
  showToast(data.message, data.success?'success':'error');
  if(data.success) { hideRename(); loadFiles(); }
}

const SMALL = 1*1024*1024;
document.getElementById('fileInput').addEventListener('change', async e => {
  const files = e.target.files;
  if(!files.length) return;
  const oversized = [];
  for(let i=0;i<files.length;i++) if(files[i].size>100*1024*1024) oversized.push(files[i].name);
  if(oversized.length) { showToast('以下文件超过100MB：'+oversized.join('、'), 'error'); return; }
  const small = [], large = [];
  for(let i=0;i<files.length;i++) (files[i].size<=SMALL?small:large).push(files[i]);
  let success=0, fail=0;
  const total=files.length;
  document.getElementById('progressOverlay').classList.add('active');

  async function uploadOne(file) {
    const formData = new FormData();
    formData.append('file', file);
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if(e.lengthComputable) {
          const pct = Math.min(100, Math.floor(e.loaded/e.total*100));
          document.getElementById('progressFill').style.width = pct+'%';
          document.getElementById('progressPct').textContent = pct+'%';
        }
      };
      xhr.onload = () => { if(xhr.status===200) success++; else fail++; resolve(); };
      xhr.onerror = () => { fail++; resolve(); };
      xhr.open('POST', '/api/upload?path='+encodeURIComponent(currentPath||''));
      xhr.setRequestHeader('Authorization', 'Bearer '+getToken());
      xhr.send(formData);
    });
  }

  if(small.length) await Promise.all(small.map(uploadOne));
  for(const f of large) await uploadOne(f);

  document.getElementById('progressOverlay').classList.remove('active');
  document.getElementById('progressFill').style.width='0%';
  if(fail===0) showToast('成功上传 '+success+' 个文件', 'success');
  else if(success===0) showToast('上传失败：'+fail+' 个文件', 'error');
  else showToast('上传完成：成功 '+success+' 个，失败 '+fail+' 个', 'warning');
  loadFiles();
  e.target.value = '';
});

function doRefresh() { loadFiles(); }
function doLogout() { document.cookie='token=; Path=/; Max-Age=0'; location.href='/login'; }

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if(['png','jpg','jpeg','gif','webp','svg','ico'].includes(ext)) return '🖼️';
  if(['mp4','webm','avi','mov'].includes(ext)) return '🎬';
  if(['mp3','wav','flac','aac'].includes(ext)) return '🎵';
  if(['pdf'].includes(ext)) return '📄';
  if(['doc','docx'].includes(ext)) return '📝';
  if(['xls','xlsx'].includes(ext)) return '📊';
  if(['zip','rar','7z','tar','gz'].includes(ext)) return '📦';
  return '📄';
}
function formatSize(bytes) { if(!bytes) return '-'; const u=['B','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(1024)); return parseFloat((bytes/Math.pow(1024,i)).toFixed(1))+' '+u[i]; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast toast-'+type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('active'),10);
  setTimeout(()=>{ t.classList.remove('active'); setTimeout(()=>t.remove(),300); },3000);
}

loadFiles();
</script>
</body>
</html>`;
}

async function handleApiLogin(request, env) {
  try {
    const { password } = await request.json();
    if (password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ success: false, message: '密码错误' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }
    const token = makeToken(password);
    return new Response(JSON.stringify({ success: true, token }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeTokenCookie(token) }
    });
  } catch (e) {
    return jsonResponse({ success: false, message: '请求错误' }, 400);
  }
}

async function handleApiList(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const reqPath = normalizePath(url.searchParams.get('path') || '');

  try {
    const prefix = reqPath ? reqPath + '/' : '';
    const { objects, folders } = await listDir(env, prefix);

    const files = [];
    for (const name of folders) {
      files.push({ name, type: 'folder', size: 0, modified: '' });
    }
    for (const obj of objects) {
      const name = obj.key.slice(prefix.length);
      if (name) {
        files.push({
          name,
          type: 'file',
          size: obj.size,
          modified: obj.uploaded ? formatTime(obj.uploaded) : ''
        });
      }
    }

    return jsonResponse({ success: true, files, path: reqPath });
  } catch (e) {
    return jsonResponse({ success: false, message: e.message }, 500);
  }
}

async function handleApiUpload(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    const reqPath = normalizePath(url.searchParams.get('path') || '');
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return jsonResponse({ success: false, message: '没有上传文件' }, 400);

    const key = reqPath ? reqPath + '/' + file.name : file.name;
    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || getMimeType(file.name) }
    });
    return jsonResponse({ success: true, message: '文件上传成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '上传失败: ' + e.message }, 500);
  }
}

async function handleApiDelete(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    let key = normalizePath(url.searchParams.get('path') || '');

    const listed = await env.R2_BUCKET.list({ prefix: key + '/', limit: 1 });
    if (listed.objects?.length > 0) {
      await deleteR2Folder(env, key);
    } else {
      await env.R2_BUCKET.delete(key);
    }

    return jsonResponse({ success: true, message: '删除成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '删除失败: ' + e.message }, 500);
  }
}

async function handleApiMkdir(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const { path } = await request.json();
    const key = normalizePath(path);
    await env.R2_BUCKET.put(key + '/.keep', '', { httpMetadata: { contentType: 'text/plain' } });
    return jsonResponse({ success: true, message: '文件夹创建成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建失败: ' + e.message }, 500);
  }
}

async function handleApiRename(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const { oldPath, newPath } = await request.json();
    const srcKey = normalizePath(oldPath);
    const dstKey = normalizePath(newPath);

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (srcObj) {
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      await env.R2_BUCKET.delete(srcKey);
    } else {
      const listed = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
      if (listed.objects?.length > 0 || listed.delimitedPrefixes?.length > 0) {
        await copyR2Folder(env, srcKey, dstKey);
        await deleteR2Folder(env, srcKey);
      } else {
        return jsonResponse({ success: false, message: '源不存在' }, 404);
      }
    }

    return jsonResponse({ success: true, message: '重命名成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '重命名失败: ' + e.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function handleDavOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Allow': 'OPTIONS,GET,HEAD,PUT,DELETE,PROPFIND,MKCOL,MOVE,COPY,LOCK,UNLOCK',
      'DAV': '1, 2',
      'MS-Author-Via': 'DAV',
      'Content-Length': '0',
    }
  });
}

async function handleDavPropfind(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request, 'xml');

  try {
    const depth = request.headers.get('Depth') || 'infinity';
    const baseUrl = new URL(request.url).origin + '/dav/';

    const fileObj = davPath ? await env.R2_BUCKET.head(davPath) : null;  // 取元数据即可，不下载 body（省资源）
    if (fileObj) {
      const name = davPath.split('/').pop();
      const mtime = fileObj.uploaded || new Date();
      const xml = '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<d:multistatus xmlns:d="DAV:">\n' +
        davItemXml(baseUrl + davPath, name, {
          isCollection: false,
          size: fileObj.size || 0,
          mtime,
          contentType: fileObj.httpMetadata?.contentType || 'application/octet-stream',
          etag: fileObj.etag || ''
        }) +
        '</d:multistatus>';
      return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
    }

    const prefix = davPath ? davPath + '/' : '';
    const { objects, folders } = await listDir(env, prefix);

    let xml = '<d:multistatus xmlns:d="DAV:">\n';
    if (depth !== '1') {
      xml += davItemXml(
        baseUrl + (davPath ? davPath + '/' : ''),
        davPath ? davPath.split('/').pop() : '/',
        { isCollection: true, size: 0, mtime: new Date(), contentType: 'httpd/unix-directory' }
      );
    }

    if (depth === '0') {
      xml += '</d:multistatus>';
      return davXmlResponse(xml);
    }
    for (const folderName of folders) {
      const folderPath = (davPath ? davPath + '/' : '') + folderName;
      xml += davItemXml(
        baseUrl + folderPath + '/',
        folderName,
        { isCollection: true, size: 0, mtime: new Date(), contentType: 'httpd/unix-directory' }
      );
    }
    for (const obj of objects) {
      const objPath = obj.key;
      const name = objPath.split('/').pop();
      const mtime = obj.uploaded || new Date();
      xml += davItemXml(
        baseUrl + objPath,
        name,
        { isCollection: false, size: obj.size || 0, mtime, contentType: obj.httpMetadata?.contentType || 'application/octet-stream', etag: obj.etag || '' }
      );
    }

    xml += '</d:multistatus>';
    return davXmlResponse(xml);

  } catch (e) {
    return davXmlResponse(
      `<d:error xmlns:d="DAV:"><d:responsedescription>${xmlEscape(e.message)}</d:responsedescription></d:error>`,
      500
    );
  }
}

async function handleDavGet(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const filename = key.split('/').pop();

    // 无 Range：直接整文件下载（1 次 get），不提前拉整文件用于校验
    if (!request.headers.get('Range')) {
      const obj = await env.R2_BUCKET.get(key);
      if (!obj) {
        if (await isCollection(env, key)) return handleDavPropfind(request, env, davPath);
        return new Response('Not Found', { status: 404 });
      }
      const getHeaders = davHeaders(obj, filename);
      // 协商缓存命中：直接 304，不下行 body
      if (notModified(obj, request)) {
        return new Response(null, { status: 304, headers: notModifiedHeaders(obj) });
      }
      return new Response(obj.body, { status: 200, headers: getHeaders });
    }

    // Range 续传：先 head 取元数据(不下载 body)，再按区间取切片(206)，避免拉整文件
    const meta = await env.R2_BUCKET.head(key);
    if (!meta) {
      if (await isCollection(env, key)) return handleDavPropfind(request, env, davPath);
      return new Response('Not Found', { status: 404 });
    }
    // 协商缓存命中（不带 If-Range 时）：直接 304
    if (notModified(meta, request) && !request.headers.get('If-Range')) {
      return new Response(null, { status: 304, headers: notModifiedHeaders(meta) });
    }
    const range = request.headers.get('Range');
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const size = meta.size;
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end !== null) { start = Math.max(0, size - end); end = size - 1; }
      else if (start !== null) {
        if (end === null) end = size - 1;
        if (end >= size) end = size - 1;
        if (start > end) return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      if (start !== null && end !== null) {
        const len = end - start + 1;
        const ranged = await env.R2_BUCKET.get(key, { offset: start, length: len });
        const headers = davHeaders(meta, filename);
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        headers.set('Content-Length', String(len));
        return new Response(ranged.body, { status: 206, headers });
      }
    }

    // 无法解析的 Range：回退整文件下载
    const object = await env.R2_BUCKET.get(key);
    if (!object) return new Response('Not Found', { status: 404 });
    return new Response(object.body, { status: 200, headers: davHeaders(object, filename) });
  } catch (e) {
    return new Response('Internal Server Error: ' + e.message, { status: 500 });
  }
}

async function handleDavHead(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const filename = key.split('/').pop();
    const meta = await env.R2_BUCKET.head(key);  // 仅取元数据，不下载 body（省资源）
    if (!meta) {
      if (await isCollection(env, key)) {
        return new Response(null, { status: 200, headers: { 'Content-Type': 'httpd/unix-directory' } });
      }
      return new Response(null, { status: 404 });
    }

    return new Response(null, {
      status: 200,
      headers: davHeaders(meta, filename)
    });
  } catch (e) {
    return new Response(null, { status: 500 });
  }
}

async function handleDavPut(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const contentType = request.headers.get('Content-Type') || getMimeType(key) || 'application/octet-stream';
    await env.R2_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('Upload failed: ' + e.message, { status: 500 });
  }
}

async function handleDavDelete(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    await deleteR2Folder(env, davPath);
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response('Delete failed: ' + e.message, { status: 500 });
  }
}

async function handleDavMkcol(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const existingDir = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
    if (existingDir.objects?.length > 0 || existingDir.delimitedPrefixes?.length > 0) {
      return new Response(null, { status: 201 });
    }
    await env.R2_BUCKET.put(key + '/.keep', '', { httpMetadata: { contentType: 'text/plain' } });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MKCOL failed: ' + e.message, { status: 500 });
  }
}

async function handleDavMove(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    const { srcKey, dstKey } = parsed;

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (!srcObj) {
      const srcCheck = await env.R2_BUCKET.list({ prefix: srcKey + '/', delimiter: '/', limit: 1 });
      if (!srcCheck.objects?.length && !srcCheck.delimitedPrefixes?.length) {
        return new Response('Not Found', { status: 404 });
      }
      await copyR2Folder(env, srcKey, dstKey);
      await deleteR2Folder(env, srcKey);
      return new Response(null, { status: 201 });
    }

    await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
    await env.R2_BUCKET.delete(srcKey);
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MOVE failed: ' + e.message, { status: 500 });
  }
}

async function handleDavCopy(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    const { srcKey, dstKey } = parsed;

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (srcObj) {
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      return new Response(null, { status: 201 });
    }

    const srcList = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
    if (srcList.objects?.length > 0 || srcList.delimitedPrefixes?.length > 0) {
      await copyR2Folder(env, srcKey, dstKey);
      return new Response(null, { status: 201 });
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return new Response('COPY failed: ' + e.message, { status: 500 });
  }
}

function handleDavLock() {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:prop xmlns:d="DAV:">
  <d:lockdiscovery>
    <d:activelock>
      <d:locktype><d:write/></d:locktype>
      <d:lockscope><d:exclusive/></d:lockscope>
      <d:depth>infinity</d:depth>
      <d:timeout>Second-3600</d:timeout>
      <d:locktoken>
        <d:href>urn:uuid:00000000-0000-0000-0000-000000000000</d:href>
      </d:locktoken>
    </d:activelock>
  </d:lockdiscovery>
</d:prop>`;
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Lock-Token': '<urn:uuid:00000000-0000-0000-0000-000000000000>' }
  });
}

function handleDavUnlock() {
  return new Response(null, { status: 204 });
}

function requireDavAuth(request, resType = 'text') {
  const headers = {
    'WWW-Authenticate': 'Basic realm="WebDAV", charset="UTF-8"',
  };
  if (resType === 'xml') {
    return davXmlResponse(
      '<d:error xmlns:d="DAV:"><d:responsedescription>Unauthorized</d:responsedescription></d:error>',
      401
    );
  }
  return new Response('Unauthorized', { status: 401, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const method = request.method;

    if (method === 'OPTIONS') {
      if (path.startsWith('/dav')) {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, OPTIONS, HEAD, LOCK, UNLOCK',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, Destination, Overwrite, Range',
          }
        });
      }
      return new Response(null, { status: 204 });
    }

    try {
      if (path === '/login' && method === 'GET') {
        return new Response(LOGIN_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      if (path === '/api/login' && method === 'POST') {
        return await handleApiLogin(request, env);
      }
      const auth = await verifyAuth(request, env);

      if (path === '/' || path === '/index.html') {
        if (!auth) return Response.redirect(url.origin + '/login', 302);
        const params = new URLSearchParams(url.search);
        const currentPath = params.get('path') || '';
        return new Response(getIndexPage(currentPath), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      if (path === '/api/list') return await handleApiList(request, env);
      if (path === '/api/upload') return await handleApiUpload(request, env);
      if (path === '/api/delete') return await handleApiDelete(request, env);
      if (path === '/api/mkdir') return await handleApiMkdir(request, env);
      if (path === '/api/rename') return await handleApiRename(request, env);
      if (path === '/api/download') {
        if (!auth) return new Response('Unauthorized', { status: 401 });
        const filePath = normalizePath(url.searchParams.get('path') || '');
        const fileName = url.searchParams.get('name') || '';
        const key = fileName ? filePath + '/' + fileName : filePath;
        const downloadName = fileName || key.split('/').pop();
        const disp = 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(downloadName) + '\'';

        // 断点续传：带 Range 时按区间下发 206，不带则整文件下载
        const range = request.headers.get('Range');
        if (range) {
          const meta = await env.R2_BUCKET.head(key);
          if (!meta) return new Response('Not Found', { status: 404 });
          const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
          const size = meta.size;
          if (m) {
            let start = m[1] === '' ? null : Number(m[1]);
            let end = m[2] === '' ? null : Number(m[2]);
            if (start === null && end !== null) { start = Math.max(0, size - end); end = size - 1; }
            else if (start !== null) {
              if (end === null) end = size - 1;
              if (end >= size) end = size - 1;
              if (start > end) return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
            }
            if (start !== null && end !== null) {
              const len = end - start + 1;
              const ranged = await env.R2_BUCKET.get(key, { offset: start, length: len });
              const headers = new Headers({
                'Content-Type': meta.httpMetadata?.contentType || getMimeType(key),
                'Content-Disposition': disp,
                'Accept-Ranges': 'bytes',
                'ETag': meta.etag ? `"${meta.etag}"` : (meta.httpEtag || ''),
                'Last-Modified': rfc1123Date(meta.uploaded),
                'Content-Length': String(len),
                'Content-Range': `bytes ${start}-${end}/${size}`,
              });
              return new Response(ranged.body, { status: 206, headers });
            }
          }
        }

        // 无 Range 或无法解析：整文件下载
        const obj = await env.R2_BUCKET.get(key);
        if (!obj) return new Response('Not Found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || getMimeType(key),
            'Content-Disposition': disp,
            'Content-Length': obj.size,
            'Accept-Ranges': 'bytes',
          }
        });
      }
      if (path.startsWith('/dav/') || path === '/dav') {
        let davPath = path === '/dav' ? '' : path.slice(5);
        if (davPath.startsWith('/')) davPath = davPath.slice(1);
        davPath = davPath.replace(/\/$/, '');

        const methodMap = {
          'OPTIONS': () => handleDavOptions(),
          'PROPFIND': () => handleDavPropfind(request, env, davPath),
          'GET': () => handleDavGet(request, env, davPath),
          'HEAD': () => handleDavHead(request, env, davPath),
          'PUT': () => handleDavPut(request, env, davPath),
          'DELETE': () => handleDavDelete(request, env, davPath),
          'MKCOL': () => handleDavMkcol(request, env, davPath),
          'MOVE': () => handleDavMove(request, env, davPath),
          'COPY': () => handleDavCopy(request, env, davPath),
          'LOCK': () => handleDavLock(),
          'UNLOCK': () => handleDavUnlock(),
        };

        const handler = methodMap[method];
        if (handler) return await handler();
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Error:', error);
      return new Response('Internal Server Error: ' + error.message, { status: 500 });
    }
  }
};
