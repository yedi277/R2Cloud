/**
name = "mycloud"

[[kv_namespaces]]
binding = "KV_STORE"
id = "你的KV命名空间ID"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "你的R2桶名"

[vars]
ADMIN_PASSWORD = "你的管理员密码"
*/
function generateId(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeTokenCookie(token, maxAge = 86400) {
  return { 'Set-Cookie': `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` };
}

async function incrementStat(env, key, delta = 1) {
  const val = parseInt(await env.KV_STORE.get(key) || '0') + delta;
  await env.KV_STORE.put(key, String(Math.max(0, val)));
}

function base64UrlEncode(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${encodedHeader}.${encodedPayload}`)
  );

  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureData = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureData,
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );

    if (!valid) return null;

    const payload = JSON.parse(atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/')));

    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

function getExpirationTime(expiresIn) {
  const now = Date.now();
  switch (expiresIn) {
    case '1h': return now + 60 * 60 * 1000;
    case '1d': return now + 24 * 60 * 60 * 1000;
    case '1m': return now + 30 * 24 * 60 * 60 * 1000;
    case 'permanent': return null;
    default: return now + 24 * 60 * 60 * 1000;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const mmdd = pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.getFullYear() === now.getFullYear()) return mmdd + ' ' + hhmm;
  return String(d.getFullYear()).slice(2) + '-' + mmdd + ' ' + hhmm;
}

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
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getPreviewType(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) {
    return 'image';
  }

  if (ext === 'pdf') {
    return 'pdf';
  }

  if (['html', 'htm'].includes(ext)) {
    return 'html';
  }
//扩充编程文件扩展名列表
  if (['txt', 'md', 'json', 'js', 'ts', 'css', 'xml', 'yaml', 'yml', 'ini', 'conf', 'sh', 'py', 'php', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'vue', 'tsx', 'jsx', 'toml', 'sql', 'log', 'bat', 'ps1', 'html', 'htm'].includes(ext)) {
    return 'text';
  }

  if (ext === 'docx') {
    return 'word';
  }

  if (['mp4', 'webm', 'ogg'].includes(ext)) {
    return 'video';
  }

  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
    return 'audio';
  }

  return null;
}

function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  return cookies;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers
    }
  });
}

async function handleLogin(request, env) {
  try {
    const { email, password, isAdmin, isGuest } = await request.json();

    if (isGuest) {
      if (!(await getGlobalSettings(env)).guestLogin) return jsonResponse({ success: false, message: '管理员已关闭游客登录' }, 403);
      return jsonResponse({ success: true, role: 'guest' }, 200,
        makeTokenCookie(await createJWT({ role: 'guest', exp: Date.now() + 86400000 }, env.ADMIN_PASSWORD)));
    }

    if (isAdmin) {
      if (password !== env.ADMIN_PASSWORD) return jsonResponse({ success: false, message: '密码错误' }, 401);
      return jsonResponse({ success: true, role: 'admin' }, 200,
        makeTokenCookie(await createJWT({ role: 'admin', exp: Date.now() + 86400000 }, env.ADMIN_PASSWORD)));
    }

    if (!email || !password) return jsonResponse({ success: false, message: '请输入邮箱和密码' }, 400);

    const userData = await env.KV_STORE.get(`user:${email}`);
    if (!userData) return jsonResponse({ success: false, message: '用户不存在' }, 401);

    const user = JSON.parse(userData);
    if (user.passwordHash !== await hashPassword(password)) return jsonResponse({ success: false, message: '密码错误' }, 401);

    return jsonResponse({ success: true, role: 'user', email: user.email }, 200,
      makeTokenCookie(await createJWT({ email: user.email, role: 'user', exp: Date.now() + 86400000 }, env.ADMIN_PASSWORD)));
  } catch (e) {
    return jsonResponse({ success: false, message: '登录失败: ' + e.message }, 500);
  }
}

async function handleLogout() {
  return jsonResponse(
    { success: true },
    200,
    { 'Set-Cookie': 'token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }
  );
}

async function verifyAuth(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.token;

  if (!token) return null;

  return await verifyJWT(token, env.ADMIN_PASSWORD);
}

async function requireAuth(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) {
    return jsonResponse({ success: false, message: '未授权' }, 401);
  }
  return auth;
}

async function requireAdmin(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth || auth.role !== 'admin') {
    return jsonResponse({ success: false, message: '需要管理员权限' }, 403);
  }
  return auth;
}
function normalizePath(p) {
  if (!p) return '';
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

function normalizeFolder(f) {
  if (!f) return '';
  return f.replace(/^\/+|\/+$/g, '');
}

function apiPathToFilePath(apiPath) {
  const prefixes = ['/api/files', '/api/preview', '/api/download', '/api/edit'];
  for (const p of prefixes) {
    if (apiPath.startsWith(p)) {
      const rest = apiPath.slice(p.length);
      return rest || '/';
    }
  }
  return apiPath;
}

async function checkPathAccess(auth, env, targetPath) {
  const key = auth.role === 'guest' ? '__guest__' : (auth.email || null);
  if (!key) return null;
  const limits = await getUserLimits(env, key);
  if (!limits.allowedFolders || limits.allowedFolders.length === 0) return null;
  const t = normalizeFolder(targetPath);
  const allowed = limits.allowedFolders.some(f => {
    const norm = normalizeFolder(f);
    return t === norm || t.startsWith(norm + '/');
  });
  if (!allowed) {
    const msg = auth.role === 'guest'
      ? `游客只能访问 ${limits.allowedFolders.join(', ')} 文件夹`
      : '你没有权限执行此操作';
    return jsonResponse({ success: false, message: msg }, 403);
  }
  return null;
}
async function getGuestAllowedFolders(env) {
  const limits = await getUserLimits(env, '__guest__');
  return (limits && limits.allowedFolders && limits.allowedFolders.length > 0)
    ? limits.allowedFolders.map(f => normalizeFolder(f))
    : ['guest'];
}
async function parseDavDestination(request, davPath, auth, env, checkSrcAccess) {
  const destHeader = request.headers.get('Destination');
  if (!destHeader) return new Response('Missing Destination header', { status: 400 });
  try {
    const destUrl = new URL(destHeader);
    const destPath = decodeURIComponent(destUrl.pathname.replace(/^\/dav\/?/, ''));
    const srcKey = normalizePath(davPath);
    const dstKey = normalizePath(destPath);
    if (checkSrcAccess && auth.role !== 'admin') {
      const srcErr = await checkPathAccess(auth, env, srcKey);
      if (srcErr) return srcErr;
    }
    if (auth.role !== 'admin') {
      const dstErr = await checkPathAccess(auth, env, dstKey);
      if (dstErr) return dstErr;
    }
    return { srcKey, dstKey };
  } catch (e) {
    return new Response('Invalid Destination header', { status: 400 });
  }
}
async function getMaxUploadSize(env, auth) {
  const globalSettings = await getGlobalSettings(env);
  let limits = null;
  if (auth.role === 'guest') {
    limits = await getUserLimits(env, '__guest__');
  } else if (auth.email) {
    limits = await getUserLimits(env, auth.email);
  }
  if (limits && limits.maxUploadSize > 0) return limits.maxUploadSize * 1024 * 1024;
  if (globalSettings.maxUploadSize > 0) return globalSettings.maxUploadSize * 1024 * 1024;
  return 0;
}
async function deleteR2Folder(env, key) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: key + '/', cursor });
    if (batch.objects && batch.objects.length > 0) {
      await env.R2_BUCKET.delete(batch.objects.map(obj => obj.key));
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  await env.R2_BUCKET.delete(key);
}
async function copyR2Folder(env, srcKey, dstKey) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: srcKey + '/', cursor });
    if (batch.objects) {
      for (const obj of batch.objects) {
        const newKey = dstKey + '/' + obj.key.slice(srcKey.length + 1);
        const srcFile = await env.R2_BUCKET.get(obj.key);
        if (srcFile) {
          await env.R2_BUCKET.put(newKey, srcFile.body, { httpMetadata: srcFile.httpMetadata });
        }
      }
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
}

async function handleListFiles(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const filePathRaw = apiPathToFilePath(path);
    let prefix = normalizePath(filePathRaw);
    if (prefix && !prefix.endsWith('/')) prefix += '/';

    if (auth.role === 'guest') {
      const allowedFolders = await getGuestAllowedFolders(env);
      const guestRoot = allowedFolders[0] + '/';
      if (prefix === '' || prefix === '/') {
        prefix = guestRoot;
      } else {
        const guestErr = await checkPathAccess(auth, env, prefix.replace(/\/+$/, ''));
        if (guestErr) return guestErr;
      }
    }
    if (auth.email && auth.role !== 'guest' && (prefix === '' || prefix === '/')) {
      const limits = await getUserLimits(env, auth.email);
      if (limits && limits.allowedFolders && limits.allowedFolders.length > 0) {
        const allListed = await env.R2_BUCKET.list({ delimiter: '/' });
        const allowedSet = new Set(limits.allowedFolders.map(f => normalizeFolder(f)));

        const files = [];
        const folders = [];

        if (allListed.delimitedPrefixes) {
          for (const folderPath of allListed.delimitedPrefixes) {
            const name = folderPath.slice(0, -1);
            if (allowedSet.has(name)) {
              folders.push({ name, path: '/' + name });
            }
          }
        }

        if (allListed.objects) {
          for (const obj of allListed.objects) {
            const name = obj.key;
            if (!name.includes('/') && allowedSet.has(name)) {
              const previewType = getPreviewType(name);
              files.push({
                name, path: '/' + obj.key, size: obj.size,
                sizeFormatted: formatFileSize(obj.size),
                timeFormatted: formatTime(obj.uploaded.toISOString()),
                lastModified: obj.uploaded.toISOString(), previewType
              });
            }
          }
        }

        return jsonResponse({ success: true, files, folders, currentPath: '/' });
      }
    }

    const accessErr = await checkPathAccess(auth, env, prefix.replace(/\/+$/, ''));
    if (accessErr) return accessErr;

    const listed = await env.R2_BUCKET.list({ prefix, delimiter: '/' });

    const files = [];
    const folders = [];

    if (listed.delimitedPrefixes) {
      for (const folderPath of listed.delimitedPrefixes) {
        const name = folderPath.slice(prefix.length, -1);
        if (name) {
          folders.push({ name, path: '/' + folderPath.slice(0, -1) });
        }
      }
    }

    if (listed.objects) {
      for (const obj of listed.objects) {
        const name = obj.key.slice(prefix.length);
        if (name && !name.includes('/')) {
          const previewType = getPreviewType(name);
          files.push({
            name,
            path: '/' + obj.key,
            size: obj.size,
            sizeFormatted: formatFileSize(obj.size),
            timeFormatted: formatTime(obj.uploaded.toISOString()),
            lastModified: obj.uploaded.toISOString(),
            previewType
          });
        }
      }
    }

    return jsonResponse({ success: true, files, folders, currentPath: '/' + prefix.slice(0, -1) || '/' });
  } catch (e) {
    return jsonResponse({ success: false, message: '获取文件列表失败: ' + e.message }, 500);
  }
}

async function handleSearchFiles(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const mode = url.searchParams.get('mode') || 'quick'; // 'quick' or 'full'
  if (!query) return jsonResponse({ success: true, results: [] });

  try {
    const results = [];
    let cursor = undefined;
    let pages = 0;
    const maxPages = mode === 'full' ? 9999 : 10;
    let guestAllowedFolders = null;
    if (auth.role === 'guest') {
      guestAllowedFolders = await getGuestAllowedFolders(env);
    }

    do {
      pages++;
      const options = cursor ? { cursor, limit: 1000 } : { limit: 1000 };
      if (guestAllowedFolders && guestAllowedFolders.length === 1) {
        options.prefix = guestAllowedFolders[0] + '/';
      }

      const listed = await env.R2_BUCKET.list(options);
      if (!listed.objects) break;

      for (const obj of listed.objects) {
        if (guestAllowedFolders) {
          const hasAccess = guestAllowedFolders.some(norm => {
            return obj.key.startsWith(norm + '/') || obj.key === norm || obj.key === norm + '/';
          });
          if (!hasAccess) continue;
        }
        const name = obj.key.split('/').pop();
        if (name && name.toLowerCase().includes(query)) {
          const parts = obj.key.split('/');
          const folderPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
          results.push({
            name,
            path: '/' + obj.key,
            folder: folderPath,
            size: obj.size,
            sizeFormatted: formatFileSize(obj.size),
            timeFormatted: formatTime(obj.uploaded.toISOString()),
            lastModified: obj.uploaded.toISOString()
          });
        }
        if (results.length >= 50) break;
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor && pages < maxPages && results.length < 50);

    results.sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ success: true, results: results.slice(0, 50), mode, scannedPages: pages });
  } catch (e) {
    return jsonResponse({ success: false, message: '搜索失败: ' + e.message }, 500);
  }
}

async function handleGetFavorites(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const data = await env.KV_STORE.get(getFavoritesKey(auth));
  return jsonResponse({ success: true, favorites: data ? JSON.parse(data) : [] }, 200, { 'Cache-Control': 'private, max-age=5' });
}

async function handleAddFavorite(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const { name, path } = await request.json();
  if (!name || !path) return jsonResponse({ success: false, message: '缺少参数' }, 400);

  const key = getFavoritesKey(auth);
  const favorites = JSON.parse((await env.KV_STORE.get(key)) || '[]');
  if (favorites.some(f => f.path === path)) return jsonResponse({ success: false, message: '已在收藏夹中' });
  favorites.push({ name, path });
  await env.KV_STORE.put(key, JSON.stringify(favorites));
  return jsonResponse({ success: true, favorites });
}

async function handleRemoveFavorite(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const index = parseInt(new URL(request.url).searchParams.get('index'));
  const key = getFavoritesKey(auth);
  const favorites = JSON.parse((await env.KV_STORE.get(key)) || '[]');
  if (isNaN(index) || index < 0 || index >= favorites.length) return jsonResponse({ success: false, message: '无效索引' }, 400);

  favorites.splice(index, 1);
  await env.KV_STORE.put(key, JSON.stringify(favorites));
  return jsonResponse({ success: true, favorites });
}

async function handleReorderFavorites(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const { favorites } = await request.json();
    if (!Array.isArray(favorites)) return jsonResponse({ success: false, message: '无效数据' }, 400);
    const key = getFavoritesKey(auth);
    await env.KV_STORE.put(key, JSON.stringify(favorites));
    return jsonResponse({ success: true, favorites });
  } catch (e) {
    return jsonResponse({ success: false, message: '保存顺序失败: ' + e.message }, 500);
  }
}

function getFavoritesKey(auth) {
  if (auth.role === 'guest') return 'favorites:guest';
  if (auth.role === 'admin') return 'favorites:admin';
  return 'favorites:user:' + (auth.email || 'unknown');
}

async function handleUploadFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return jsonResponse({ success: false, message: '没有上传文件' }, 400);
    const filePathRaw = apiPathToFilePath(path);
    let filePath = normalizePath(filePathRaw);
    if (filePath && !filePath.endsWith('/')) filePath += '/';
    if (auth.role === 'guest') {
      const allowedFolders = await getGuestAllowedFolders(env);
      const guestRoot = allowedFolders[0] + '/';
      if (!filePath.startsWith(guestRoot)) filePath = guestRoot + filePath;
    } else if (auth.email) {
      const accessErr = await checkPathAccess(auth, env, filePath);
      if (accessErr) return accessErr;
    }
    const maxSize = await getMaxUploadSize(env, auth);
    if (maxSize > 0 && file.size > maxSize) {
      return jsonResponse({ success: false, message: `文件大小超过限制 ${Math.round(maxSize / 1024 / 1024)}MB` }, 400);
    }

    const key = filePath + file.name;
    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || getMimeType(file.name) }
    });
    return jsonResponse({ success: true, message: '文件上传成功', path: '/' + key });
  } catch (e) {
    return jsonResponse({ success: false, message: '文件上传失败: ' + e.message }, 500);
  }
}

async function handleDeleteFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    let key = normalizePath(apiPathToFilePath(path));

    const guestErr = await checkPathAccess(auth, env, key);
    if (guestErr) return guestErr;

    const accessErr = await checkPathAccess(auth, env, key.split('/').slice(0, -1).join('/'));
    if (accessErr) return accessErr;

    await deleteR2Folder(env, key);

    return jsonResponse({ success: true, message: '删除成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '删除失败: ' + e.message }, 500);
  }
}

async function handleRenameFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { newName } = body;

    if (!newName) {
      return jsonResponse({ success: false, message: '请提供新名称' }, 400);
    }

    let oldKey = normalizePath(apiPathToFilePath(path));

    const guestErr = await checkPathAccess(auth, env, oldKey);
    if (guestErr) return guestErr;

    const parentPath = oldKey.includes('/') ? oldKey.substring(0, oldKey.lastIndexOf('/') + 1) : '';
    const newKey = parentPath + newName;

    // 新旧名称相同，直接返回成功，避免先 put 再 delete 导致文件被删
    if (oldKey === newKey) {
      return jsonResponse({ success: true, message: '名称未变更', newPath: '/' + newKey });
    }

    const oldObject = await env.R2_BUCKET.get(oldKey);
    if (!oldObject) {
      return jsonResponse({ success: false, message: '文件不存在' }, 404);
    }

    await env.R2_BUCKET.put(newKey, oldObject.body, {
      httpMetadata: oldObject.httpMetadata
    });

    await env.R2_BUCKET.delete(oldKey);

    return jsonResponse({ success: true, message: '重命名成功', newPath: '/' + newKey });
  } catch (e) {
    return jsonResponse({ success: false, message: '重命名失败: ' + e.message }, 500);
  }
}

async function handleCreateFolder(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    let folderPath = normalizePath(body.path || '');
    if (!folderPath) return jsonResponse({ success: false, message: '请提供文件夹路径' }, 400);

    if (!folderPath.endsWith('/')) folderPath += '/';

    const guestErr = await checkPathAccess(auth, env, folderPath);
    if (guestErr) return guestErr;

    const accessErr = await checkPathAccess(auth, env, folderPath.replace(/\/+$/, ''));
    if (accessErr) return accessErr;

    await env.R2_BUCKET.put(folderPath + '.folder', new Uint8Array(0));

    return jsonResponse({ success: true, message: '文件夹创建成功', path: '/' + folderPath.slice(0, -1) });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建文件夹失败: ' + e.message }, 500);
  }
}

async function handleCreateFile(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    let { path: filePath, content } = body;
    if (!filePath) return jsonResponse({ success: false, message: '请提供文件路径' }, 400);

    filePath = normalizePath(filePath);

    const guestErr = await checkPathAccess(auth, env, filePath);
    if (guestErr) return guestErr;

    const existing = await env.R2_BUCKET.get(filePath);
    if (existing) return jsonResponse({ success: false, message: '文件已存在' }, 409);

    await env.R2_BUCKET.put(filePath, new TextEncoder().encode(content || ''));

    return jsonResponse({ success: true, message: '文件创建成功', path: '/' + filePath });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建文件失败: ' + e.message }, 500);
  }
}

async function serveFile(request, env, path, { download = false, cache = false } = {}) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: '未授权' }, 401);

  try {
    let key = normalizePath(apiPathToFilePath(path));
    const object = await env.R2_BUCKET.get(key);
    if (!object) return jsonResponse({ success: false, message: '文件不存在' }, 404);

    const filename = key.split('/').pop();
    const headers = {
      'Content-Type': object.httpMetadata?.contentType || getMimeType(filename),
      'Content-Length': object.size
    };
    if (download) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`;
    if (cache) headers['Cache-Control'] = 'private, max-age=3600';
    return new Response(object.body, { headers });
  } catch (e) {
    return jsonResponse({ success: false, message: (download ? '下载' : '预览') + '失败: ' + e.message }, 500);
  }
}

async function handleEditFile(request, env, path) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: '未授权' }, 401);

  const key = normalizePath(apiPathToFilePath(path));

  if (request.method === 'GET') {
    try {
      const object = await env.R2_BUCKET.get(key);
      if (!object) return jsonResponse({ success: false, message: '文件不存在' }, 404);
      return new Response(await object.text(), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    } catch (e) {
      return jsonResponse({ success: false, message: '读取失败: ' + e.message }, 500);
    }
  }

  if (request.method === 'PUT') {
    try {
      const content = await request.text();
      await env.R2_BUCKET.put(key, content, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
      return jsonResponse({ success: true, message: '保存成功' });
    } catch (e) {
      return jsonResponse({ success: false, message: '保存失败: ' + e.message }, 500);
    }
  }

  return jsonResponse({ success: false, message: '不支持的请求方法' }, 405);
}

async function handleCreateShare(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  if (auth.role === 'guest') return jsonResponse({ success: false, message: '游客无权创建分享链接' }, 403);

  try {
    const { filePath, password, expiresIn } = await request.json();
    if (!filePath) return jsonResponse({ success: false, message: '请提供文件路径' }, 400);

    const key = normalizePath(filePath);
    const object = await env.R2_BUCKET.head(key);
    if (!object) return jsonResponse({ success: false, message: '文件不存在' }, 404);

    const shareId = generateId(12);
    await env.KV_STORE.put(`share:${shareId}`, JSON.stringify({
      shareId, filePath: key, fileName: key.split('/').pop(), fileSize: object.size,
      passwordHash: password ? await hashPassword(password) : null,
      expiresAt: getExpirationTime(expiresIn || '1d'),
      viewCount: 0, downloadCount: 0, createdAt: Date.now()
    }));
    await incrementStat(env, 'stats:totalShares');
    return jsonResponse({ success: true, shareId, shareUrl: `/s/${shareId}` });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建分享链接失败: ' + e.message }, 500);
  }
}

async function handleGetShareInfo(request, env, shareId) {
  try {
    const raw = await env.KV_STORE.get(`share:${shareId}`);
    if (!raw) return jsonResponse({ success: false, message: '分享链接不存在' }, 404);
    const share = JSON.parse(raw);
    if (share.expiresAt && Date.now() > share.expiresAt) return jsonResponse({ success: false, message: '分享链接已过期' }, 410);

    share.viewCount++;
    await env.KV_STORE.put(`share:${shareId}`, JSON.stringify(share));
    await incrementStat(env, 'stats:totalViews');

    return jsonResponse({
      success: true, fileName: share.fileName, fileSize: share.fileSize,
      fileSizeFormatted: formatFileSize(share.fileSize),
      requiresPassword: !!share.passwordHash, expiresAt: share.expiresAt
    });
  } catch (e) {
    return jsonResponse({ success: false, message: '获取分享信息失败: ' + e.message }, 500);
  }
}

async function handleShareDownload(request, env, shareId) {
  try {
    const raw = await env.KV_STORE.get(`share:${shareId}`);
    if (!raw) return jsonResponse({ success: false, message: '分享链接不存在' }, 404);

    const share = JSON.parse(raw);
    if (share.expiresAt && Date.now() > share.expiresAt) {
      return jsonResponse({ success: false, message: '分享链接已过期' }, 410);
    }

    if (share.passwordHash) {
      const { password } = await request.json();
      if (!password) return jsonResponse({ success: false, message: '请输入密码' }, 401);
      if (await hashPassword(password) !== share.passwordHash) return jsonResponse({ success: false, message: '密码错误' }, 401);
    }

    const object = await env.R2_BUCKET.get(share.filePath);
    if (!object) return jsonResponse({ success: false, message: '文件不存在' }, 404);

    share.downloadCount++;
    await env.KV_STORE.put(`share:${shareId}`, JSON.stringify(share));
    await incrementStat(env, 'stats:totalDownloads');

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || getMimeType(share.fileName),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(share.fileName)}"`,
        'Content-Length': object.size
      }
    });
  } catch (e) {
    return jsonResponse({ success: false, message: '下载失败: ' + e.message }, 500);
  }
}

async function handleGetStats(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  try {
    const [totalShares, totalViews, totalDownloads] = await Promise.all([
      env.KV_STORE.get('stats:totalShares'), env.KV_STORE.get('stats:totalViews'), env.KV_STORE.get('stats:totalDownloads')
    ]);
    return jsonResponse({ success: true, totalShares: parseInt(totalShares||'0'), totalViews: parseInt(totalViews||'0'), totalDownloads: parseInt(totalDownloads||'0') });
  } catch (e) {
    return jsonResponse({ success: false, message: '获取统计数据失败: ' + e.message }, 500);
  }
}

const DEFAULT_SETTINGS = { guestLogin: true, maxUploadSize: 0, webdavEnabled: true, webdavReadOnly: false };

async function getGlobalSettings(env) {
  const raw = await env.KV_STORE.get('settings:global');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

async function handleGetSettings(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  try { return jsonResponse({ success: true, settings: await getGlobalSettings(env) }); }
  catch (e) { return jsonResponse({ success: false, message: '获取设置失败: ' + e.message }, 500); }
}

async function handleUpdateSettings(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  try {
    const { guestLogin, maxUploadSize, webdavEnabled, webdavReadOnly } = await request.json();
    const updated = { ...await getGlobalSettings(env) };
    if (typeof guestLogin === 'boolean') updated.guestLogin = guestLogin;
    if (typeof maxUploadSize === 'number' && maxUploadSize >= 0) updated.maxUploadSize = maxUploadSize;
    if (typeof webdavEnabled === 'boolean') updated.webdavEnabled = webdavEnabled;
    if (typeof webdavReadOnly === 'boolean') updated.webdavReadOnly = webdavReadOnly;
    await env.KV_STORE.put('settings:global', JSON.stringify(updated));
    return jsonResponse({ success: true, settings: updated, message: '设置已更新' });
  } catch (e) {
    return jsonResponse({ success: false, message: '更新设置失败: ' + e.message }, 500);
  }
}

const DEFAULT_USER_LIMITS = { role: 'user', maxUploadSize: 0, allowedFolders: [], webdavEnabled: true, webdavReadOnly: false };

async function getUserLimits(env, email) {
  try {
    const raw = await env.KV_STORE.get(`settings:user:${email}`);
    return raw ? { ...DEFAULT_USER_LIMITS, ...JSON.parse(raw) } : null;
  } catch { return null; }
}

async function handleGetUserSettings(request, env, email) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  try { return jsonResponse({ success: true, limits: (await getUserLimits(env, email)) || { ...DEFAULT_USER_LIMITS }, email }); }
  catch (e) { return jsonResponse({ success: false, message: '获取用户设置失败: ' + e.message }, 500); }
}

async function handleUpdateUserSettings(request, env, email) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  try {
    const { role, maxUploadSize, allowedFolders, webdavEnabled, webdavReadOnly } = await request.json();
    const isGuest = email === '__guest__';
    const defaultLimits = isGuest
      ? { maxUploadSize: 0, allowedFolders: ['guest'], webdavEnabled: true, webdavReadOnly: false }
      : { ...DEFAULT_USER_LIMITS };
    const existing = (await getUserLimits(env, email)) || defaultLimits;
    if (!isGuest && typeof role === 'string' && ['user', 'restricted'].includes(role)) existing.role = role;
    if (typeof maxUploadSize === 'number' && maxUploadSize >= 0) existing.maxUploadSize = maxUploadSize;
    if (Array.isArray(allowedFolders)) existing.allowedFolders = allowedFolders.filter(f => typeof f === 'string');
    if (typeof webdavEnabled === 'boolean') existing.webdavEnabled = webdavEnabled;
    if (typeof webdavReadOnly === 'boolean') existing.webdavReadOnly = webdavReadOnly;
    await env.KV_STORE.put(`settings:user:${email}`, JSON.stringify(existing));
    return jsonResponse({ success: true, limits: existing, message: '用户权限已更新' });
  } catch (e) {
    return jsonResponse({ success: false, message: '更新用户设置失败: ' + e.message }, 500);
  }
}

async function handleListShares(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const shares = []; let cursor;
    do {
      const listed = await env.KV_STORE.list({ prefix: 'share:', cursor });
      for (const key of listed.keys) {
        const data = await env.KV_STORE.get(key.name);
        if (data) {
          const s = JSON.parse(data);
          shares.push({ ...s, fileSizeFormatted: formatFileSize(s.fileSize), isExpired: s.expiresAt && Date.now() > s.expiresAt });
        }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor);
    shares.sort((a, b) => b.createdAt - a.createdAt);
    return jsonResponse({ success: true, shares });
  } catch (e) {
    return jsonResponse({ success: false, message: '获取分享列表失败: ' + e.message }, 500);
  }
}

async function handleDeleteShare(request, env, shareId) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  try {
    await env.KV_STORE.delete(`share:${shareId}`);
    await incrementStat(env, 'stats:totalShares', -1);
    return jsonResponse({ success: true, message: '分享链接已删除' });
  } catch (e) {
    return jsonResponse({ success: false, message: '删除分享链接失败: ' + e.message }, 500);
  }
}

async function handleListUsers(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const users = []; let cursor;
    const settings = await getGlobalSettings(env);
    users.push({
      email: '__guest__',
      role: 'guest',
      enabled: settings.guestLogin,
      createdAt: null
    });

    do {
      const listed = await env.KV_STORE.list({ prefix: 'user:', cursor });
      for (const key of listed.keys) {
        const data = await env.KV_STORE.get(key.name);
        if (data) {
          const u = JSON.parse(data);
          users.push({ email: u.email, role: u.role, createdAt: u.createdAt });
        }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor);
    return jsonResponse({ success: true, users });
  } catch (e) {
    return jsonResponse({ success: false, message: '获取用户列表失败: ' + e.message }, 500);
  }
}

async function handleCreateUser(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const { email, password } = await request.json();
    if (!email || !password) return jsonResponse({ success: false, message: '请提供邮箱和密码' }, 400);
    if (email === '__guest__') return jsonResponse({ success: false, message: '该邮箱为系统保留' }, 400);

    if (await env.KV_STORE.get(`user:${email}`)) return jsonResponse({ success: false, message: '用户已存在' }, 409);

    await env.KV_STORE.put(`user:${email}`, JSON.stringify({
      email, passwordHash: await hashPassword(password), role: 'user', createdAt: Date.now()
    }));
    return jsonResponse({ success: true, message: '用户创建成功', email });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建用户失败: ' + e.message }, 500);
  }
}

async function handleDeleteUser(request, env, email) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;
  if (email === '__guest__') return jsonResponse({ success: false, message: '不能删除游客' }, 400);
  try {
    await env.KV_STORE.delete(`user:${decodeURIComponent(email)}`);
    return jsonResponse({ success: true, message: '用户已删除' });
  } catch (e) {
    return jsonResponse({ success: false, message: '删除用户失败: ' + e.message }, 500);
  }
}

async function handleCheckAuth(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ authenticated: false });
  return jsonResponse({ authenticated: true, role: auth.role, email: auth.email || null });
}

function parseBasicAuth(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Basic ')) return null;
  try {
    const decoded = atob(authHeader.slice(6));
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      return { username: decoded, password: '' };
    }
    return { username: decoded.slice(0, colonIndex), password: decoded.slice(colonIndex + 1) };
  } catch { return null; }
}

async function webdavAuth(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.token;
  if (token) {
    const jwt = await verifyJWT(token, env.ADMIN_PASSWORD);
    if (jwt) {
      if (jwt.role === 'user' && jwt.email) {
        const limits = await getUserLimits(env, jwt.email);
        if (limits && limits.webdavEnabled === false) return null;
      }
      return jwt;
    }
  }
  const basic = parseBasicAuth(request);
  if (!basic) return null;
  const settings = await getGlobalSettings(env);
  if (basic.password === env.ADMIN_PASSWORD) {
    return { role: 'admin', email: null };
  }
  if (basic.username === 'guest') {
    if (!settings.guestLogin) return null;
    const guestLimits = await getUserLimits(env, '__guest__');
    if (guestLimits && guestLimits.webdavEnabled === false) return null;
    return { role: 'guest' };
  }
  const userData = await env.KV_STORE.get(`user:${basic.username}`);
  if (!userData) return null;
  const user = JSON.parse(userData);
  if (user.passwordHash !== await hashPassword(basic.password)) return null;
  const userLimits = await getUserLimits(env, user.email);
  if (userLimits && userLimits.webdavEnabled === false) return null;
  return { role: 'user', email: user.email };
}

async function isDavReadOnly(settings, auth, env) {
  if (settings.webdavReadOnly) return true;
  if (auth.role === 'guest') {
    const limits = await getUserLimits(env, '__guest__');
    if (limits && limits.webdavReadOnly) return true;
  } else if (auth.email) {
    const limits = await getUserLimits(env, auth.email);
    if (limits && limits.webdavReadOnly) return true;
  }
  return false;
}

function davXmlEsc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtRfc1123(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT`;
}

function buildPropstat(href, props, statusCode) {
  const statusMap = { 200: 'HTTP/1.1 200 OK', 404: 'HTTP/1.1 404 Not Found', 403: 'HTTP/1.1 403 Forbidden' };
  const s = statusMap[statusCode] || 'HTTP/1.1 200 OK';
  return `<D:response><D:href>${davXmlEsc(href)}</D:href><D:propstat><D:status>${s}</D:status><D:prop>${props}</D:prop></D:propstat></D:response>`;
}

async function handleDavPropfind(request, env, davPath, depth, auth) {
  const responses = [];
  let prefix = normalizePath(davPath);
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  const davBase = request.url.match(/^(https?:\/\/[^/]+)/)[1] + '/dav/';
  const currentHref = davBase + (davPath || '');
  const currentHrefSlash = currentHref.endsWith('/') ? currentHref : currentHref + '/';
  try {
    const key = normalizePath(davPath);
    const fileObj = await env.R2_BUCKET.head(key);
    if (fileObj) {
      const props = [
        '<D:resourcetype/>',
        `<D:getcontentlength>${fileObj.size}</D:getcontentlength>`,
        `<D:getlastmodified>${fmtRfc1123(fileObj.uploaded)}</D:getlastmodified>`,
        `<D:getcontenttype>${fileObj.httpMetadata?.contentType || getMimeType(key.split('/').pop())}</D:getcontenttype>`,
        `<D:getetag>"${fileObj.httpEtag || fileObj.uploaded.getTime()}"</D:getetag>`
      ].join('');
      responses.push(buildPropstat(currentHref, props, 200));
    } else {
      const listed = await env.R2_BUCKET.list({ prefix, delimiter: '/' });
      const folderProps = [
        '<D:resourcetype><D:collection/></D:resourcetype>',
        `<D:getlastmodified>${fmtRfc1123(new Date())}</D:getlastmodified>`
      ].join('');
      responses.push(buildPropstat(currentHrefSlash, folderProps, 200));
      if (depth !== '0') {
        if (listed.delimitedPrefixes) {
          for (const fp of listed.delimitedPrefixes) {
            const name = fp.slice(prefix.length, -1);
            if (!name) continue;
            const childHref = currentHrefSlash + name + '/';
            const childProps = [
              '<D:resourcetype><D:collection/></D:resourcetype>',
              `<D:getlastmodified>${fmtRfc1123(new Date())}</D:getlastmodified>`
            ].join('');
            responses.push(buildPropstat(childHref, childProps, 200));
          }
        }
        if (listed.objects) {
          for (const obj of listed.objects) {
            const name = obj.key.slice(prefix.length);
            if (!name || name === '.folder' || name.includes('/')) continue;
            const childHref = currentHrefSlash + name;
            const childProps = [
              '<D:resourcetype/>',
              `<D:getcontentlength>${obj.size}</D:getcontentlength>`,
              `<D:getlastmodified>${fmtRfc1123(obj.uploaded)}</D:getlastmodified>`,
              `<D:getcontenttype>${obj.httpMetadata?.contentType || getMimeType(name)}</D:getcontenttype>`,
              `<D:getetag>"${obj.etag || obj.uploaded.getTime()}"</D:getetag>`
            ].join('');
            responses.push(buildPropstat(childHref, childProps, 200));
          }
        }
      }
    }
  } catch (e) { /* fall through */ }
  if (responses.length === 0) {
    return new Response(null, { status: 404 });
  }
  const body = '<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n' + responses.join('\n') + '\n</D:multistatus>';
  return new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'DAV': '1,2' } });
}

async function handleDavGet(request, env, davPath, auth) {
  const key = normalizePath(davPath);
  const object = await env.R2_BUCKET.get(key);
  if (!object) return new Response('Not Found', { status: 404 });
  const filename = key.split('/').pop();
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || getMimeType(filename),
      'Content-Length': object.size,
      'ETag': `"${object.httpEtag || object.uploaded?.getTime() || ''}"`,
      'Last-Modified': fmtRfc1123(object.uploaded),
      'Cache-Control': 'no-cache'
    }
  });
}

async function handleDavPut(request, env, davPath, auth) {
  const settings = await getGlobalSettings(env);
  if (await isDavReadOnly(settings, auth, env)) {
    return new Response('WebDAV is in read-only mode', { status: 403 });
  }
  try {
    const maxSize = await getMaxUploadSize(env, auth);
    const contentLength = parseInt(request.headers.get('Content-Length') || '0');
    if (maxSize > 0 && contentLength > maxSize) {
      return new Response(`File size exceeds limit of ${Math.round(maxSize / 1024 / 1024)}MB`, { status: 413 });
    }
    if (auth.role === 'guest') {
      const allowedFolders = await getGuestAllowedFolders(env);
      const guestRoot = allowedFolders[0] + '/';
      const key = davPath.startsWith('/') ? normalizePath(davPath) : guestRoot + normalizePath(davPath);
      if (!key.startsWith(guestRoot)) {
        return new Response('Access denied', { status: 403 });
      }
      const contentType = request.headers.get('Content-Type') || getMimeType(key.split('/').pop());
      await env.R2_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
      return new Response(null, { status: 201 });
    }
    if (auth.email) {
      const accessErr = await checkPathAccess(auth, env, normalizePath(davPath));
      if (accessErr) return new Response('Access denied', { status: 403 });
    }
    const key = normalizePath(davPath);
    const contentType = request.headers.get('Content-Type') || getMimeType(key.split('/').pop());
    await env.R2_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('Upload failed: ' + e.message, { status: 500 });
  }
}

async function handleDavDelete(request, env, davPath, auth) {
  const settings = await getGlobalSettings(env);
  if (await isDavReadOnly(settings, auth, env)) {
    return new Response('WebDAV is in read-only mode', { status: 403 });
  }
  try {
    const key = normalizePath(davPath);
    if (auth.role === 'guest' || auth.email) {
      const accessErr = await checkPathAccess(auth, env, key);
      if (accessErr) return new Response('Access denied', { status: 403 });
    }
    await deleteR2Folder(env, key);
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response('Delete failed: ' + e.message, { status: 500 });
  }
}

async function handleDavMkcol(request, env, davPath, auth) {
  const settings = await getGlobalSettings(env);
  if (await isDavReadOnly(settings, auth, env)) {
    return new Response('WebDAV is in read-only mode', { status: 403 });
  }
  try {
    let folderPath = normalizePath(davPath);
    if (!folderPath) return new Response('Invalid path', { status: 400 });
    if (!folderPath.endsWith('/')) folderPath += '/';
    if (auth.role === 'guest' || auth.email) {
      const accessErr = await checkPathAccess(auth, env, folderPath.replace(/\/+$/, ''));
      if (accessErr) return new Response('Access denied', { status: 403 });
    }
    const existing = await env.R2_BUCKET.list({ prefix: folderPath, limit: 1 });
    if ((existing.objects && existing.objects.length > 0) || (existing.delimitedPrefixes && existing.delimitedPrefixes.length > 0)) {
      return new Response('Collection already exists', { status: 405 });
    }
    await env.R2_BUCKET.put(folderPath + '.folder', new Uint8Array(0));
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MKCOL failed: ' + e.message, { status: 500 });
  }
}

async function handleDavMove(request, env, davPath, auth) {
  const settings = await getGlobalSettings(env);
  if (await isDavReadOnly(settings, auth, env)) {
    return new Response('WebDAV is in read-only mode', { status: 403 });
  }
  const parsed = await parseDavDestination(request, davPath, auth, env, true);
  if (parsed instanceof Response) return parsed;
  const { srcKey, dstKey } = parsed;
  try {
    const overwrite = request.headers.get('Overwrite') !== 'F';
    const destExists = await env.R2_BUCKET.head(dstKey);
    if (destExists && !overwrite) {
      return new Response('Destination already exists', { status: 412 });
    }
    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (!srcObj) {
      const folderCheck = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
      if (folderCheck.objects && folderCheck.objects.length > 0) {
        await copyR2Folder(env, srcKey, dstKey);
        await deleteR2Folder(env, srcKey);
        return new Response(null, { status: 204 });
      }
      return new Response('Source not found', { status: 404 });
    }
    await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
    await env.R2_BUCKET.delete(srcKey);
    return new Response(null, { status: destExists ? 204 : 201 });
  } catch (e) {
    return new Response('MOVE failed: ' + e.message, { status: 500 });
  }
}

async function handleDavCopy(request, env, davPath, auth) {
  const settings = await getGlobalSettings(env);
  if (await isDavReadOnly(settings, auth, env)) {
    return new Response('WebDAV is in read-only mode', { status: 403 });
  }
  const parsed = await parseDavDestination(request, davPath, auth, env, false);
  if (parsed instanceof Response) return parsed;
  const { srcKey, dstKey } = parsed;
  try {
    const overwrite = request.headers.get('Overwrite') !== 'F';
    if (!overwrite) {
      const destExists = await env.R2_BUCKET.head(dstKey);
      if (destExists) return new Response('Destination already exists', { status: 412 });
    }
    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (!srcObj) {
      const folderCheck = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
      if (folderCheck.objects && folderCheck.objects.length > 0) {
        await copyR2Folder(env, srcKey, dstKey);
        return new Response(null, { status: 201 });
      }
      return new Response('Source not found', { status: 404 });
    }
    await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('COPY failed: ' + e.message, { status: 500 });
  }
}

function handleDavLock(request, env, davPath) {
  const lockToken = 'opaquelocktoken:' + generateId(16);
  const body = '<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:">\n<D:lockdiscovery>\n<D:activelock>\n<D:locktype><D:write/></D:locktype>\n<D:lockscope><D:exclusive/></D:lockscope>\n<D:depth>infinity</D:depth>\n<D:timeout>Second-3600</D:timeout>\n<D:locktoken><D:href>' + davXmlEsc(lockToken) + '</D:href></D:locktoken>\n</D:activelock>\n</D:lockdiscovery>\n</D:prop>';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Lock-Token': '<' + lockToken + '>' } });
}

function handleDavUnlock(request, env, davPath) {
  return new Response(null, { status: 204 });
}

async function handleWebDAV(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  let davPath = decodeURIComponent(url.pathname.replace(/^\/dav\/?/, ''));
  if (!davPath) davPath = '';

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK',
        'DAV': '1,2',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, Destination, Overwrite, If, Lock-Token',
        'Access-Control-Expose-Headers': 'DAV, Lock-Token'
      }
    });
  }

  const auth = await webdavAuth(request, env);
  if (!auth) {
    return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="WebDAV"', 'Content-Type': 'text/plain' } });
  }

  const settings = await getGlobalSettings(env);
  if (!settings.webdavEnabled) {
    return new Response('WebDAV is disabled', { status: 403 });
  }

  switch (method) {
    case 'GET':
    case 'HEAD': {
      const response = await handleDavGet(request, env, davPath, auth);
      if (method === 'HEAD') {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }
    case 'PUT':
      return await handleDavPut(request, env, davPath, auth);
    case 'DELETE':
      return await handleDavDelete(request, env, davPath, auth);
    case 'PROPFIND': {
      const depthHeader = request.headers.get('Depth') || 'infinity';
      return await handleDavPropfind(request, env, davPath, depthHeader, auth);
    }
    case 'MKCOL':
      return await handleDavMkcol(request, env, davPath, auth);
    case 'MOVE':
      return await handleDavMove(request, env, davPath, auth);
    case 'COPY':
      return await handleDavCopy(request, env, davPath, auth);
    case 'LOCK':
      return handleDavLock(request, env, davPath);
    case 'UNLOCK':
      return handleDavUnlock(request, env, davPath);
    default:
      return new Response('Method Not Allowed', { status: 405 });
  }
}

const CSS_STYLES = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --primary: #007AFF;
    --primary-hover: #0062cc;
    --background: #f5f5f7;
    --surface: #ffffff;
    --surface-hover: #f9f9fb;
    --border: rgba(0,0,0,0.08);
    --border-strong: rgba(0,0,0,0.12);
    --text: #1d1d1f;
    --text-muted: #86868b;
    --text-placeholder: #c7c7cc;
    --success: #34c759;
    --warning: #ff9500;
    --error: #ff3b30;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
    --shadow: 0 2px 8px rgba(0,0,0,0.08);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    --radius-sm: 8px;
    --radius: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
    --blur: saturate(180%) blur(20px);
    --transition: 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  [data-theme="dark"] {
    --primary: #0A84FF;
    --primary-hover: #409cff;
    --background: #000000;
    --surface: #1c1c1e;
    --surface-hover: #2c2c2e;
    --border: rgba(255,255,255,0.1);
    --border-strong: rgba(255,255,255,0.16);
    --text: #f5f5f7;
    --text-muted: #98989d;
    --text-placeholder: #636366;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
    --shadow: 0 2px 8px rgba(0,0,0,0.5);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.6);
  }

  .theme-toggle {
    background: none; border: 1px solid var(--border); border-radius: 50%;
    width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 16px; color: var(--text); transition: all var(--transition);
    flex-shrink: 0;
  }
  .theme-toggle:hover { background: var(--surface-hover); }

  [data-theme="dark"] .header { background: rgba(28,28,30,0.72); }
  [data-theme="dark"] .btn-secondary { background: rgba(255,255,255,0.08); }
  [data-theme="dark"] .btn-secondary:hover { background: rgba(255,255,255,0.14); }
  [data-theme="dark"] .new-file-dropdown > .new-file-dropdown-btn { border-left-color: rgba(255,255,255,0.15); }
  [data-theme="dark"] .login-container { background: #000; }
  [data-theme="dark"] .preview-text { background: #2c2c2e; color: #f5f5f7; }
  [data-theme="dark"] .preview-markdown { background: #2c2c2e; color: #f5f5f7; }
  [data-theme="dark"] .preview-markdown code { background: rgba(255,255,255,0.08); }
  [data-theme="dark"] .loading-overlay { background: rgba(0,0,0,0.5); }
  [data-theme="dark"] .view-toggle { background: rgba(255,255,255,0.06); }
  [data-theme="dark"] .view-toggle-btn { color: var(--text-muted); }
  [data-theme="dark"] .upload-overlay { background: rgba(10,132,255,0.08); }
  [data-theme="dark"] .context-menu { background: rgba(28,28,30,0.95); }
  [data-theme="dark"] .file-list-header { background: rgba(255,255,255,0.04); }
  [data-theme="dark"] tr:hover { background: rgba(255,255,255,0.04); }
  [data-theme="dark"] .tabs { background: rgba(255,255,255,0.04); }
  [data-theme="dark"] .preview-header { background: rgba(28,28,30,0.95); }
  [data-theme="dark"] .preview-filename { color: #f5f5f7; }
  [data-theme="dark"] .editor-statusbar { background: #0A84FF; }
  [data-theme="dark"] .form-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2398989d' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif;
    background: var(--background);
    color: var(--text);
    min-height: 100vh;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .main-layout { display: flex; max-width: 1200px; margin: 0 auto; padding: 24px; gap: 20px; min-height: calc(100vh - 61px); }
  .sidebar { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
  .sidebar-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 4px 12px 8px; }
  .sidebar-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--text); transition: all var(--transition); position: relative; }
  .sidebar-item:hover { background: var(--surface-hover); }
  .sidebar-item.active { background: rgba(0,122,255,0.1); color: var(--primary); font-weight: 500; }
  .sidebar-item-icon { font-size: 14px; flex-shrink: 0; opacity: 0.6; }
  .sidebar-item.active .sidebar-item-icon { opacity: 1; }
  .sidebar-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-item-remove { display: none; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; line-height: 1; flex-shrink: 0; }
  .sidebar-item:hover .sidebar-item-remove { display: block; }
  .sidebar-item-remove:hover { background: rgba(255,59,48,0.12); color: var(--error); }
  .sidebar-add { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; color: var(--text-muted); transition: all var(--transition); background: none; border: none; font-family: inherit; width: 100%; text-align: left; margin-top: 4px; }
  .sidebar-add:hover { background: var(--surface-hover); color: var(--primary); }
  .sidebar-item[draggable="true"] { cursor: grab; }
  .sidebar-item-dragging { opacity: 0.4; cursor: grabbing; }
  .sidebar-item-drop-target { background: rgba(0,122,255,0.12); border-radius: var(--radius-sm); }
  .sidebar-divider { height: 1px; background: var(--border); margin: 8px 12px; }
  .main-content { flex: 1; min-width: 0; }
  .container { padding: 0; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 18px; border: none; border-radius: var(--radius-sm);
    font-size: 13px; font-weight: 500; cursor: pointer;
    transition: all var(--transition); text-decoration: none;
    font-family: inherit; letter-spacing: -0.01em;
  }
  .btn-primary {
    background: var(--primary); color: #fff;
  }
  .btn-primary:hover {
    background: var(--primary-hover); box-shadow: 0 2px 8px rgba(0,122,255,0.3);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: rgba(0,0,0,0.04); color: var(--text);
  }
  .btn-secondary:hover {
    background: rgba(0,0,0,0.08);
  }
  .btn-danger {
    background: var(--error); color: #fff;
  }
  .btn-danger:hover {
    background: #e0352b;
  }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
  .new-file-dropdown { display: inline-flex; align-items: stretch; position: relative; }
  .new-file-dropdown > .btn { border-radius: 0; }
  .new-file-dropdown > .btn:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .new-file-dropdown > .new-file-dropdown-btn {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    border-left: 1px solid rgba(255,255,255,0.25);
    padding: 8px 10px; min-width: 30px;
  }
  .new-file-dropdown-menu {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 9999; min-width: 130px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    overflow: hidden; display: none;
  }
  .new-file-dropdown-menu.active { display: block; }
  .new-file-dropdown-menu.dropup { top: auto; bottom: calc(100% + 4px); }
  .new-file-dropdown-item {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 14px; font-size: 12px; cursor: pointer;
    transition: background var(--transition); color: var(--text);
  }
  .new-file-dropdown-item:hover { background: rgba(0,122,255,0.08); color: var(--primary); }
  .form-group { margin-bottom: 18px; }
  .form-label {
    display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;
    color: var(--text-muted);
  }
  .form-input, .form-select {
    width: 100%; padding: 10px 14px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text); font-size: 14px;
    transition: all var(--transition); font-family: inherit;
  }
  .form-input:focus, .form-select:focus {
    outline: none; border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(0,122,255,0.15);
  }
  .form-select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2386868b' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
  .form-help { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
    background: var(--border); border-radius: 24px; transition: 0.3s;
  }
  .toggle-slider:before {
    content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px;
    background: white; border-radius: 50%; transition: 0.3s;
  }
  .toggle-switch input:checked + .toggle-slider { background: var(--primary); }
  .toggle-switch input:checked + .toggle-slider:before { transform: translateX(20px); }
  .card {
    padding: 0; position: relative;
  }
  .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .card-title { font-size: 18px; font-weight: 600; }
  .header {
    background: rgba(255,255,255,0.72); backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    padding: 12px 24px; display: flex; align-items: center;
    justify-content: space-between; border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 100;
  }
  .logo {
    font-size: 20px; font-weight: 700; color: var(--text);
    letter-spacing: -0.02em;
  }
  .header-actions { display: flex; gap: 8px; }
  .search-group { display: flex; align-items: stretch; flex: 1; max-width: 420px; margin: 0 16px; position: relative; }
  .search-box { position: relative; flex: 1; }
  .search-input {
    width: 100%; padding: 7px 36px 7px 14px; background: var(--surface-hover); border: 1px solid var(--border);
    border-radius: 20px 0 0 20px; color: var(--text); font-size: 13px; outline: none;
    transition: all var(--transition); font-family: inherit;
    -webkit-appearance: none;
  }
  .search-input::placeholder { color: var(--text-placeholder); }
  .search-input:focus { background: var(--surface); border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0,122,255,0.12); }
  .search-clear {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 20px; height: 20px; border: none; background: var(--surface-hover); color: var(--text-muted);
    border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1; display: none;
    align-items: center; justify-content: center; padding: 0; transition: all var(--transition);
  }
  .search-clear:hover { background: var(--border); color: var(--text); }
  .search-mode-select {
    background: var(--surface-hover); border: 1px solid var(--border); border-left: none;
    border-radius: 0 20px 20px 0; color: var(--text-muted); font-size: 12px;
    padding: 0 12px; cursor: pointer; outline: none; appearance: none;
    font-family: inherit; white-space: nowrap; transition: all var(--transition);
  }
  .search-mode-select:focus { border-color: var(--primary); }
  .search-group:focus-within .search-mode-select { border-color: var(--primary); }
  .search-mode-select:hover { background: var(--surface); }
  .search-input:focus ~ .search-clear { background: var(--surface); }
  .search-results {
    display: none; position: absolute; top: 100%; left: 0; right: 0; margin-top: 6px;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow-lg); max-height: 360px; overflow-y: auto; z-index: 200;
    animation: fadeIn 0.15s ease;
  }
  .search-results.active { display: block; }
  .search-result-item {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer;
    transition: background var(--transition); font-size: 13px; border-bottom: 1px solid var(--border);
  }
  .search-result-item:last-child { border-bottom: none; }
  .search-result-item:hover { background: var(--surface-hover); }
  .search-result-item.search-focus { background: var(--surface-hover); outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 4px; }
  .search-result-icon { font-size: 18px; flex-shrink: 0; opacity: 0.7; }
  .search-result-info { flex: 1; min-width: 0; }
  .search-result-name { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-result-path { font-size: 11px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-result-size { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
  .search-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
  .search-result-name mark { background: rgba(0,122,255,0.15); color: var(--primary); font-weight: 600; border-radius: 2px; padding: 0 1px; }
  .breadcrumb {
    display: flex; align-items: center; gap: 2px;
    padding: 4px 0; flex-wrap: wrap; font-size: 14px;
  }
  .breadcrumb-item { color: var(--text-muted); text-decoration: none; transition: color var(--transition); }
  .breadcrumb-item:hover { color: var(--primary); }
  .breadcrumb-item.active { color: var(--text); font-weight: 500; }
  .breadcrumb-separator { color: var(--border-strong); margin: 0 2px; }
  .nav-btn {
    width: 26px; height: 26px; border: 1px solid var(--border);
    border-radius: var(--radius-sm); background: var(--surface);
    cursor: pointer; font-size: 12px; color: var(--text);
    display: inline-flex; align-items: center; justify-content: center;
    transition: all var(--transition);
  }
  .nav-btn:hover:not(:disabled) { background: rgba(0,122,255,0.1); color: var(--primary); border-color: var(--primary); }
  .nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .file-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px; min-height: 200px; position: relative;
  }
  .file-grid.drag-over {
    background: rgba(0,122,255,0.04); border: 2px dashed var(--primary);
    border-radius: var(--radius-lg);
  }
  .file-grid.drag-over::before {
    content: '📦 拖放文件到此处上传'; position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%); font-size: 16px; font-weight: 500;
    color: var(--primary); pointer-events: none; z-index: 100;
  }

  .file-item {
    background: var(--surface); border-radius: var(--radius);
    padding: 10px 8px; cursor: pointer; transition: all var(--transition);
    border: 1px solid var(--border); position: relative;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .file-item:hover {
    border-color: rgba(0,122,255,0.3); box-shadow: var(--shadow);
    transform: translateY(-1px);
  }
  .file-item.selected {
    border-color: var(--primary); background: rgba(0,122,255,0.06);
    box-shadow: 0 0 0 3px rgba(0,122,255,0.12);
  }
  .file-item.selected:hover { transform: translateY(0); }
  .file-item.selected::before {
    content: '✓'; position: absolute; top: 6px; left: 6px;
    width: 20px; height: 20px; background: var(--primary); color: #fff;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700;
  }
  .file-icon { font-size: 32px; text-align: center; }
  .file-name {
    font-size: 12px; font-weight: 500; text-align: center;
    word-break: break-all; line-height: 1.3;
  }
  .file-meta {
    font-size: 11px; color: var(--text-muted); text-align: center;
  }
  .view-toggle {
    display: flex; background: rgba(0,0,0,0.04); border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .view-toggle-btn {
    padding: 7px 12px; border: none; background: transparent;
    color: var(--text-muted); cursor: pointer; font-size: 15px;
    transition: all var(--transition); line-height: 1;
  }
  .view-toggle-btn:hover { color: var(--text); }
  .view-toggle-btn.active { background: var(--primary); color: #fff; }
  .file-list { display: block !important; min-height: auto; }
  .file-list .file-item {
    display: grid; grid-template-columns: 36px 1fr 100px 80px 70px; align-items: center;
    gap: 8px; padding: 6px 12px; border-radius: 0; border-bottom: 1px solid var(--border);
    transition: background var(--transition); flex-direction: row;
  }
  .file-list .file-item:first-child { border-top: 1px solid var(--border); }
  .file-list .file-item:hover { background: var(--surface-hover); transform: none; border-color: transparent; border-bottom-color: var(--border); box-shadow: none; }
  .file-list .file-item.selected { background: rgba(0,122,255,0.06); border-color: transparent; border-bottom-color: var(--primary); box-shadow: none; }
  .file-list .file-icon { font-size: 20px; margin: 0; }
  .file-list .file-name { text-align: left; word-break: break-all; }
  .file-list .file-meta { text-align: right; white-space: nowrap; font-size: 12px; }
  .file-list-header {
    display: grid; grid-template-columns: 36px 1fr 100px 80px 70px; align-items: center;
    gap: 8px; padding: 6px 12px; background: rgba(0,0,0,0.02);
    border-bottom: 1px solid var(--border-strong); font-size: 10px; font-weight: 600;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em;
  }
  .sortable-header { transition: color var(--transition); }
  .sortable-header:hover { color: var(--primary); }
  .sortable-header.active { color: var(--primary); }
  .toolbar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
  .selection-info {
    margin-left: auto; padding: 6px 14px; background: var(--primary);
    color: #fff; border-radius: 20px; font-size: 12px; font-weight: 500;
    display: none; animation: fadeIn 0.2s ease;
  }
  .selection-info.active { display: inline-block; }
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; opacity: 0; visibility: hidden; transition: all 0.25s ease;
  }
  .modal-overlay.active { opacity: 1; visibility: visible; }
  .modal {
    background: var(--surface); border-radius: var(--radius-xl);
    padding: 28px; width: 90%; max-width: 480px;
    transform: scale(0.95); transition: all 0.25s cubic-bezier(0.25,0.1,0.25,1);
    max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-lg);
  }
  .modal-overlay.active .modal { transform: scale(1); }
  .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .modal-title { font-size: 18px; font-weight: 600; }
  .modal-close {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 22px; padding: 0; line-height: 1;
    width: 28px; height: 28px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; transition: all var(--transition);
  }
  .modal-close:hover { background: rgba(0,0,0,0.06); color: var(--text); }
  .preview-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.92); display: flex; flex-direction: column;
    z-index: 2000; opacity: 0; visibility: hidden; transition: all 0.3s ease;
  }
  .preview-overlay.active { opacity: 1; visibility: visible; }
  .preview-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 24px; background: rgba(255,255,255,0.95);
    backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .preview-filename { font-size: 15px; font-weight: 600; color: #1d1d1f; }
  .preview-actions { display: flex; gap: 8px; }
  .preview-content {
    flex: 1; overflow: auto; display: flex; align-items: center;
    justify-content: center; padding: 20px;
  }
  .preview-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-sm); }
  .preview-text {
    width: 100%; height: 100%; background: #f8f8fa; border-radius: var(--radius-sm);
    padding: 24px; overflow: auto; font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;
    color: #1d1d1f;
  }
  .preview-pdf { width: 100%; height: 100%; border: none; border-radius: var(--radius-sm); }
  .preview-html { width: 100%; height: 100%; border: none; border-radius: var(--radius-sm); background: #fff; }
  .preview-video, .preview-audio { max-width: 100%; max-height: 100%; }
  .preview-markdown {
    width: 100%; max-width: 900px; height: 100%;
    background: #f8f8fa; border-radius: var(--radius-sm);
    padding: 40px; overflow: auto; line-height: 1.8; color: #1d1d1f;
  }
  .preview-markdown h1, .preview-markdown h2, .preview-markdown h3 { margin-top: 24px; margin-bottom: 16px; }
  .preview-markdown p, .preview-markdown pre, .preview-markdown ul, .preview-markdown ol, .preview-markdown table { margin-bottom: 16px; }
  .preview-markdown code { background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', 'Menlo', monospace; font-size: 13px; }
  .preview-markdown pre { background: #1d1d1f; color: #f5f5f7; padding: 16px; border-radius: var(--radius-sm); overflow-x: auto; }
  .preview-markdown pre code { background: none; padding: 0; color: inherit; }
  .preview-markdown blockquote { border-left: 3px solid var(--primary); padding-left: 16px; margin: 16px 0; color: var(--text-muted); }
  .preview-markdown ul, .preview-markdown ol { padding-left: 24px; }
  .preview-markdown li { margin-bottom: 6px; }
  .preview-markdown a { color: var(--primary); }
  .preview-markdown img { max-width: 100%; border-radius: var(--radius-sm); }
  .preview-markdown table { width: 100%; border-collapse: collapse; }
  .preview-markdown th, .preview-markdown td { border: 1px solid var(--border); padding: 8px 12px; }
  .preview-loading { display: flex; flex-direction: column; align-items: center; gap: 16px; color: rgba(255,255,255,0.8); }
  .preview-error { text-align: center; color: var(--error); }
  .toast-container { position: fixed; top: 20px; right: 20px; z-index: 3000; display: flex; flex-direction: column; gap: 8px; }
  .toast {
    padding: 14px 18px; border-radius: var(--radius-sm); color: #fff; font-size: 14px;
    font-weight: 500; animation: slideIn 0.3s ease; display: flex;
    align-items: center; gap: 8px; min-width: 280px;
    box-shadow: var(--shadow-lg);
  }
  .toast-success { background: var(--success); }
  .toast-error { background: var(--error); }
  .toast-info { background: var(--primary); }
  .toast-warning { background: var(--warning); }

  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes selectPulse { 0% { background: rgba(0,122,255,0.08); } 50% { background: rgba(0,122,255,0.25); } 100% { background: transparent; } }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 30px; }
  .stat-card {
    background: var(--surface); border-radius: var(--radius-lg); padding: 28px 24px;
    text-align: center; border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  }
  .stat-value { font-size: 40px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
  .stat-label { color: var(--text-muted); font-size: 13px; margin-top: 6px; }
  .tabs {
    display: flex; gap: 4px; background: rgba(0,0,0,0.04); padding: 4px;
    border-radius: var(--radius); margin-bottom: 24px;
  }
  .tab {
    flex: 1; padding: 10px 20px; border: none; background: transparent;
    color: var(--text-muted); font-size: 14px; font-weight: 500;
    cursor: pointer; border-radius: var(--radius-sm); transition: all var(--transition);
    font-family: inherit;
  }
  .tab.active { background: var(--primary); color: #fff; }
  .tab:hover:not(.active) { color: var(--text); }
  .tab-content { display: none; }
  .tab-content.active { display: block; animation: fadeIn 0.25s ease; }
  .badge {
    display: inline-block; padding: 3px 8px; border-radius: 12px;
    font-size: 11px; font-weight: 600;
  }
  .badge-success { background: rgba(52,199,89,0.12); color: var(--success); }
  .badge-warning { background: rgba(255,149,0,0.12); color: var(--warning); }
  .badge-error { background: rgba(255,59,48,0.12); color: var(--error); }
  .badge-info { background: rgba(0,122,255,0.12); color: var(--primary); }
  .badge-guest { background: rgba(175,82,222,0.12); color: #af52de; }
  .table-container { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }
  th { font-weight: 600; color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
  tr:hover { background: var(--surface-hover); }
  .login-container {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%); padding: 20px;
  }
  .login-card, .share-card {
    background: var(--surface); border-radius: var(--radius-xl);
    padding: 40px; width: 100%; max-width: 420px;
    box-shadow: var(--shadow-lg); border: 1px solid var(--border);
  }
  .login-header { text-align: center; margin-bottom: 32px; }
  .login-logo { font-size: 28px; font-weight: 700; color: var(--text); margin-bottom: 4px; letter-spacing: -0.02em; }
  .login-subtitle { color: var(--text-muted); font-size: 15px; }

  .share-card {
    max-width: 480px; text-align: center;
  }
  .share-icon { font-size: 56px; margin-bottom: 16px; }
  .share-filename { font-size: 18px; font-weight: 600; margin-bottom: 4px; word-break: break-all; }
  .share-filesize { color: var(--text-muted); margin-bottom: 24px; }
  .share-expired { color: var(--error); font-size: 16px; }
  .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
  .empty-icon { font-size: 56px; margin-bottom: 12px; opacity: 0.4; }
  .spinner {
    width: 36px; height: 36px; border: 3px solid rgba(0,0,0,0.08);
    border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(245,245,247,0.7); backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 3000;
  }
  .upload-overlay {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,122,255,0.06); border: 2px dashed var(--primary);
    border-radius: var(--radius-lg); display: none; align-items: center;
    justify-content: center; z-index: 1000; pointer-events: none;
  }
  .upload-overlay.active { display: flex; }
  .upload-overlay-text { font-size: 22px; font-weight: 600; color: var(--primary); }
  .upload-progress-container {
    position: fixed; bottom: 24px; right: 24px; background: var(--surface);
    border-radius: var(--radius-lg); padding: 18px 24px;
    box-shadow: var(--shadow-lg); min-width: 320px; max-width: 400px;
    z-index: 2000; display: none; border: 1px solid var(--border);
  }
  .upload-progress-container.active { display: block; animation: slideIn 0.3s ease; }
  .upload-progress-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .upload-progress-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .upload-progress-close {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-size: 18px; padding: 0; line-height: 1; width: 24px; height: 24px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
  }
  .upload-progress-close:hover { background: rgba(0,0,0,0.05); color: var(--text); }
  .upload-progress-bar { height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden; margin-bottom: 12px; }
  .upload-progress-fill {
    height: 100%; background: var(--primary); border-radius: 3px;
    transition: width 0.3s ease; width: 0%;
  }
  .upload-progress-info { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-muted); }
  .upload-progress-filename { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .upload-progress-percentage { font-weight: 600; color: var(--primary); }
  .context-menu {
    position: fixed; background: rgba(255,255,255,0.95);
    backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border-radius: var(--radius); padding: 6px 0; min-width: 180px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15); z-index: 1500;
    display: none; animation: fadeIn 0.12s ease;
    border: 1px solid var(--border);
  }
  .context-menu.active { display: block; }
  .context-menu-item {
    padding: 9px 16px; cursor: pointer; display: flex; align-items: center;
    gap: 10px; transition: background var(--transition); font-size: 13px;
  }
  .context-menu-item:hover { background: rgba(0,122,255,0.06); color: var(--primary); }
  .context-menu-item.danger:hover { background: rgba(255,59,48,0.06); color: var(--error); }
  .context-menu-divider { height: 1px; background: var(--border); margin: 4px 0; }
  .editor-tool-btn {
    background: none; border: none; color: #86868b; cursor: pointer;
    font-size: 13px; padding: 3px 7px; border-radius: 4px; line-height: 1;
    font-family: inherit; transition: all var(--transition);
  }
  .editor-tool-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .editor-modal-overlay { z-index: 1100; align-items: center; justify-content: center; }
  .editor-window {
    display: flex; flex-direction: column; width: 90vw; height: 85vh;
    min-width: 600px; min-height: 400px; background: #1e1e1e;
    border-radius: var(--radius); box-shadow: 0 8px 40px rgba(0,0,0,0.4);
    overflow: hidden; position: relative;
  }
  .editor-toolbar {
    display: flex; align-items: center; gap: 4px; padding: 5px 10px;
    background: #2d2d2d; border-bottom: 1px solid #404040;
    user-select: none; cursor: move; flex-shrink: 0; position: relative;
  }
  .editor-toolbar-spacer { flex: 1; }
  .editor-toolbar-sep { width: 1px; background: #404040; height: 18px; margin: 0 4px; }
  .editor-filename {
    font-size: 12px; color: #ccc; padding: 0 8px; min-width: 120px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default;
  }
  .editor-dirty { color: var(--warning); font-size: 12px; cursor: default; }
  .editor-fs-label { color: #999; font-size: 11px; cursor: default; min-width: 20px; text-align: center; }
  .editor-save-btn { color: #64d2ff; }
  .editor-body { flex: 1; min-height: 0; }
  .editor-statusbar {
    display: flex; gap: 16px; padding: 3px 12px; background: var(--primary);
    color: #fff; font-size: 11px; font-family: 'SF Mono', monospace; flex-shrink: 0; user-select: none;
  }
  .editor-status-encoding { margin-left: auto; }
  .editor-encoding-menu {
    position: absolute; top: 100%; right: 10px; min-width: 200px;
    background: #2d2d2d; border: 1px solid #454545; border-radius: 4px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.5); padding: 4px 0;
    z-index: 10000; display: none;
  }
  .editor-encoding-menu.open { display: block; }
  .editor-encoding-menu-item {
    padding: 6px 24px 6px 32px; cursor: pointer; color: #ccc;
    font-size: 12px; line-height: 1.4; white-space: nowrap;
    display: flex; align-items: center; gap: 6px; position: relative;
  }
  .editor-encoding-menu-item:hover { background: #094771; color: #fff; }
  .editor-encoding-menu-item.checked::before {
    content: '●'; position: absolute; left: 14px; color: #4ec9b0; font-size: 10px;
  }
  .editor-encoding-menu-item.checked { color: #4ec9b0; }
  .editor-encoding-menu-divider { height: 1px; background: #454545; margin: 4px 0; }
  .editor-resize-handle {
    position: absolute; right: 0; bottom: 20px; width: 14px; height: 14px;
    cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, #555 50%); z-index: 2;
  }
  .sidebar-toggle { display: none; }
  .sidebar-backdrop { display: none; }
  .mobile-upload-bar { display: none; }

  @media (max-width: 768px) {
    html { font-size: 15px; }
    body { -webkit-tap-highlight-color: transparent; }

    .header { padding: 10px 14px; gap: 8px; flex-wrap: wrap; }
    .logo { font-size: 18px; white-space: nowrap; }
    .search-group { max-width: 100%; width: 100%; margin: 0; order: 3; }
    .header-actions { width: auto; gap: 4px; }
    #adminBtn { display: none; }

    .sidebar {
      position: fixed; top: 0; left: 0; bottom: 0; z-index: 500;
      width: 260px; background: var(--surface); box-shadow: var(--shadow-lg);
      flex-direction: column; padding: 60px 12px 20px; gap: 2px;
      transform: translateX(-100%); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
      overflow-y: auto; border-right: 1px solid var(--border);
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar-title { display: block; padding: 12px 8px 6px; font-size: 11px; }
    .sidebar-item { padding: 10px 12px; font-size: 14px; width: 100%; }
    .sidebar-divider { display: block; margin: 8px 8px; }
    .sidebar-add { margin-top: 4px; font-size: 13px; padding: 10px 12px; }
    .sidebar-backdrop {
      display: none; position: fixed; inset: 0; z-index: 499;
      background: rgba(0,0,0,0.3); backdrop-filter: blur(2px);
    }
    .sidebar-backdrop.active { display: block; }
    .sidebar-toggle {
      display: flex; width: 36px; height: 36px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--surface);
      cursor: pointer; align-items: center; justify-content: center;
      font-size: 18px; color: var(--text); transition: all var(--transition);
      flex-shrink: 0;
    }
    .sidebar-toggle:hover { background: var(--surface-hover); }

    .main-layout { flex-direction: column; padding: 0; gap: 0; }
    .main-content { width: 100%; }

    .toolbar { display: none; }

    .container { padding: 0; }

    .file-grid:not(.file-list) { grid-template-columns: repeat(2, 1fr); gap: 4px; min-height: 100px; }
    .file-item { padding: 5px 4px; gap: 1px; }
    .file-item .file-icon { font-size: 28px; }
    .file-item .file-name { font-size: 18px; line-height: 1.3; }
    .file-list .file-item { grid-template-columns: 40px 1fr 68px 50px; gap: 8px; padding: 8px 10px; align-items: center; }
    .file-list-header { grid-template-columns: 40px 1fr 68px 50px; gap: 8px; padding: 4px 10px; font-size: 12px; }
    .file-list .file-icon { font-size: 28px; flex-shrink: 0; }
    .file-list .file-name { font-size: 16px; word-break: break-word; overflow-wrap: anywhere; line-height: 1.3; }
    .file-list .file-meta { font-size: 12px; text-align: right; flex-shrink: 0; }
    .file-list .file-meta:last-child { display: none; }
    .file-list-header > *:nth-child(4) { text-align: right; }
    .file-list-header > *:nth-child(5) { display: none; }

    .breadcrumb { font-size: 12px; padding: 4px 12px; }

    .modal { padding: 20px; width: 94%; max-width: 100%; border-radius: var(--radius-lg); }
    .modal-title { font-size: 16px; }
    .modal-overlay { align-items: flex-start; padding-top: 8vh; }
    .modal-overlay .modal {
      border-radius: 0 0 var(--radius-xl) var(--radius-xl);
      max-height: 90vh; margin-top: 0;
    }

    .login-card, .share-card { padding: 28px 20px; max-width: 100%; margin: 0 8px; border-radius: var(--radius-lg); }
    .login-container { padding: 12px; align-items: flex-start; padding-top: 10vh; }

    .preview-header { padding: 10px 14px; gap: 8px; }
    .preview-filename { font-size: 14px; }
    .preview-overlay .btn { padding: 6px 12px; font-size: 12px; }

    .stats-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-card { padding: 18px 12px; }
    .stat-value { font-size: 28px; }
    .stat-label { font-size: 12px; }

    .table-container { margin: 0 -8px; }
    th, td { padding: 8px 10px; font-size: 12px; white-space: nowrap; }

    .btn { min-height: 40px; }
    .btn-sm { min-height: 32px; padding: 4px 10px; font-size: 11px; }

    .modal-close { width: 36px; height: 36px; font-size: 24px; }

    .form-input, .form-select { padding: 10px 12px; font-size: 16px; }

    .card { padding: 12px 8px; border-radius: 0; border: none; box-shadow: none; }

    .mobile-upload-bar {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0;
      padding: 10px 14px; padding-bottom: max(10px, env(safe-area-inset-bottom));
      background: var(--surface); border-top: 1px solid var(--border);
      box-shadow: 0 -2px 10px rgba(0,0,0,0.06); z-index: 300;
      gap: 8px;
    }
    .mobile-upload-bar .btn { flex: 1; }
    .mobile-upload-bar .new-file-dropdown-btn { flex: none; min-height: 0; padding: 4px 6px; min-width: 0; font-size: 14px; }

    /* Editor mobile optimization */
    .editor-window {
      width: 100vw !important; height: 100vh !important;
      min-width: 100vw !important; min-height: 100vh !important;
      border-radius: 0; position: fixed !important; top: 0; left: 0;
    }
    .editor-modal-overlay { padding: 0; align-items: stretch !important; justify-content: stretch !important; }
    .editor-toolbar {
      padding: 4px 6px; gap: 2px; flex-wrap: wrap; cursor: default;
    }
    .editor-toolbar-spacer { display: none; }
    .editor-tool-btn {
      padding: 8px 10px; font-size: 15px; min-width: 36px; min-height: 36px;
      -webkit-tap-highlight-color: transparent;
    }
    .editor-tool-btn:active { background: rgba(255,255,255,0.15); }
    .editor-toolbar-sep { display: none; }
    .editor-filename { font-size: 12px; min-width: 50px; max-width: 90px; flex-shrink: 0; }
    .editor-fs-label { font-size: 12px; min-width: 16px; }
    .editor-save-btn { font-size: 13px; white-space: nowrap; }
    .editor-statusbar {
      font-size: 10px; gap: 8px; padding: 2px 8px;
      overflow-x: auto; -webkit-overflow-scrolling: touch;
    }
    .editor-statusbar span:nth-child(3) { display: none; }
    .editor-resize-handle { display: none; }
    #editorWindowBtn { display: none; }
    .editor-encoding-menu { min-width: 180px; }
    .editor-encoding-menu-item { padding: 10px 20px 10px 28px; font-size: 13px; }
  }

</style>
`;

const SHARED_SCRIPTS = 
`    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    function closeUploadProgress() {
      const container = document.getElementById('uploadProgressContainer');
      if (container) container.classList.remove('active');
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('active');
    }

    function showLoading(show) {
      document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      document.querySelectorAll('.theme-toggle').forEach(function(btn) {
        btn.textContent = next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
      });
    }
    (function initThemeIcon() {
      var icon = document.querySelector('.theme-toggle');
      if (icon) {
        icon.textContent = (document.documentElement.getAttribute('data-theme') === 'dark') ? '\u2600\uFE0F' : '\uD83C\uDF19';
      }
    })();

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarBackdrop').classList.toggle('active');
    }

    async function logout() {
      try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
      window.location.href = '/login.html';
    }

    async function apiCall(url, options, successMsg, onSuccess) {
      showLoading(true);
      try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (data.success) { showToast(successMsg, 'success'); if (onSuccess) await onSuccess(); }
        else { showToast(data.message || '操作失败', 'error'); }
      } catch (error) { showToast('操作失败: ' + error.message, 'error'); }
      finally { showLoading(false); }
    }`;

const LOGIN_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - 网盘</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()</script>
  ${CSS_STYLES}
</head>
<body>
  <div class="login-container">
    <button class="theme-toggle" onclick="toggleTheme()" title="切换主题" style="position:fixed;top:16px;right:16px;z-index:10;"></button>
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">网盘</div>
        <div class="login-subtitle">登录</div>
      </div>

      <form id="loginForm" onsubmit="handleLogin(event)">
        <div class="form-group">
          <label class="form-label">邮箱</label>
          <input type="email" id="email" class="form-input" placeholder="请输入邮箱" required pattern="[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}">
        </div>

        <div class="form-group">
          <label class="form-label">密码</label>
          <input type="password" id="password" class="form-input" placeholder="请输入密码">
        </div>

        <div class="form-group" style="text-align:right;">
          <a href="#" style="font-size:13px;color:#888;text-decoration:none;" onclick="showToast('请联系管理员重置密码','info');return false;">忘记密码</a>
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%;" id="loginBtn">
          登录
        </button>
      </form>

      <button type="button" class="btn" style="width:100%;margin-top:12px;border:1px solid #4a90d9;color:#4a90d9;background:transparent;" id="guestLoginBtn" onclick="handleGuestLogin()">
        游客登录 &rarr;
      </button>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <script>
    function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!email || !password) {
        showToast('请输入邮箱和密码', 'error');
        return;
      }

      if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
        showToast('请输入有效的邮箱地址', 'error');
        return;
      }

      const body = { email, password };
      doLogin(body);
    }

    function handleGuestLogin() {
      const password = document.getElementById('password').value;
      let body;
      if (password) {
        body = { isAdmin: true, password: password };
      } else {
        body = { isGuest: true };
      }
      doLogin(body);
    }

    function doLogin(body) {
      const loginBtn = document.getElementById('loginBtn');
      const guestBtn = document.getElementById('guestLoginBtn');
      const emailInp = document.getElementById('email');
      const passwordInp = document.getElementById('password');
      loginBtn.disabled = true;
      loginBtn.textContent = '登录中...';
      if (guestBtn) guestBtn.disabled = true;
      if (emailInp) emailInp.disabled = true;
      if (passwordInp) passwordInp.disabled = true;

      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      .then(function(response) { return response.json(); })
      .then(function(data) {
        if (data.success) {
          showToast('登录成功', 'success');
          window.location.href = '/';
        } else {
          showToast(data.message || '登录失败', 'error');
          loginBtn.disabled = false;
          loginBtn.textContent = '登录';
          if (guestBtn) guestBtn.disabled = false;
          if (emailInp) emailInp.disabled = false;
          if (passwordInp) passwordInp.disabled = false;
        }
      })
      .catch(function(error) {
        showToast('登录失败: ' + error.message, 'error');
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
        if (guestBtn) guestBtn.disabled = false;
        if (emailInp) emailInp.disabled = false;
        if (passwordInp) passwordInp.disabled = false;
      });
    }

    ${SHARED_SCRIPTS}
  </script>
</body>
</html>
`;

const INDEX_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>云盘</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()</script>
  ${CSS_STYLES}
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ace-builds@1.32.9/src-min-noconflict/ace.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ace-builds@1.32.9/src-min-noconflict/ext-modelist.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
</head>
<body>
  <div class="header">
    <button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" aria-label="菜单">☰</button>
    <div class="logo">网盘</div>
    <div class="search-group">
      <div class="search-box" id="searchBox">
        <input type="text" class="search-input" id="searchInput" placeholder="搜索文件..." autocomplete="off" oninput="handleSearch(event)" onkeydown="handleSearchKey(event)" onfocus="handleSearch(event)">
        <button class="search-clear" id="searchClear" onclick="clearSearch()">×</button>
        <div class="search-results" id="searchResults"></div>
      </div>
      <select class="search-mode-select" id="searchMode" title="搜索模式">
        <option value="quick">快速</option>
        <option value="full">全量</option>
      </select>
    </div>
    <div class="header-actions">
      <button class="theme-toggle" onclick="toggleTheme()" title="切换主题"></button>
      <button class="btn btn-secondary" id="adminBtn" onclick="window.location.href='/admin.html'">后台</button>
      <button class="btn btn-secondary" onclick="logout()">退出</button>
    </div>
  </div>

  <div class="main-layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-title">收藏夹</div>
      <div class="sidebar-item" data-path="/" onclick="navigateTo('/')">
        <span class="sidebar-item-icon">🏠</span>
        <span class="sidebar-item-name">根目录</span>
      </div>
      <div id="favoritesList"></div>
      <div class="sidebar-divider"></div>
      <button class="sidebar-add" onclick="addFavorite()">
        <span>+</span> <span>添加到收藏夹</span>
      </button>
    </aside>
    <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar()"></div>
    <main class="main-content">
  <div class="container">
    <div class="breadcrumb" id="breadcrumb" style="padding:4px 0;"></div>

    <div class="toolbar">
      <div class="new-file-dropdown">
        <button class="btn btn-primary" onclick="showNewFolderModal()">📁 新建文件夹</button>
        <button class="btn btn-primary new-file-dropdown-btn" onclick="event.stopPropagation();toggleDropdown(this)" title="新建文件">≡</button>
        <div class="new-file-dropdown-menu">
          <div class="new-file-dropdown-item" onclick="showNewFileModal('txt');closeDropdowns()"><span>📄</span> <span>TXT 文件</span></div>
          <div class="new-file-dropdown-item" onclick="showNewFileModal('md');closeDropdowns()"><span>📝</span> <span>MD 文件</span></div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">
        📤 上传文件
      </button>
      <input type="file" id="fileInput" multiple style="display: none;" onchange="handleFileUpload(event)">

      <!-- 视图切换 -->
      <div class="view-toggle" id="viewToggle">
        <button class="view-toggle-btn" onclick="toggleViewMode('card')" title="卡片视图" data-view="card">▦</button>
        <button class="view-toggle-btn active" onclick="toggleViewMode('list')" title="列表视图" data-view="list">☰</button>
      </div>

      <!-- 选中信息显示 -->
      <div id="selectionInfo" class="selection-info"></div>
    </div>

    <div class="card">
      <div class="upload-overlay" id="uploadOverlay">
        <div class="upload-overlay-text">📤 释放文件以上传</div>
      </div>
      <div id="fileList" class="file-grid"></div>
      <div id="emptyState" class="empty-state" style="display: none;">
        <div class="empty-icon">📂</div>
        <div>此文件夹为空</div>
      </div>
    </div>
  </div>
    </main>
  </div>

  <!-- Mobile Upload Bar -->
  <div class="mobile-upload-bar" id="mobileUploadBar">
    <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">📤 上传</button>
    <div class="new-file-dropdown">
      <button class="btn btn-secondary" onclick="showNewFolderModal()">📁 新建文件夹</button>
      <button class="btn btn-secondary new-file-dropdown-btn" onclick="event.stopPropagation();toggleDropdown(this)" title="新建文件">≡</button>
      <div class="new-file-dropdown-menu">
        <div class="new-file-dropdown-item" onclick="showNewFileModal('txt');closeDropdowns()"><span>📄</span> <span>TXT 文件</span></div>
        <div class="new-file-dropdown-item" onclick="showNewFileModal('md');closeDropdowns()"><span>📝</span> <span>MD 文件</span></div>
      </div>
    </div>
  </div>

  <!-- New Folder Modal -->
  <div class="modal-overlay" id="newFolderModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">新建文件夹</div>
        <button class="modal-close" onclick="closeModal('newFolderModal')">&times;</button>
      </div>
      <form onsubmit="createFolder(event)">
        <div class="form-group">
          <label class="form-label">文件夹名称</label>
          <input type="text" id="folderName" class="form-input" placeholder="请输入文件夹名称" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%;">创建</button>
      </form>
    </div>
  </div>

  <!-- New File Modal -->
  <div class="modal-overlay" id="newFileModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">新建文件</div>
        <button class="modal-close" onclick="closeModal('newFileModal')">&times;</button>
      </div>
      <form onsubmit="createNewFile(event)">
        <div class="form-group">
          <label class="form-label">文件名</label>
          <input type="text" id="newFileName" class="form-input" placeholder="例如: readme.txt, config.json" required>
        </div>
        <div class="form-group" style="margin-top: 8px;">
          <label class="form-label">初始内容（可选）</label>
          <textarea id="newFileContent" class="form-input" style="height: 120px; resize: vertical; font-family: monospace;" placeholder="留空则创建空文件"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%;">创建</button>
      </form>
    </div>
  </div>

  <!-- Rename Modal -->
  <div class="modal-overlay" id="renameModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">重命名</div>
        <button class="modal-close" onclick="closeModal('renameModal')">&times;</button>
      </div>
      <form onsubmit="renameFile(event)">
        <div class="form-group">
          <label class="form-label">新名称</label>
          <input type="text" id="renameFileName" class="form-input" required>
        </div>
        <input type="hidden" id="renameFilePath">
        <button type="submit" class="btn btn-primary" style="width: 100%;">确认</button>
      </form>
    </div>
  </div>

  <!-- Share Modal -->
  <div class="modal-overlay" id="shareModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">创建分享链接</div>
        <button class="modal-close" onclick="closeModal('shareModal')">&times;</button>
      </div>
      <form onsubmit="createShare(event)">
        <div class="form-group">
          <label class="form-label">分享密码（留空则无密码）</label>
          <input type="text" id="sharePassword" class="form-input" placeholder="可选">
        </div>
        <div class="form-group">
          <label class="form-label">有效期</label>
          <select id="shareExpiry" class="form-select">
            <option value="1h">1小时</option>
            <option value="1d" selected>1天</option>
            <option value="1m">1个月</option>
            <option value="permanent">永久有效</option>
          </select>
        </div>
        <input type="hidden" id="shareFilePath">
        <button type="submit" class="btn btn-primary" style="width: 100%;">创建分享链接</button>
      </form>
    </div>
  </div>

  <!-- Share Result Modal -->
  <div class="modal-overlay" id="shareResultModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">分享链接已创建</div>
        <button class="modal-close" onclick="closeModal('shareResultModal')">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">分享链接</label>
        <input type="text" id="shareResultUrl" class="form-input" readonly>
      </div>
      <button class="btn btn-primary" style="width: 100%;" onclick="copyShareLink()">复制链接</button>
    </div>
  </div>

  <!-- Ace Editor Modal (窗口模式) -->
  <div class="modal-overlay editor-modal-overlay" id="editorModal">
    <div id="editorWindow" class="editor-window">
      <!-- 工具栏 -->
      <div id="editorToolbar" class="editor-toolbar">
        <span id="editorFilename" class="editor-filename"></span>
        <span id="editorDirtyIndicator" class="editor-dirty" style="display: none;">●</span>
        <span class="editor-toolbar-spacer"></span>
        <!-- 功能按钮组 -->
        <button class="editor-tool-btn" onclick="editorUndo()" title="撤销 (Ctrl+Z)">↩</button>
        <button class="editor-tool-btn" onclick="editorRedo()" title="重做 (Ctrl+Y)">↪</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" id="editorFindBtn" onclick="editorFind()" title="查找 (Ctrl+F)">🔍</button>
        <button class="editor-tool-btn" onclick="editorGoToLine()" title="跳转到行 (Ctrl+G)">#</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" onclick="changeEditorFontSize(-1)" title="缩小字号">A⁻</button>
        <span id="editorFontSizeLabel" class="editor-fs-label">14</span>
        <button class="editor-tool-btn" onclick="changeEditorFontSize(1)" title="放大字号">A⁺</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" id="editorWordWrapBtn" onclick="editorToggleWordWrap()" title="切换自动换行">↩</button>
        <button class="editor-tool-btn" id="editorThemeBtn" onclick="editorToggleTheme()" title="切换主题">🌙</button>
        <button class="editor-tool-btn" id="editorWindowBtn" onclick="editorToggleFullscreen()" title="最大化/窗口">🗖</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" id="editorEncodingBtn" onclick="toggleEncodingMenu(event)" title="编码">编码 ▾</button>
        <button class="editor-tool-btn editor-save-btn" id="editorSaveBtn" onclick="saveEditor()" title="保存 (Ctrl+S)">💾 保存</button>
        <button class="editor-tool-btn" onclick="closeEditor()" title="关闭 (Esc)">✕</button>
        <!-- 编码下拉菜单 -->
        <div class="editor-encoding-menu" id="editorEncodingMenu">
          <div class="editor-encoding-menu-item" data-enc-use="ansi" onclick="openWithEncoding('ansi')">使用 ANSI/GBK 打开</div>
          <div class="editor-encoding-menu-item checked" data-enc-use="utf-8" onclick="openWithEncoding('utf-8')">使用 UTF-8 打开</div>
          <div class="editor-encoding-menu-item" data-enc-use="utf-8-bom" onclick="openWithEncoding('utf-8-bom')">使用 UTF-8-BOM 打开</div>
          <div class="editor-encoding-menu-item" data-enc-use="utf-16le" onclick="openWithEncoding('utf-16le')">使用 UTF-16 LE 打开</div>
          <div class="editor-encoding-menu-item" data-enc-use="utf-16be" onclick="openWithEncoding('utf-16be')">使用 UTF-16 BE 打开</div>
          <div class="editor-encoding-menu-divider"></div>
          <div class="editor-encoding-menu-item" data-enc-cv="ansi" onclick="convertEncoding('ansi')">转换为 ANSI/GBK</div>
          <div class="editor-encoding-menu-item" data-enc-cv="utf-8" onclick="convertEncoding('utf-8')">转换为 UTF-8</div>
          <div class="editor-encoding-menu-item" data-enc-cv="utf-8-bom" onclick="convertEncoding('utf-8-bom')">转换为 UTF-8-BOM</div>
          <div class="editor-encoding-menu-item" data-enc-cv="utf-16le" onclick="convertEncoding('utf-16le')">转换为 UTF-16 LE</div>
          <div class="editor-encoding-menu-item" data-enc-cv="utf-16be" onclick="convertEncoding('utf-16be')">转换为 UTF-16 BE</div>
        </div>
      </div>
      <!-- 编辑器主体 -->
      <div id="aceEditorContainer" class="editor-body"></div>
      <!-- 状态栏 -->
      <div id="editorStatusBar" class="editor-statusbar">
        <span id="editorStatusMode">text</span>
        <span id="editorStatusPosition">行 1, 列 1</span>
        <span id="editorStatusIndent">空格: 2</span>
        <span id="editorStatusEncoding" class="editor-status-encoding">UTF-8</span>
      </div>
      <!-- 右下角调整大小手柄 -->
      <div class="editor-resize-handle"></div>
    </div>
  </div>

  <!-- Preview Modal -->
  <div class="preview-overlay" id="previewOverlay">
    <div class="preview-header">
      <div class="preview-filename" id="previewFilename"></div>
      <div class="preview-actions">
        <button class="btn btn-primary" id="previewDownloadBtn">下载</button>
        <button class="btn btn-secondary" onclick="closePreview()">关闭</button>
      </div>
    </div>
    <div class="preview-content" id="previewContent">
      <div class="preview-loading">
        <div class="spinner"></div>
        <div>加载中...</div>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <div class="loading-overlay" id="loadingOverlay" style="display: none;">
    <div class="spinner"></div>
  </div>

  <!-- 上传进度条 -->
  <div class="upload-progress-container" id="uploadProgressContainer">
    <div class="upload-progress-header">
      <div class="upload-progress-title">📤 上传进度</div>
      <button class="upload-progress-close" onclick="closeUploadProgress()">&times;</button>
    </div>
    <div class="upload-progress-bar">
      <div class="upload-progress-fill" id="uploadProgressFill"></div>
    </div>
    <div class="upload-progress-info">
      <span class="upload-progress-filename" id="uploadProgressFilename">准备上传...</span>
      <span class="upload-progress-percentage" id="uploadProgressPercentage">0%</span>
    </div>
    <div id="uploadProgressDetail" style="font-size: 11px; color: var(--text-muted); margin-top: 6px; display: none;"></div>
  </div>

  <script>
    let currentPath = '/';
    let history = ['/'];
    let historyIndex = 0;
    let viewMode = localStorage.getItem('fileViewMode') || 'list';
    let sortField = localStorage.getItem('sortField') || 'name';
    let sortAscending = localStorage.getItem('sortAscending') !== 'false';

    let selectedItems = new Set();
    let lastSelectedIndex = -1;
    let selectionAnchorIndex = -1;
    let isCtrlPressed = false;
    let isShiftPressed = false;

    let searchTimer = null;
    let pendingSelectFile = null;

    function handleSearch(event) {
      clearTimeout(searchTimer);
      const input = document.getElementById('searchInput');
      const q = input.value.trim();
      const results = document.getElementById('searchResults');
      const clearBtn = document.getElementById('searchClear');
      clearBtn.style.display = q ? 'flex' : 'none';
      if (!q) { results.classList.remove('active'); results.innerHTML = ''; return; }
      searchTimer = setTimeout(async () => {
        try {
          const mode = document.getElementById('searchMode').value;
          const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&mode=' + mode);
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const modeLabel = data.mode === 'full' ? '全量' : '快速';
            const headerHtml = '<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);">搜索模式：' + modeLabel + '（扫描 ' + (data.scannedPages ?? '?') + ' 页）</div>';
            results.innerHTML = headerHtml + data.results.map(r => \`
              <div class="search-result-item" data-path="\${r.path}" data-name="\${r.name}" onclick="closeSearch();navigateToFolderOrDownload('\${r.path}','\${r.name}')" oncontextmenu="event.preventDefault();closeSearch();navigateToFolderAndSelect('\${r.path}','\${r.name}');return false">
                <span class="search-result-icon">\${getFileIcon(r.name)}</span>
                <div class="search-result-info">
                  <div class="search-result-name">\${highlightMatch(r.name, q)}</div>
                  <div class="search-result-path">\${r.folder}</div>
                </div>
                <span class="search-result-size">\${r.sizeFormatted}</span>
              </div>
            \`).join('');
          } else {
            results.innerHTML = '<div class="search-empty">未找到匹配的文件</div>';
          }
          results.classList.add('active');
        } catch(e) { results.innerHTML = '<div class="search-empty">搜索出错</div>'; results.classList.add('active'); }
      }, 300);
    }

    function handleSearchKey(event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); navigateSearchResults(1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); navigateSearchResults(-1); }
      if (event.key === 'Enter') { selectSearchResult(); }
      // → 选中当前搜索结果并跳转
      if (event.key === 'ArrowRight') { selectSearchResult(); }
    }

    function navigateSearchResults(dir) {
      const items = document.querySelectorAll('.search-result-item');
      if (!items.length) return;
      let idx = Array.from(items).findIndex(i => i.classList.contains('search-focus'));
      if (idx >= 0) items[idx].classList.remove('search-focus');
      idx = idx < 0 ? (dir > 0 ? 0 : items.length - 1) : idx + dir;
      if (idx < 0) idx = items.length - 1;
      if (idx >= items.length) idx = 0;
      items[idx].classList.add('search-focus');
      items[idx].scrollIntoView({ block: 'nearest' });
    }

    function selectSearchResult() {
      const item = document.querySelector('.search-result-item.search-focus');
      if (item) {
        const path = item.dataset.path;
        const name = item.dataset.name;
        closeSearch();
        navigateToFolderAndSelect(path, name);
      }
    }

    function closeSearch() {
      document.getElementById('searchResults').classList.remove('active');
      document.getElementById('searchInput').blur();
    }

    function clearSearch() {
      closeSearch();
      const input = document.getElementById('searchInput');
      input.value = '';
      document.getElementById('searchClear').style.display = 'none';
      document.getElementById('searchResults').innerHTML = '';
      input.focus();
    }

    function navigateToFolderOrDownload(path, name) {
      const isFolder = name.endsWith('/') || path.endsWith('/');
      if (isFolder) { navigateTo(path); return; }
      const ext = name.split('.').pop().toLowerCase();
      let pt = 'text';
      if (/^(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/.test(ext)) pt = 'image';
      else if (ext === 'pdf') pt = 'pdf';
      else if (/^(mp4|mov|avi|mkv|webm)$/.test(ext)) pt = 'video';
      else if (/^(mp3|wav|flac|aac|ogg|m4a)$/.test(ext)) pt = 'audio';
      else if (/^(doc|docx)$/.test(ext)) pt = 'word';
      previewFile(path, pt, name);
    }

    function navigateToFolderAndSelect(path, name) {
      const lastSlash = path.lastIndexOf('/');
      const folder = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : '/';
      pendingSelectFile = name;
      navigateTo(folder);
    }

    function highlightMatch(text, query) {
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx < 0) return text;
      return text.substring(0, idx) + '<mark>' + text.substring(idx, idx + query.length) + '</mark>' + text.substring(idx + query.length);
    }

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.search-box')) closeSearch();
      if (!e.target.closest('.new-file-dropdown')) closeDropdowns();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') { isCtrlPressed = true; return; }
      if (e.key === 'Shift') { isShiftPressed = true; return; }

      // Escape: 关闭所有弹层（所有场景生效）
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.getElementById('editorModal')?.classList.contains('active')) closeEditor();
        else if (document.querySelector('.modal-overlay.active')?.classList.remove('active'));
        else if (document.getElementById('previewOverlay')?.classList.contains('active')) closePreview();
        else if (document.getElementById('searchResults')?.classList.contains('active')) closeSearch();
        else if (document.querySelector('.new-file-dropdown-menu.active') && closeDropdowns());
        else clearSelection();
        return;
      }

      if (document.querySelector('.modal-overlay.active')) return;

      // Ctrl+F 搜索（输入框内也生效）
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const si = document.getElementById('searchInput');
        if (si) { si.focus(); si.select(); }
        return;
      }

      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const fEl = document.getElementById('fileList');
      const items = fEl ? Array.from(fEl.querySelectorAll('.file-item')) : [];

      // 单键操作
      if (ctrl && e.key === 'a') { e.preventDefault(); selectAll(); }
      if (e.key === 'Delete' && selectedItems.size > 0) deleteSelected();
      if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); showNewFileModal('txt'); }
      if (e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); showNewFolderModal(); }
      if (e.key === 'F2' && lastSelectedIndex >= 0) {
        e.preventDefault();
        showRenameModal(items[lastSelectedIndex].dataset.path, items[lastSelectedIndex].dataset.name);
      }
      if (e.key === 'Backspace') { e.preventDefault(); ctrl ? goForward() : goBack(); }

      if (!items.length) return;

      // ↑↓←→ 方向键导航（[dir, step] 查找表）
      const cols = viewMode === 'list' ? 1 : getGridColumns(fEl);
      const arrowMap = { ArrowUp: [-1, 1], ArrowDown: [1, 1], ArrowLeft: [-1, cols], ArrowRight: [1, cols] };
      const a = arrowMap[e.key];
      if (a) {
        e.preventDefault();
        let i = lastSelectedIndex < 0 ? 0 : lastSelectedIndex + a[0] * a[1];
        i = Math.max(0, Math.min(i, items.length - 1));
        if (i !== lastSelectedIndex) {
          if (e.shiftKey && selectionAnchorIndex >= 0) {
            clearSelection();
            selectRange(items[selectionAnchorIndex], items[i]);
            lastSelectedIndex = i;
          } else {
            selectSingle(items[i]);
          }
          items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }

      // Enter 打开 / x 下载 / e 编辑器
      if (lastSelectedIndex < 0) return;
      const el = items[lastSelectedIndex];
      if (e.key === 'Enter') {
        e.preventDefault();
        if (el.dataset.type === 'folder') navigateTo(el.dataset.path);
        else if (el.dataset.previewType) previewFile(el.dataset.path, el.dataset.previewType, el.dataset.name);
        else downloadFile(el.dataset.path);
      } else if (e.key === 'x') {
        e.preventDefault(); downloadFile(el.dataset.path);
      } else if (e.key === 'e' && el.dataset.type !== 'folder') {
        e.preventDefault(); openEditor(el.dataset.path, el.dataset.name);
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        isCtrlPressed = false;
      }
      if (e.key === 'Shift') {
        isShiftPressed = false;
      }
    });

    window.addEventListener('DOMContentLoaded', function() {

      document.getElementById('breadcrumb').addEventListener('click', function(e) {
        const el = e.target.closest('[data-path]');
        if (el) { e.preventDefault(); navigateTo(el.dataset.path); }
      });

      document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewMode);
      });

      checkAuth().then(() => {
        updateNavButtons();
        Promise.all([loadFiles(), initFavorites()]).then(() => {
          initDragUpload();
          initContextMenu();
          initMultiSelect();
        });
      });
});

let favorites = [];

async function initFavorites() {
  if (window.__INIT__ && window.__INIT__.favorites) {
    favorites = window.__INIT__.favorites;
    renderFavorites();
    highlightCurrentFavorite();
    return;
  }
  await loadFavorites();
  renderFavorites();
  highlightCurrentFavorite();
}

async function loadFavorites() {
  try {
    const response = await fetch('/api/favorites');
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites || [];
    }
  } catch (e) {
    favorites = [];
  }
}

function renderFavorites() {
  const container = document.getElementById('favoritesList');
  if (!container) return;
  if (favorites.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = favorites.map((f, i) => \`
    <div class="sidebar-item" data-path="\${f.path}" data-fav-index="\${i}" draggable="true"
         ondragstart="onFavDragStart(event, \${i})"
         ondragover="onFavDragOver(event, \${i})"
         ondragleave="onFavDragLeave(event)"
         ondrop="onFavDrop(event, \${i})"
         onclick="navigateTo('\${f.path}')">
      <span class="sidebar-item-icon">📁</span>
      <span class="sidebar-item-name">\${f.name}</span>
      <button class="sidebar-item-remove" onclick="event.stopPropagation();removeFavorite(\${i})" title="移除收藏">×</button>
    </div>
  \`).join('');
  highlightCurrentFavorite();
}

async function addFavorite() {
  const pathParts = currentPath.replace(/\\/$/, '').split('/').filter(Boolean);
  const name = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '根目录';
  const path = currentPath;
  if (favorites.some(f => f.path === path)) {
    showToast('已在收藏夹中', 'warning');
    return;
  }
  try {
    const response = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path })
    });
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites;
      renderFavorites();
      showToast('已添加到收藏夹', 'success');
    } else {
      showToast(data.message || '添加失败', 'error');
    }
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function removeFavorite(index) {
  try {
    const response = await fetch('/api/favorites?index=' + index, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites;
      renderFavorites();
      showToast('已移除收藏', 'success');
    } else {
      showToast(data.message || '移除失败', 'error');
    }
  } catch (e) {
    showToast('移除失败: ' + e.message, 'error');
  }
}

let _favDragIndex = -1;

function onFavDragStart(event, index) {
  _favDragIndex = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', index);
  requestAnimationFrame(() => {
    event.target.classList.add('sidebar-item-dragging');
  });
}

function onFavDragOver(event, toIndex) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const el = event.currentTarget;
  el.classList.add('sidebar-item-drop-target');
}

function onFavDragLeave(event) {
  event.currentTarget.classList.remove('sidebar-item-drop-target');
}

async function onFavDrop(event, toIndex) {
  event.preventDefault();
  event.currentTarget.classList.remove('sidebar-item-drop-target');
  const fromIndex = _favDragIndex;
  if (fromIndex < 0 || fromIndex === toIndex) return;

  const [moved] = favorites.splice(fromIndex, 1);
  favorites.splice(toIndex, 0, moved);

  try {
    const response = await fetch('/api/favorites/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites })
    });
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites;
    }
  } catch (e) {
    showToast('保存顺序失败: ' + e.message, 'error');
  }

  _favDragIndex = -1;
  renderFavorites();
}

document.addEventListener('dragend', () => {
  _favDragIndex = -1;
  document.querySelectorAll('.sidebar-item-dragging').forEach(el => el.classList.remove('sidebar-item-dragging'));
  document.querySelectorAll('.sidebar-item-drop-target').forEach(el => el.classList.remove('sidebar-item-drop-target'));
});

function highlightCurrentFavorite() {
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === currentPath);
  });
}

function showContextMenu(event, type, path, name, previewType) {
  event.preventDefault();
  event.stopPropagation();

  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu active';
  menu.id = 'contextMenu';

  let menuItems = '';

  const hasMultipleSelection = selectedItems.size > 1;

  if (hasMultipleSelection) {
    
    const count = selectedItems.size;
    menuItems = '<div class="context-menu-header" style="padding: 8px 16px; font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--border);">已选中 ' + count + ' 个项目</div>';
    menuItems += '<div class="context-menu-item" onclick="downloadSelected(); hideContextMenu();"><span>📥</span> <span>下载选中 (' + count + ')</span></div>';
    menuItems += '<div class="context-menu-divider"></div>';
    menuItems += '<div class="context-menu-item danger" onclick="deleteSelected(); hideContextMenu();"><span>🗑️</span> <span>删除选中 (' + count + ')</span></div>';
    menuItems += '<div class="context-menu-divider"></div>';
    menuItems += '<div class="context-menu-item" onclick="clearSelection(); hideContextMenu();"><span>✖️</span> <span>取消选择</span></div>';
  } else if (type === 'folder') {
    
    menuItems = \`
      <div class="context-menu-item" onclick="navigateTo('\${path}'); hideContextMenu();">
        <span>📂</span> <span>打开</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="showRenameModal('\${path}', '\${name}'); hideContextMenu();">
        <span>✏️</span> <span>重命名</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item danger" onclick="deleteFile('\${path}'); hideContextMenu();">
        <span>🗑️</span> <span>删除</span>
      </div>
    \`;
  } else if (type === 'file') {
    
    const canEdit = !previewType || previewType === 'text' || previewType === 'html';
    const canPreview = !!previewType;
    
    menuItems = \`
      \${canEdit ? \`<div class="context-menu-item" onclick="openEditor('\${path}', '\${name}'); hideContextMenu();">
        <span>✏️</span> <span>编辑</span>
      </div>
      <div class="context-menu-divider"></div>\` : ''}
      \${canPreview ? \`<div class="context-menu-item" onclick="previewFile('\${path}', '\${previewType}', '\${name}'); hideContextMenu();">
        <span>👁️</span> <span>预览</span>
      </div>
      <div class="context-menu-divider"></div>\` : ''}
      <div class="context-menu-item" onclick="downloadFile('\${path}'); hideContextMenu();">
        <span>📥</span> <span>下载</span>
      </div>
      <div class="context-menu-item" onclick="showShareModal('\${path}'); hideContextMenu();">
        <span>🔗</span> <span>分享</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="showRenameModal('\${path}', '\${name}'); hideContextMenu();">
        <span>✏️</span> <span>重命名</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item danger" onclick="deleteFile('\${path}'); hideContextMenu();">
        <span>🗑️</span> <span>删除</span>
      </div>
    \`;
  }

  menu.innerHTML = menuItems;
  document.body.appendChild(menu);
  positionMenu(menu, event.clientX, event.clientY);
  setupContextMenuDismiss();
}

function handleContextMenuOutsideClick(e) {
  if (!e.target.closest('.context-menu')) {
    hideContextMenu();
  }
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) {
    menu.remove();
  }
  document.removeEventListener('click', handleContextMenuOutsideClick);
  document.removeEventListener('contextmenu', handleContextMenuOutsideClick);
}

function positionMenu(menu, x, y) {
  const menuRect = menu.getBoundingClientRect();
  if (x + menuRect.width > window.innerWidth) {
    x = window.innerWidth - menuRect.width - 10;
  }
  if (y + menuRect.height > window.innerHeight) {
    y = window.innerHeight - menuRect.height - 10;
  }
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function setupContextMenuDismiss() {
  setTimeout(() => {
    document.addEventListener('click', handleContextMenuOutsideClick);
    document.addEventListener('contextmenu', handleContextMenuOutsideClick);
  }, 0);
}

function initContextMenu() {
  
  const fileList = document.getElementById('fileList');
  const card = fileList.closest('.card');

  card.addEventListener('contextmenu', (e) => {
    
    if (e.target === fileList || e.target.closest('.card') === card && !e.target.closest('.file-item')) {
      e.preventDefault();
      hideContextMenu();

      const menu = document.createElement('div');
      menu.className = 'context-menu active';
      menu.id = 'contextMenu';

      menu.innerHTML = \`
        <div class="context-menu-item" onclick="document.getElementById('fileInput').click(); hideContextMenu();">
          <span>📤</span> <span>上传文件</span>
        </div>
        <div class="context-menu-item" onclick="showNewFolderModal(); hideContextMenu();">
          <span>📁</span> <span>新建文件夹</span>
        </div>
        <div class="context-menu-item" onclick="showNewFileModal('txt'); hideContextMenu();">
          <span>📄</span> <span>新建 TXT 文件</span>
        </div>
        <div class="context-menu-item" onclick="showNewFileModal('md'); hideContextMenu();">
          <span>📝</span> <span>新建 MD 文件</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" onclick="loadFiles(); hideContextMenu();">
          <span>🔄</span> <span>刷新</span>
        </div>
      \`;

      document.body.appendChild(menu);
      positionMenu(menu, e.clientX, e.clientY);
      setupContextMenuDismiss();
    }
  });
}

function toggleSelection(element) {
  const path = element.dataset.path;
  const type = element.dataset.type;
  const key = type + ':' + path;

  if (selectedItems.has(key)) {
    selectedItems.delete(key);
    element.classList.remove('selected');
  } else {
    selectedItems.add(key);
    element.classList.add('selected');
  }
  updateSelectionInfo();
}

function selectSingle(element) {
  clearSelection();
  const path = element.dataset.path;
  const type = element.dataset.type;
  const key = type + ':' + path;

  selectedItems.add(key);
  element.classList.add('selected');
  lastSelectedIndex = getElementIndex(element);
  selectionAnchorIndex = lastSelectedIndex;
  updateSelectionInfo();
}

function selectRange(startElement, endElement) {
  const fileList = document.getElementById('fileList');
  const items = Array.from(fileList.querySelectorAll('.file-item'));
  const startIndex = items.indexOf(startElement);
  const endIndex = items.indexOf(endElement);

  const min = Math.min(startIndex, endIndex);
  const max = Math.max(startIndex, endIndex);

  for (let i = min; i <= max; i++) {
    const item = items[i];
    const path = item.dataset.path;
    const type = item.dataset.type;
    const key = type + ':' + path;

    selectedItems.add(key);
    item.classList.add('selected');
  }
  updateSelectionInfo();
}

function getElementIndex(element) {
  const fileList = document.getElementById('fileList');
  const items = Array.from(fileList.querySelectorAll('.file-item'));
  return items.indexOf(element);
}

function getGridColumns(gridEl) {
  const items = gridEl.querySelectorAll('.file-item');
  if (items.length < 2) return 1;
  const top0 = items[0].getBoundingClientRect().top;
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    if (Math.abs(items[i].getBoundingClientRect().top - top0) < 1) n++; else break;
  }
  return n || 1;
}

function clearSelection() {
  selectedItems.clear();
  document.querySelectorAll('.file-item.selected').forEach(item => {
    item.classList.remove('selected');
  });
  lastSelectedIndex = -1;
  updateSelectionInfo();
}

function updateSelectionInfo() {
  const count = selectedItems.size;
  const selectionInfo = document.getElementById('selectionInfo');

  if (count > 0) {
    selectionInfo.textContent = '已选中 ' + count + ' 个项目';
    selectionInfo.classList.add('active');
  } else {
    selectionInfo.textContent = '';
    selectionInfo.classList.remove('active');
  }
}

function handleItemClick(event, element) {
  event.stopPropagation();

  const fileList = document.getElementById('fileList');
  const items = Array.from(fileList.querySelectorAll('.file-item'));
  const currentIndex = items.indexOf(element);
  const isMobile = window.innerWidth <= 768;

  if (isCtrlPressed && isShiftPressed) {
    
    if (lastSelectedIndex >= 0) {
      const lastElement = items[lastSelectedIndex];
      selectRange(lastElement, element);
    } else {
      toggleSelection(element);
    }
  } else if (isCtrlPressed) {
    
    toggleSelection(element);
    lastSelectedIndex = currentIndex;
  } else if (isShiftPressed) {
    
    if (lastSelectedIndex >= 0) {
      const lastElement = items[lastSelectedIndex];
      selectRange(lastElement, element);
    } else {
      selectSingle(element);
    }
  } else if (isMobile) {
    const type = element.dataset.type;
    const path = element.dataset.path;
    if (type === 'folder') {
      navigateTo(path);
    } else {
      const pt = element.dataset.previewType;
      if (pt) {
        previewFile(path, pt, element.dataset.name);
      } else {
        downloadFile(path);
      }
    }
  } else {
    
    selectSingle(element);
  }
}

function getSelectedItems() {
  const items = [];
  selectedItems.forEach(key => {
    const parts = key.split(':');
    const type = parts[0];
    const path = parts.slice(1).join(':');
    const selector = '.file-item[data-path="' + path + '"]';
    const element = document.querySelector(selector);
    if (element) {
      items.push({
        type: type,
        path: path,
        name: element.dataset.name,
        previewType: element.dataset.previewType || null
      });
    }
  });
  return items;
}

async function deleteSelected() {
  const items = getSelectedItems();
  if (items.length === 0) {
    showToast('请先选择要删除的项目', 'warning');
    return;
  }

  if (!confirm('确定要删除选中的 ' + items.length + ' 个项目吗？')) {
    return;
  }

  showLoading(true);
  let successCount = 0;
  let failCount = 0;

  for (const item of items) {
    try {
      const response = await fetch('/api/files/' + encodeURIComponent(item.path.slice(1)), {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      failCount++;
    }
  }

  showLoading(false);

  if (failCount === 0) {
    showToast('成功删除 ' + successCount + ' 个项目', 'success');
  } else {
    showToast('删除完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning');
  }

  clearSelection();
  loadFiles();
}

async function downloadSelected() {
  const items = getSelectedItems();
  if (items.length === 0) {
    showToast('请先选择要下载的项目', 'warning');
    return;
  }

  const MAX_COUNT = 50, MAX_SIZE = 200 * 1024 * 1024; // 200MB
  if (items.length > MAX_COUNT) {
    showToast('最多同时下载 ' + MAX_COUNT + ' 个文件（当前 ' + items.length + ' 个）', 'warning');
    return;
  }
  const totalSize = items.reduce((s, i) => s + (i.size || 0), 0);
  if (totalSize > MAX_SIZE) {
    showToast('总大小超过 200MB（' + formatFileSize(totalSize) + '），一次下载太多会撑爆浏览器', 'warning');
    return;
  }

  if (items.length === 1) {
    downloadFile(items[0].path);
    return;
  }

  showToast('正在打包 ' + items.length + ' 个文件...', 'info');
  const zip = new JSZip();
  for (const item of items) {
    try {
      const resp = await fetch('/api/download' + item.path);
      if (!resp.ok) throw new Error('download failed');
      const blob = await resp.blob();
      zip.file(item.name, blob);
    } catch (e) {
      showToast('下载失败: ' + item.name, 'error');
      return;
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'files_' + new Date().toISOString().slice(0, 10) + '.zip';
  a.click();
  URL.revokeObjectURL(url);
  showToast('打包下载完成', 'success');
}

function selectAll() {
  const fileList = document.getElementById('fileList');
  const items = fileList.querySelectorAll('.file-item');

  items.forEach(item => {
    const path = item.dataset.path;
    const type = item.dataset.type;
    const key = type + ':' + path;

    selectedItems.add(key);
    item.classList.add('selected');
  });

  updateSelectionInfo();
  showToast('已全选 ' + items.length + ' 个项目', 'success');
}

function initMultiSelect() {
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-item') && !e.target.closest('.context-menu')) {
      clearSelection();
    }
  });
}

    let currentUserRole = 'user';

    async function checkAuth() {
      try {
        if (window.__INIT__) {
          currentUserRole = window.__INIT__.role || 'user';
        } else {
          const response = await fetch('/api/auth/check');
          const data = await response.json();
          if (!data.authenticated) {
            window.location.href = '/login.html';
            return;
          }
          currentUserRole = data.role || 'user';
        }
        if (currentUserRole === 'guest') {
          const guestRoot = (window.__INIT__ && window.__INIT__.guestRoot) || 'guest';
          showGuestNotice(guestRoot);
          if (currentPath === '/') {
            currentPath = '/' + guestRoot + '/';
            history = ['/' + guestRoot + '/'];
            historyIndex = 0;
          }
        }
      } catch (error) {
        if (!window.__INIT__) window.location.href = '/login.html';
      }
    }

    function showGuestNotice(guestRoot) {
      const notice = document.createElement('div');
      notice.id = 'guestNotice';
      notice.style.cssText = 'background: var(--warning-bg, #fff3cd); color: var(--warning-text, #856404); padding: 10px 16px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px;';
      const root = guestRoot || 'guest';
      notice.innerHTML = '📦 游客模式：仅可访问 ' + root + ' 文件夹';
      const mainContent = document.querySelector('.main-content');
      if (mainContent && !document.getElementById('guestNotice')) {
        mainContent.insertBefore(notice, mainContent.firstChild.nextSibling || mainContent.firstChild);
      }
      updateUIForGuest();
    }

    function updateUIForGuest() {
      if (currentUserRole !== 'guest') return;
      const adminBtn = document.getElementById('adminBtn');
      if (adminBtn) adminBtn.style.display = 'none';
    }

    async function loadFiles() {
      showLoading(true);
      try {
        const response = await fetch('/api/files' + currentPath);
        const data = await response.json();

        if (!data.success) {
          if (response.status === 401) {
            window.location.href = '/login.html';
            return;
          }
          throw new Error(data.message);
        }

        renderBreadcrumb();
        renderFiles(data.folders, data.files);
      } catch (error) {
        showToast('加载文件失败: ' + error.message, 'error');
      } finally {
        showLoading(false);
      }
    }

    function renderBreadcrumb() {
      const breadcrumb = document.getElementById('breadcrumb');
      const parts = currentPath.split('/').filter(p => p);

      const backDisabled = historyIndex <= 0 ? 'disabled' : '';
      const forwardDisabled = historyIndex >= history.length - 1 ? 'disabled' : '';
      let html = '<button class="nav-btn" id="backBtn"' + backDisabled + ' onclick="goBack()" title="后退">◀</button>';
      html += '<button class="nav-btn" id="forwardBtn"' + forwardDisabled + ' onclick="goForward()" title="前进">▶</button>';

      if (currentUserRole === 'guest') {
        const guestRoot = (window.__INIT__ && window.__INIT__.guestRoot) || 'guest';
        if (parts.length === 1) {
          html += ' <span class="breadcrumb-item active">' + guestRoot + '</span>';
        } else {
          html += ' <a href="javascript:void(0)" class="breadcrumb-item" data-path="/' + guestRoot + '">' + guestRoot + '</a>';
          let path = '/' + guestRoot;
          for (let i = 1; i < parts.length; i++) {
            path += '/' + parts[i];
            html += '<span class="breadcrumb-separator">/</span>';
            if (i === parts.length - 1) {
              html += '<span class="breadcrumb-item active">' + parts[i] + '</span>';
            } else {
              html += '<a href="javascript:void(0)" class="breadcrumb-item" data-path="' + path + '">' + parts[i] + '</a>';
            }
          }
        }
      } else {
        html += ' <a href="javascript:void(0)" class="breadcrumb-item" data-path="/">🏠 根目录</a>';
        let path = '';
        parts.forEach((part, index) => {
          path += '/' + part;
          html += '<span class="breadcrumb-separator">/</span>';
          if (index === parts.length - 1) {
            html += '<span class="breadcrumb-item active">' + part + '</span>';
          } else {
            html += '<a href="javascript:void(0)" class="breadcrumb-item" data-path="' + path + '">' + part + '</a>';
          }
        });
      }
      breadcrumb.innerHTML = html;
    }

    function renderFiles(folders, files) {
      const fileList = document.getElementById('fileList');
      const emptyState = document.getElementById('emptyState');

      fileList.className = viewMode === 'list' ? 'file-list' : 'file-grid';

      if (folders.length === 0 && files.length === 0) {
        fileList.innerHTML = '';
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';

      let html = '';

      if (viewMode === 'list') {
        const nameArrow = sortField === 'name' ? (sortAscending ? ' ▲' : ' ▼') : '';
        const sizeArrow = sortField === 'size' ? (sortAscending ? ' ▲' : ' ▼') : '';
        const timeArrow = sortField === 'time' ? (sortAscending ? ' ▲' : ' ▼') : '';
        html += '<div class="file-list-header"><span></span>';
        html += '<span class="sortable-header' + (sortField === 'name' ? ' active' : '') + '" onclick="toggleSort(\\'name\\')" style="cursor:pointer;user-select:none;">名称' + nameArrow + '</span>';
        html += '<span class="sortable-header' + (sortField === 'time' ? ' active' : '') + '" onclick="toggleSort(\\'time\\')" style="cursor:pointer;user-select:none;">时间' + timeArrow + '</span>';
        html += '<span class="sortable-header' + (sortField === 'size' ? ' active' : '') + '" onclick="toggleSort(\\'size\\')" style="cursor:pointer;user-select:none;">大小' + sizeArrow + '</span>';
        html += '<span>操作</span></div>';
      }

      const sortedFolders = [...folders].sort((a, b) => {
        if (sortField === 'name') {
          const cmp = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
          return sortAscending ? cmp : -cmp;
        }
        return 0;
      });
      const sortedFiles = [...files].sort((a, b) => {
        if (sortField === 'name') {
          const cmp = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
          return sortAscending ? cmp : -cmp;
        }
        if (sortField === 'size') {
          const cmp = (a.size || 0) - (b.size || 0);
          return sortAscending ? cmp : -cmp;
        }
        if (sortField === 'time') {
          const cmp = new Date(a.lastModified || 0) - new Date(b.lastModified || 0);
          return sortAscending ? cmp : -cmp;
        }
        return 0;
      });

sortedFolders.forEach(folder => {
  html += \`
    <div class="file-item"
         ondblclick="navigateTo('\${folder.path}')"
		 onclick="handleItemClick(event, this)"
         oncontextmenu="showContextMenu(event, 'folder', '\${folder.path}', '\${escapeHtml(folder.name)}')"
         data-type="folder"
         data-path="\${folder.path}"
         data-name="\${escapeHtml(folder.name)}">
      <div class="file-icon">📁</div>
      <div class="file-name">\${escapeHtml(folder.name)}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">-</div>' : ''}
      <div class="file-meta" style="font-size:10px">\${viewMode === 'list' ? '文件夹' : '文件夹'}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">双击打开</div>' : ''}
    </div>
  \`;
});

sortedFiles.forEach(file => {
  const icon = getFileIcon(file.name);
  const previewType = file.previewType || '';

  html += \`
    <div class="file-item"
         ondblclick="handleFileClick('\${file.path}', '\${previewType}', '\${escapeHtml(file.name)}')"
		 onclick="handleItemClick(event, this)"
         oncontextmenu="showContextMenu(event, 'file', '\${file.path}', '\${escapeHtml(file.name)}', '\${previewType}')"
         data-type="file"
         data-path="\${file.path}"
         data-name="\${escapeHtml(file.name)}"
         data-preview-type="\${previewType}">
      <div class="file-icon">\${icon}</div>
      <div class="file-name">\${escapeHtml(file.name)}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">' + (file.timeFormatted || '-') + '</div>' : ''}
      <div class="file-meta" style="font-size:10px">\${file.sizeFormatted}\${previewType && viewMode !== 'list' ? ' <span class="badge badge-info">可预览</span>' : ''}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">' + (previewType ? '可预览 · 右键编辑' : '右键菜单') + '</div>' : ''}
    </div>
  \`;
});

      fileList.innerHTML = html;

      if (pendingSelectFile) {
        const target = document.querySelector('.file-item[data-name="' + pendingSelectFile.replace(/"/g, '\\"') + '"]');
        if (target) {
          selectedItems.clear();
          document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
          const path = target.dataset.path;
          const type = target.dataset.type;
          selectedItems.add(type + ':' + path);
          target.classList.add('selected');
          updateSelectionInfo();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.animation = 'none';
          target.offsetHeight;
          target.style.animation = 'selectPulse 0.6s ease';
        }
        pendingSelectFile = null;
      }
    }

    function handleFileClick(path, previewType, filename) {
      if (filename && filename.slice(-4).toLowerCase() === '.url') {
        const w = window.open('', '_blank');
        fetch('/api/preview' + path).then(r => r.text()).then(text => {
          const m = text.match(/^URL=(.+)$/im);
          if (m && m[1].trim()) w.location = m[1].trim();
          else { w.close(); alert('无法从 .url 文件中解析出网址'); }
        }).catch(e => { w.close(); alert('打开链接失败: ' + e.message); });
        return;
      }
      if (previewType) {
        previewFile(path, previewType, filename);
      } else {
        downloadFile(path);
      }
    }

    function getFileIcon(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      const icons = {
        'pdf':'📕', 'doc':'📘', 'docx':'📘', 'xls':'📗', 'xlsx':'📗', 'ppt':'📙', 'pptx':'📙',
        'jpg':'🖼️', 'jpeg':'🖼️', 'png':'🖼️', 'gif':'🖼️', 'svg':'🖼️', 'webp':'🖼️', 'bmp':'🖼️', 'ico':'🖼️',
        'mp3':'🎵', 'wav':'🎵', 'flac':'🎵', 'aac':'🎵', 'ogg':'🎵', 'm4a':'🎵',
        'mp4':'🎬', 'avi':'🎬', 'mkv':'🎬', 'mov':'🎬', 'webm':'🎬',
        'zip':'📦', 'rar':'📦', '7z':'📦', 'tar':'📦', 'gz':'📦',
        'js':'📜', 'ts':'📜', 'py':'📜', 'java':'📜', 'cpp':'📜', 'c':'📜',
        'html':'🐋', 'css':'🎨', 'json':'📋', 'xml':'📋', 'yml':'📋', 'yaml':'📋', 'csv':'📊',
        'txt':'📝', 'md':'📝', 'epub':'📓',
        'glb':'🧬', 'gltf':'🧬', 'obj':'🧬',
        'exe':'🖥️', 'msi':'🖥️', 'apk':'📱', 'url':'🌐',
      };
      return icons[ext] || '📄';
    }

    function navigateTo(path, fromHistory = false) {
      const guestRoot = (window.__INIT__ && window.__INIT__.guestRoot) || 'guest';
      if (currentUserRole === 'guest' && !path.startsWith('/' + guestRoot)) return;
      currentPath = path;
      if (!fromHistory) {
        history = history.slice(0, historyIndex + 1);
        history.push(path);
        historyIndex++;
      }
      updateNavButtons();
      loadFiles();
      highlightCurrentFavorite();
      var sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('open')) toggleSidebar();
    }

    function goBack() {
      if (historyIndex <= 0) return;
      historyIndex--;
      navigateTo(history[historyIndex], true);
    }

    function goForward() {
      if (historyIndex >= history.length - 1) return;
      historyIndex++;
      navigateTo(history[historyIndex], true);
    }

    function updateNavButtons() {
      const backBtn = document.getElementById('backBtn');
      const forwardBtn = document.getElementById('forwardBtn');
      if (backBtn) backBtn.disabled = (historyIndex <= 0);
      if (forwardBtn) forwardBtn.disabled = (historyIndex >= history.length - 1);
    }

    function toggleViewMode(mode) {
      viewMode = mode;
      localStorage.setItem('fileViewMode', mode);

      document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === mode);
      });

      loadFiles();
    }

    function toggleSort(field) {
      if (sortField === field) {
        sortAscending = !sortAscending;
      } else {
        sortField = field;
        sortAscending = true;
      }
      localStorage.setItem('sortField', sortField);
      localStorage.setItem('sortAscending', sortAscending);
      loadFiles();
    }

    let dragCounter = 0;
    let isDragging = false;

    function initDragUpload() {
      const fileList = document.getElementById('fileList');
      const card = fileList.closest('.card');
      const uploadOverlay = document.getElementById('uploadOverlay');

      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
        card.addEventListener(eventName, preventDefaults, false);
      });

      card.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (!isDragging && e.dataTransfer.types.includes('Files')) {
          isDragging = true;
          uploadOverlay.classList.add('active');
        }
      }, false);

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }, false);

      card.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
          isDragging = false;
          uploadOverlay.classList.remove('active');
        }
      }, false);

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        isDragging = false;
        uploadOverlay.classList.remove('active');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
          uploadFiles(files);
        }
      }, false);
    }

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
      return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    async function uploadFiles(files) {
      if (!files || files.length === 0) return;
      var oversizedNames = [];
      for (var i = 0; i < files.length; i++) {
        if (files[i].size > 100 * 1024 * 1024) {
          oversizedNames.push(files[i].name);
        }
      }
      if (oversizedNames.length > 0) {
        showToast('以下文件超过 100MB 限制：' + oversizedNames.join('、'), 'error');
        return;
      }

      const progressContainer = document.getElementById('uploadProgressContainer');
      const progressFill = document.getElementById('uploadProgressFill');
      const progressFilename = document.getElementById('uploadProgressFilename');
      const progressPercentage = document.getElementById('uploadProgressPercentage');

      progressContainer.classList.add('active');
      progressFill.style.width = '0%';
      progressFilename.textContent = '准备上传...';
      progressPercentage.textContent = '0%';

      let successCount = 0;
      let failCount = 0;
      const totalFiles = files.length;
      const SMALL = 1 * 1024 * 1024;

      // 分堆
      const smallFiles = [];
      const largeFiles = [];
      for (let i = 0; i < files.length; i++) {
        if (files[i].size <= SMALL) smallFiles.push(files[i]);
        else largeFiles.push(files[i]);
      }
      async function uploadLarge(file) {
        progressFilename.textContent = file.name + ' (' + (successCount + failCount + 1) + '/' + totalFiles + ')';
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const base = successCount + failCount;
              const overall = (base + e.loaded / e.total) / totalFiles * 100;
              const pct = Math.min(100, Math.floor(overall));
              progressFill.style.width = pct + '%';
              progressPercentage.textContent = pct + '%';
            }
          });
          xhr.addEventListener('load', () => {
            try { const d = JSON.parse(xhr.responseText); if (d.success) successCount++; else failCount++; }
            catch(e) { failCount++; }
            const done = successCount + failCount;
            const pct = Math.min(100, Math.floor(done / totalFiles * 100));
            progressFill.style.width = pct + '%';
            progressPercentage.textContent = pct + '%';
            resolve();
          });
          xhr.addEventListener('error', () => { failCount++; resolve(); });
          xhr.open('POST', '/api/files' + currentPath);
          const fd = new FormData();
          fd.append('file', file);
          xhr.send(fd);
        });
      }
      if (smallFiles.length > 0) {
        progressFilename.textContent = '上传小文件...（' + smallFiles.length + ' 个）';
        await Promise.all(smallFiles.map(file => {
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.addEventListener('load', () => {
              try { const d = JSON.parse(xhr.responseText); if (d.success) successCount++; else failCount++; }
              catch(e) { failCount++; }
              const done = successCount + failCount;
              const pct = Math.min(100, Math.floor(done / totalFiles * 100));
              progressFill.style.width = pct + '%';
              progressPercentage.textContent = pct + '%';
              resolve();
            });
            xhr.addEventListener('error', () => { failCount++; resolve(); });
            xhr.open('POST', '/api/files' + currentPath);
            const fd = new FormData();
            fd.append('file', file);
            xhr.send(fd);
          });
        }));
      }
      for (let i = 0; i < largeFiles.length; i++) {
        await uploadLarge(largeFiles[i]);
      }

      progressFill.style.width = '100%';
      progressFilename.textContent = '上传完成! 成功: ' + successCount + '/' + totalFiles;
      progressPercentage.textContent = '100%';

      setTimeout(() => {
        closeUploadProgress();
        if (successCount > 0 && failCount === 0) {
          showToast('成功上传 ' + successCount + ' 个文件', 'success');
          loadFiles();
        } else if (successCount > 0 && failCount > 0) {
          showToast('上传完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning');
          loadFiles();
        } else if (failCount > 0) {
          showToast('上传失败：' + failCount + ' 个文件上传失败', 'error');
        }
      }, 2000);
    }

    


    async function previewFile(path, previewType, filename) {
      const overlay = document.getElementById('previewOverlay');
      const content = document.getElementById('previewContent');
      const filenameEl = document.getElementById('previewFilename');
      const downloadBtn = document.getElementById('previewDownloadBtn');

      filenameEl.textContent = filename;
      downloadBtn.onclick = () => downloadFile(path);

      content.innerHTML = '<div class="preview-loading"><div class="spinner"></div><div>加载中...</div></div>';
      overlay.classList.add('active');

      try {
        const previewUrl = '/api/preview' + path;

        switch (previewType) {
          case 'image':
            content.innerHTML = '<img class="preview-image" src="' + previewUrl + '" alt="' + escapeHtml(filename) + '">';
            break;

          case 'pdf':
            content.innerHTML = '<iframe class="preview-pdf" src="' + previewUrl + '"></iframe>';
            break;

          case 'html':
            content.innerHTML = '<iframe class="preview-html" src="' + previewUrl + '" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>';
            break;

          case 'text':
            const textResponse = await fetch(previewUrl);
            const text = await textResponse.text();
            const ext = filename.split('.').pop().toLowerCase();

            if (ext === 'md') {
              
              const htmlContent = marked.parse(text);
              content.innerHTML = '<div class="preview-markdown">' + htmlContent + '</div>';
            } else if (ext === 'json') {
              
              try {
                const json = JSON.parse(text);
                content.innerHTML = '<pre class="preview-text">' + escapeHtml(JSON.stringify(json, null, 2)) + '</pre>';
              } catch {
                content.innerHTML = '<pre class="preview-text">' + escapeHtml(text) + '</pre>';
              }
            } else {
              content.innerHTML = '<pre class="preview-text">' + escapeHtml(text) + '</pre>';
            }
            break;

          case 'video':
            content.innerHTML = '<video class="preview-video" controls autoplay><source src="' + previewUrl + '"></video>';
            break;

          case 'audio':
            content.innerHTML = '<audio class="preview-audio" controls autoplay><source src="' + previewUrl + '"></audio>';
            break;

          case 'word':
            
            const docxResponse = await fetch(previewUrl);
            const docxArrayBuffer = await docxResponse.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer: docxArrayBuffer });
            content.innerHTML = '<div class="preview-markdown">' + result.value + '</div>';
            break;

          default:
            content.innerHTML = '<div class="preview-error">不支持预览此文件类型</div>';
        }
      } catch (error) {
        content.innerHTML = '<div class="preview-error">预览加载失败: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function closePreview() {
      const overlay = document.getElementById('previewOverlay');
      overlay.classList.remove('active');
      
      document.getElementById('previewContent').innerHTML = '';
    }

    // 预览层 Escape 已由全局 keydown 处理

    async function handleFileUpload(event) {
      const files = event.target.files;
      if (!files.length) return;

      await uploadFiles(files);
      event.target.value = '';
    }

    function showNewFolderModal() {
      document.getElementById('folderName').value = '';
      document.getElementById('newFolderModal').classList.add('active');
      setTimeout(() => { const inp = document.getElementById('folderName'); inp.focus(); inp.select(); }, 50);
    }

    async function createFolder(event) {
      event.preventDefault();
      const name = document.getElementById('folderName').value.trim();
      if (!name) { showToast('请输入文件夹名称', 'error'); return; }
      closeModal('newFolderModal');
      let path = currentPath;
      if (!path.endsWith('/')) path += '/';
      path += name;
      await apiCall('/api/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      }, '文件夹创建成功', loadFiles);
    }

    function toggleDropdown(btn) {
      const menu = btn.parentElement.querySelector('.new-file-dropdown-menu');
      const rect = btn.getBoundingClientRect();
      menu.classList.remove('dropup');
      const willOpen = !menu.classList.contains('active');
      menu.classList.toggle('active');
      if (willOpen) {
        const isMobile = window.innerWidth <= 768;
        if (isMobile || rect.bottom > window.innerHeight / 2) {
          menu.classList.add('dropup');
        }
      }
    }
    function closeDropdowns() {
      document.querySelectorAll('.new-file-dropdown-menu.active').forEach(m => m.classList.remove('active'));
    }

    function showNewFileModal(ext) {
      const name = ext ? '新建文件.' + ext : '';
      document.getElementById('newFileName').value = name;
      document.getElementById('newFileContent').value = '';
      document.getElementById('newFileModal').classList.add('active');
      setTimeout(() => { const inp = document.getElementById('newFileName'); inp.focus(); inp.select(); }, 50);
    }

    async function createNewFile(event) {
      event.preventDefault();
      const name = document.getElementById('newFileName').value.trim();
      const content = document.getElementById('newFileContent').value;
      if (!name) { showToast('请输入文件名', 'error'); return; }
      closeModal('newFileModal');
      let path = currentPath;
      if (!path.endsWith('/')) path += '/';
      path += name;
      await apiCall('/api/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      }, '文件创建成功', loadFiles);
    }

    function showRenameModal(path, currentName) {
      document.getElementById('renameFilePath').value = path;
      document.getElementById('renameModal').classList.add('active');
      const inp = document.getElementById('renameFileName');
      inp.value = currentName;
      const dot = currentName.lastIndexOf('.');
      setTimeout(() => { inp.focus(); dot > 0 ? inp.setSelectionRange(0, dot) : inp.select(); }, 50);
    }

    async function renameFile(event) {
      event.preventDefault();
      const path = document.getElementById('renameFilePath').value;
      const newName = document.getElementById('renameFileName').value.trim();
      if (!newName) { showToast('请输入新名称', 'error'); return; }
      closeModal('renameModal');
      await apiCall('/api/files' + path, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      }, '重命名成功', loadFiles);
    }

    async function deleteFile(path) {
      if (!confirm('确定要删除吗？此操作不可恢复。')) return;
      await apiCall('/api/files' + path, { method: 'DELETE' }, '删除成功', loadFiles);
    }

    async function downloadFile(path) {
      window.open('/api/download' + path, '_blank');
    }

    function showShareModal(path) {
      document.getElementById('shareFilePath').value = path;
      document.getElementById('sharePassword').value = '';
      document.getElementById('shareExpiry').value = '1d';
      document.getElementById('shareModal').classList.add('active');
    }

    async function createShare(event) {
      event.preventDefault();
      const filePath = document.getElementById('shareFilePath').value;
      const password = document.getElementById('sharePassword').value;
      const expiresIn = document.getElementById('shareExpiry').value;

      showLoading(true);
      closeModal('shareModal');

      try {
        const response = await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, password, expiresIn })
        });

        const data = await response.json();

        if (data.success) {
          const fullUrl = window.location.origin + data.shareUrl;
          document.getElementById('shareResultUrl').value = fullUrl;
          document.getElementById('shareResultModal').classList.add('active');
        } else {
          showToast('创建分享链接失败: ' + data.message, 'error');
        }
      } catch (error) {
        showToast('创建分享链接失败: ' + error.message, 'error');
      } finally {
        showLoading(false);
      }
    }

    function copyShareLink() {
      const input = document.getElementById('shareResultUrl');
      input.select();
      document.execCommand('copy');
      showToast('链接已复制到剪贴板', 'success');
    }

    let aceEditor = null;
    let editorCurrentPath = null;
    let editorDirty = false;
    let editorFontSize = 14;
    let editorDarkTheme = true;
    let editorWordWrap = true;
    let editorFullscreen = false;
    let editorRawBytes = null;
    let editorCurrentEncoding = 'utf-8';

    async function openEditor(filePath, filename) {
      try {
        showLoading(true);
        const res = await fetch('/api/edit' + filePath);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          showToast(d.message || '无法读取文件', 'error');
          return;
        }
        const arrayBuffer = await res.arrayBuffer();
        editorRawBytes = new Uint8Array(arrayBuffer);
        editorCurrentEncoding = 'utf-8';
        const content = decodeWithEncoding(editorRawBytes, editorCurrentEncoding);
        updateEncodingMenuChecked(editorCurrentEncoding);
        updateEncodingStatus(editorCurrentEncoding);

        document.getElementById('editorFilename').textContent = filename;
        editorCurrentPath = filePath;
        setEditorDirty(false);

        const modal = document.getElementById('editorModal');
        const win = document.getElementById('editorWindow');

        if (window.innerWidth <= 768) {
          editorFullscreen = true;
        } else {
          editorFullscreen = false;
          document.getElementById('editorWindowBtn').textContent = '🗖';
          win.style.width = '90vw';
          win.style.height = '85vh';
          win.style.position = 'relative';
          win.style.left = '';
          win.style.top = '';
          modal.style.alignItems = 'center';
          modal.style.justifyContent = 'center';
        }

        modal.classList.add('active');

        if (!aceEditor) {
          aceEditor = ace.edit('aceEditorContainer');
          aceEditor.setOptions({
            showPrintMargin: false,
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            tabSize: 2,
            useSoftTabs: true
          });
          
          aceEditor.session.on('change', function() {
            setEditorDirty(true);
          });
          
          aceEditor.selection.on('changeCursor', updateEditorStatus);
          aceEditor.session.on('changeScrollTop', updateEditorStatus);

        }

        aceEditor.setTheme(editorDarkTheme ? 'ace/theme/monokai' : 'ace/theme/chrome');
        aceEditor.setFontSize(editorFontSize + 'px');
        aceEditor.session.setUseWrapMode(editorWordWrap);
        document.getElementById('editorWordWrapBtn').textContent = editorWordWrap ? '↔' : '↩';
        document.getElementById('editorThemeBtn').textContent = editorDarkTheme ? '🌙' : '☀️';
        document.getElementById('editorFontSizeLabel').textContent = editorFontSize;

        try {
          const modelist = ace.require('ace/ext/modelist');
          const mode = modelist.getModeForPath(filename).mode;
          aceEditor.session.setMode(mode);
          document.getElementById('editorStatusMode').textContent = mode.replace('ace/mode/', '');
        } catch (e) {
          aceEditor.session.setMode('ace/mode/text');
          document.getElementById('editorStatusMode').textContent = 'text';
        }

        aceEditor.session.setValue(content, -1);
        
        aceEditor.session.getUndoManager().reset();
        setEditorDirty(false);
        aceEditor.focus();
        aceEditor.gotoLine(0, 0);
        updateEditorStatus();
      } catch (err) {
        showToast('打开编辑器失败: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    }

    function setEditorDirty(dirty) {
      editorDirty = dirty;
      document.getElementById('editorDirtyIndicator').style.display = dirty ? 'inline' : 'none';
    }

    async function saveEditor() {
      if (!editorCurrentPath || !aceEditor) return;
      try {
        document.getElementById('editorSaveBtn').disabled = true;
        document.getElementById('editorSaveBtn').textContent = '⏳ 保存中...';
        const content = aceEditor.getValue();
        const res = await fetch('/api/edit' + editorCurrentPath, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: content
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.success) {
          setEditorDirty(false);
          showToast('文件已保存', 'success');
          
          if (typeof loadFiles === 'function') loadFiles();
        } else {
          showToast(d.message || '保存失败', 'error');
        }
      } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
      } finally {
        document.getElementById('editorSaveBtn').disabled = false;
        document.getElementById('editorSaveBtn').textContent = '💾 保存';
      }
    }

    function closeEditor() {
      if (editorDirty) {
        if (!confirm('文件有未保存的修改，确定要关闭吗？')) return;
      }
      document.getElementById('editorModal').classList.remove('active');
      editorCurrentPath = null;
      editorRawBytes = null;
      editorCurrentEncoding = 'utf-8';
      setEditorDirty(false);
    }

    function decodeWithEncoding(bytes, encoding) {
      try {
        const decoder = new TextDecoder(encoding, { fatal: false });
        return decoder.decode(bytes);
      } catch (e) {
        showToast('不支持的编码: ' + encoding, 'error');
        return '';
      }
    }

    function updateEncodingStatus(encoding) {
      const displayMap = {
        'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 BOM', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE',
        'gbk': 'GBK', 'ansi': 'ANSI', 'windows-1252': 'ANSI'
      };
      document.getElementById('editorStatusEncoding').textContent = displayMap[encoding] || encoding.toUpperCase();
    }

    function updateEncodingMenuChecked(encoding) {
      document.querySelectorAll('#editorEncodingMenu .editor-encoding-menu-item[data-enc-use]').forEach(item => {
        item.classList.toggle('checked', item.dataset.encUse === encoding);
      });
    }

    function toggleEncodingMenu(e) {
      e.stopPropagation();
      document.getElementById('editorEncodingMenu').classList.toggle('open');
    }

    function closeAllEncodingMenus() {
      document.getElementById('editorEncodingMenu').classList.remove('open');
    }

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.editor-encoding-menu') && !e.target.closest('#editorEncodingBtn')) {
        closeAllEncodingMenus();
      }
    });

    function openWithEncoding(encoding) {
      closeAllEncodingMenus();
      if (!editorRawBytes || !aceEditor) return;
      const encMap = { 'ansi': 'gbk', 'gbk': 'gbk', 'utf-8': 'utf-8', 'utf-8-bom': 'utf-8', 'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be' };
      const enc = encMap[encoding] || encoding;
      const content = decodeWithEncoding(editorRawBytes, enc);
      editorCurrentEncoding = encoding;
      aceEditor.session.setValue(content, -1);
      aceEditor.session.getUndoManager().reset();
      setEditorDirty(false);
      updateEncodingMenuChecked(encoding);
      updateEncodingStatus(encoding);
      const labels = { 'ansi': 'ANSI/GBK', 'gbk': 'GBK', 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8-BOM', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE' };
      showToast('已使用 ' + (labels[encoding] || encoding.toUpperCase()) + ' 编码打开', 'success');
    }

    function convertEncoding(encoding) {
      closeAllEncodingMenus();
      if (!editorRawBytes || !aceEditor) return;
      const encMap = { 'ansi': 'gbk', 'gbk': 'gbk', 'utf-8': 'utf-8', 'utf-8-bom': 'utf-8', 'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be' };
      const enc = encMap[encoding] || encoding;
      const content = decodeWithEncoding(editorRawBytes, enc);
      editorCurrentEncoding = encoding;
      aceEditor.session.setValue(content, -1);
      aceEditor.session.getUndoManager().reset();
      setEditorDirty(false);
      updateEncodingStatus(encoding);
      const labels = { 'ansi': 'ANSI/GBK', 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8-BOM', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE' };
      showToast('已转换为 ' + (labels[encoding] || encoding.toUpperCase()) + ' 编码', 'success');
    }

    function editorUndo() { if (aceEditor) aceEditor.undo(); }
    function editorRedo() { if (aceEditor) aceEditor.redo(); }

    function editorFind() {
      if (!aceEditor) return;
      aceEditor.execCommand('find');
    }

    function editorGoToLine() {
      if (!aceEditor) return;
      const line = prompt('跳转到行号 (1-' + (aceEditor.session.getLength()) + '):');
      if (line !== null && !isNaN(line)) {
        aceEditor.gotoLine(parseInt(line, 10), 0, true);
      }
    }

    function changeEditorFontSize(delta) {
      editorFontSize = Math.max(10, Math.min(28, editorFontSize + delta));
      if (aceEditor) aceEditor.setFontSize(editorFontSize + 'px');
      document.getElementById('editorFontSizeLabel').textContent = editorFontSize;
    }

    function editorToggleWordWrap() {
      editorWordWrap = !editorWordWrap;
      if (aceEditor) aceEditor.session.setUseWrapMode(editorWordWrap);
      document.getElementById('editorWordWrapBtn').textContent = editorWordWrap ? '↔' : '↩';
      document.getElementById('editorWordWrapBtn').title = editorWordWrap ? '取消自动换行' : '切换自动换行';
    }

    function editorToggleTheme() {
      editorDarkTheme = !editorDarkTheme;
      if (aceEditor) aceEditor.setTheme(editorDarkTheme ? 'ace/theme/monokai' : 'ace/theme/chrome');
      document.getElementById('editorThemeBtn').textContent = editorDarkTheme ? '🌙' : '☀️';
      document.getElementById('editorThemeBtn').title = editorDarkTheme ? '切换浅色主题' : '切换深色主题';
      
      const win = document.getElementById('editorWindow');
      if (win) {
        win.style.background = editorDarkTheme ? '#1e1e1e' : '#f5f5f5';
      }
    }

    function editorToggleFullscreen() {
      const win = document.getElementById('editorWindow');
      const modal = document.getElementById('editorModal');
      if (!win) return;

      editorFullscreen = !editorFullscreen;
      if (editorFullscreen) {
        
        win.dataset.prevW = win.style.width;
        win.dataset.prevH = win.style.height;
        win.dataset.prevBg = editorDarkTheme ? '#1e1e1e' : '#f5f5f5';
        win.style.width = '100vw';
        win.style.height = '100vh';
        win.style.borderRadius = '0';
        win.style.position = 'fixed';
        win.style.left = '0';
        win.style.top = '0';
        win.style.resize = 'none';
        win.style.minWidth = '100vw';
        win.style.minHeight = '100vh';
        modal.style.alignItems = 'stretch';
        modal.style.justifyContent = 'stretch';
        document.getElementById('editorWindowBtn').textContent = '🗗';
      } else {
        win.style.width = win.dataset.prevW || '90vw';
        win.style.height = win.dataset.prevH || '85vh';
        win.style.borderRadius = '8px';
        win.style.position = 'relative';
        win.style.left = '';
        win.style.top = '';
        win.style.resize = 'both';
        win.style.minWidth = '600px';
        win.style.minHeight = '400px';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        document.getElementById('editorWindowBtn').textContent = '🗖';
      }
      if (aceEditor) aceEditor.resize();
    }

    function updateEditorStatus() {
      if (!aceEditor) return;
      const cursor = aceEditor.selection.getCursor();
      document.getElementById('editorStatusPosition').textContent =
        '行 ' + (cursor.row + 1) + ', 列 ' + (cursor.column + 1);
      document.getElementById('editorStatusIndent').textContent =
        '空格: ' + aceEditor.session.getTabSize();
    }

    (function initEditorDrag() {
      let isDragging = false, dragX, dragY, startX, startY;
      document.addEventListener('mousedown', function(e) {
        const toolbar = document.getElementById('editorToolbar');
        if (!toolbar || !toolbar.contains(e.target)) return;
        
        if (e.target.closest('.editor-tool-btn')) return;
        
        if (editorFullscreen) return;
        const win = document.getElementById('editorWindow');
        if (!win || !win.style.left) {
          
          const rect = win.getBoundingClientRect();
          win.style.position = 'fixed';
          win.style.left = rect.left + 'px';
          win.style.top = rect.top + 'px';
          win.style.width = rect.width + 'px';
          win.style.height = rect.height + 'px';
          document.getElementById('editorModal').style.alignItems = 'stretch';
          document.getElementById('editorModal').style.justifyContent = 'stretch';
        }
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        dragX = parseInt(win.style.left) || 0;
        dragY = parseInt(win.style.top) || 0;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const win = document.getElementById('editorWindow');
        if (!win) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        win.style.left = (dragX + dx) + 'px';
        win.style.top = (dragY + dy) + 'px';
      });
      document.addEventListener('mouseup', function() {
        isDragging = false;
      });

      // Touch support for dragging (tablet window mode)
      document.addEventListener('touchstart', function(e) {
        const toolbar = document.getElementById('editorToolbar');
        if (!toolbar || !toolbar.contains(e.target)) return;
        if (e.target.closest('.editor-tool-btn')) return;
        if (editorFullscreen) return;
        const win = document.getElementById('editorWindow');
        if (!win || !win.style.left) {
          const rect = win.getBoundingClientRect();
          win.style.position = 'fixed';
          win.style.left = rect.left + 'px';
          win.style.top = rect.top + 'px';
          win.style.width = rect.width + 'px';
          win.style.height = rect.height + 'px';
          document.getElementById('editorModal').style.alignItems = 'stretch';
          document.getElementById('editorModal').style.justifyContent = 'stretch';
        }
        isDragging = true;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        dragX = parseInt(win.style.left) || 0;
        dragY = parseInt(win.style.top) || 0;
        e.preventDefault();
      }, { passive: false });

      document.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        const win = document.getElementById('editorWindow');
        if (!win) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        win.style.left = (dragX + dx) + 'px';
        win.style.top = (dragY + dy) + 'px';
        e.preventDefault();
      }, { passive: false });

      document.addEventListener('touchend', function() {
        isDragging = false;
      });
    })();

    document.addEventListener('keydown', function(e) {
      const modal = document.getElementById('editorModal');
      if (!modal || !modal.classList.contains('active')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveEditor();
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        editorGoToLine();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        editorUndo();
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        editorRedo();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        editorFind();
      }

      if (e.key === 'Home' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (aceEditor) {
          const session = aceEditor.getSession();
          aceEditor.gotoLine(1, 0, true);
          aceEditor.scrollToRow(0);
        }
      }

      if (e.key === 'End' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (aceEditor) {
          const session = aceEditor.getSession();
          const lastLine = session.getLength();
          const lastCol = session.getLine(lastLine - 1).length;
          aceEditor.gotoLine(lastLine, lastCol, true);
          aceEditor.scrollToRow(lastLine - 1);
        }
      }

      // Escape 关闭编辑器（已由全局 keydown 处理，含未保存检测）
    });

    // Handle virtual keyboard on mobile
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function() {
        if (aceEditor) aceEditor.resize();
      });
    }

    ${SHARED_SCRIPTS}

  </script>
</body>
</html>
`;

const ADMIN_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理后台</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()</script>
  ${CSS_STYLES}
</head>
<body>
  <div class="header">
    <div class="logo">管理后台</div>
    <div class="header-actions">
      <button class="theme-toggle" onclick="toggleTheme()" title="切换主题"></button>
      <button class="btn btn-secondary" onclick="window.location.href='/'">返回云盘</button>
      <button class="btn btn-secondary" onclick="logout()">退出登录</button>
    </div>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('stats')">统计数据</button>
      <button class="tab" onclick="switchTab('shares')">分享链接</button>
      <button class="tab" id="usersTabBtn" onclick="switchTab('users')">授权用户</button>
      <button class="tab" id="settingsTabBtn" onclick="switchTab('settings')">系统设置</button>
    </div>

    <!-- Stats Tab -->
    <div id="statsTab" class="tab-content active">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" id="totalShares">0</div>
          <div class="stat-label">总分享链接数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="totalViews">0</div>
          <div class="stat-label">总浏览次数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="totalDownloads">0</div>
          <div class="stat-label">总下载次数</div>
        </div>
      </div>
    </div>

    <!-- Shares Tab -->
    <div id="sharesTab" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">分享链接管理</div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>文件名</th>
                <th>分享ID</th>
                <th>密码保护</th>
                <th>浏览次数</th>
                <th>下载次数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="sharesTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Users Tab -->
    <div id="usersTab" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">授权用户管理</div>
          <button class="btn btn-primary" onclick="showAddUserModal()">添加用户</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>邮箱</th>
                <th>角色</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="usersTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Settings Tab -->
    <div id="settingsTab" class="tab-content">
      <div class="card">
        <div class="card-header"><div class="card-title">全局设置</div></div>
        <div class="form-group" style="padding: 20px;">
          <label class="form-label" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
            <span>游客登录</span>
            <span style="display: flex; align-items: center; gap: 8px;">
              <span id="guestLoginLabel" style="font-size: 13px; color: var(--text-muted);">已开启</span>
              <label class="toggle-switch">
                <input type="checkbox" id="guestLoginToggle" onchange="toggleGuestLogin()" checked>
                <span class="toggle-slider"></span>
              </label>
            </span>
          </label>
          <p class="form-help">关闭后游客将无法登录和使用云盘</p>
        </div>
        <div class="form-group" style="padding: 0 20px 20px;">
          <label class="form-label">全局上传限制（MB）</label>
          <input type="number" id="globalMaxUpload" class="form-input" min="0" value="0" style="width: 200px;" placeholder="0 = 不限制">
          <p class="form-help">0 表示不限制，仅对未单独设置的用户生效</p>
        </div>

        <div style="padding: 0 20px 20px; border-top: 1px solid var(--border); margin-top: 8px;">
          <p style="font-weight: 600; font-size: 14px; margin-bottom: 12px; color: var(--text);">WebDAV 设置</p>
          <p class="form-help" style="margin-bottom: 14px;">开启后可通过 WebDAV 客户端（如 RaiDrive、Cyberduck）挂载为网络驱动器。连接地址：<code style="background:var(--surface-hover);padding:2px 6px;border-radius:4px;" id="webdavUrlDisplay">/dav/</code></p>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
              <span>启用 WebDAV</span>
              <span style="display: flex; align-items: center; gap: 8px;">
                <span id="webdavEnabledLabel" style="font-size: 13px; color: var(--text-muted);">已开启</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="webdavEnabledToggle" onchange="toggleWebdavEnabled()" checked>
                  <span class="toggle-slider"></span>
                </label>
              </span>
            </label>
            <p class="form-help">关闭后所有 WebDAV 请求将被拒绝</p>
          </div>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
              <span>只读模式</span>
              <span style="display: flex; align-items: center; gap: 8px;">
                <span id="webdavReadOnlyLabel" style="font-size: 13px; color: var(--text-muted);">已关闭</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="webdavReadOnlyToggle" onchange="toggleWebdavReadOnly()">
                  <span class="toggle-slider"></span>
                </label>
              </span>
            </label>
            <p class="form-help">只读模式下仅允许浏览和下载，禁止上传、删除、重命名等操作</p>
          </div>
          <div class="form-group">
            <label class="form-label">WebDAV 连接说明</label>
            <div style="background: var(--surface-hover); border-radius: var(--radius-sm); padding: 12px 16px; font-size: 12px; line-height: 1.8; color: var(--text-muted);">
              <p><strong>认证方式:</strong> Basic Auth</p>
              <p><strong>管理员:</strong> 用户名任意，密码为管理员密码</p>
              <p><strong>注册用户:</strong> 用户名为邮箱，密码为登录密码</p>
              <p><strong>游客:</strong> 用户名为 <code>guest</code></p>
              <p><strong>支持协议:</strong> WebDAV Class 1 &amp; 2</p>
              <p><strong>支持操作:</strong> 浏览、上传、下载、删除、重命名/移动、复制、创建文件夹</p>
            </div>
          </div>
        </div>

        <div style="padding: 0 20px 20px;">
          <button class="btn btn-primary" onclick="saveSettings()">保存设置</button>
          <span id="settingsMsg" style="margin-left: 12px; font-size: 13px;"></span>
        </div>
      </div>
    </div>

  <!-- Add User Modal -->
  <div class="modal-overlay" id="addUserModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">添加授权用户</div>
        <button class="modal-close" onclick="closeModal('addUserModal')">×</button>
      </div>
      <form onsubmit="addUser(event)">
        <div class="form-group">
          <label class="form-label">邮箱</label>
          <input type="email" id="newUserEmail" class="form-input" placeholder="请输入邮箱" required>
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <input type="text" id="newUserPassword" class="form-input" placeholder="请输入密码" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%;">添加用户</button>
      </form>
    </div>
  </div>

  <!-- User Permissions Modal -->
  <div class="modal-overlay" id="userPermsModal">
    <div class="modal" style="max-width: 500px;">
      <div class="modal-header">
        <div class="modal-title">用户权限设置 - <span id="permsUserEmail"></span></div>
        <button class="modal-close" onclick="closeModal('userPermsModal')">×</button>
      </div>
      <div class="form-group">
        <label class="form-label">角色</label>
        <select id="permsRole" class="form-input">
          <option value="user">普通用户</option>
          <option value="restricted">受限用户</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">上传限制（MB）</label>
        <input type="number" id="permsMaxUpload" class="form-input" min="0" value="0" placeholder="0 = 不限制">
        <p class="form-help" style="font-size: 12px;">0 表示不限制，或使用全局设置</p>
      </div>
      <div class="form-group">
        <label class="form-label">允许访问的文件夹</label>
        <input type="text" id="permsFolders" class="form-input" placeholder="多个文件夹用逗号分隔，留空=全部允许">
        <p class="form-help" style="font-size: 12px;">例如: myfiles, projects/work</p>
      </div>
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <span>允许 WebDAV 访问</span>
          <span style="display: flex; align-items: center; gap: 8px;">
            <span id="permsWebdavLabel" style="font-size: 13px; color: var(--text-muted);">已开启</span>
            <label class="toggle-switch">
              <input type="checkbox" id="permsWebdavToggle" onchange="togglePermsWebdav()" checked>
              <span class="toggle-slider"></span>
            </label>
          </span>
        </label>
        <p class="form-help" style="font-size: 12px;">关闭后该用户无法通过 WebDAV 客户端访问</p>
      </div>
      <div class="form-group">
        <label class="form-label" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <span>WebDAV 只读模式</span>
          <span style="display: flex; align-items: center; gap: 8px;">
            <span id="permsWebdavReadOnlyLabel" style="font-size: 13px; color: var(--text-muted);">已关闭</span>
            <label class="toggle-switch">
              <input type="checkbox" id="permsWebdavReadOnlyToggle" onchange="togglePermsWebdavReadOnly()">
              <span class="toggle-slider"></span>
            </label>
          </span>
        </label>
        <p class="form-help" style="font-size: 12px;">开启后该用户仅可浏览和下载，禁止上传、删除、重命名等操作</p>
      </div>
      <button class="btn btn-primary" onclick="saveUserPerms()" style="width: 100%;">保存权限</button>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <div class="loading-overlay" id="loadingOverlay" style="display: none;">
    <div class="spinner"></div>
  </div>

  <script>
    async function checkAdminAuth() {
      try {
        let role = null;
        if (window.__INIT__) {
          role = window.__INIT__.role;
        } else {
          const response = await fetch('/api/auth/check');
          const data = await response.json();
          if (!data.authenticated) {
            window.location.href = '/login.html';
            return;
          }
          role = data.role;
        }
        if (!role) {
          window.location.href = '/login.html';
          return;
        }
        if (role !== 'admin') {
          document.getElementById('usersTabBtn').style.display = 'none';
          document.getElementById('settingsTabBtn').style.display = 'none';
          if (document.getElementById('usersTab').classList.contains('active') ||
              document.getElementById('settingsTab') && document.getElementById('settingsTab').classList.contains('active')) {
            switchTab('stats');
          }
        }
      } catch (error) {
        if (!window.__INIT__) window.location.href = '/login.html';
      }
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      event.target.classList.add('active');
      document.getElementById(tab + 'Tab').classList.add('active');

      if (tab === 'stats') loadStats();
      else if (tab === 'shares') loadShares();
      else if (tab === 'users') loadUsers();
      else if (tab === 'settings') loadSettings();
    }

    async function loadStats() {
      try {
        const response = await fetch('/api/admin/stats');
        const data = await response.json();

        if (data.success) {
          document.getElementById('totalShares').textContent = data.totalShares;
          document.getElementById('totalViews').textContent = data.totalViews;
          document.getElementById('totalDownloads').textContent = data.totalDownloads;
        }
      } catch (error) {
        showToast('加载统计数据失败', 'error');
      }
    }

    async function loadShares() {
      showLoading(true);
      try {
        const response = await fetch('/api/admin/shares');
        const data = await response.json();

        if (data.success) {
          const tbody = document.getElementById('sharesTable');

          if (data.shares.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">暂无分享链接</td></tr>';
            return;
          }

          tbody.innerHTML = data.shares.map(share => \`
            <tr>
              <td>\${escapeHtml(share.fileName)}</td>
              <td><code>\${share.shareId}</code></td>
              <td>\${share.passwordHash ? '是' : '否'}</td>
              <td>\${share.viewCount}</td>
              <td>\${share.downloadCount}</td>
              <td>
                \${share.isExpired
                  ? '<span class="badge badge-error">已过期</span>'
                  : '<span class="badge badge-success">有效</span>'}
              </td>
              <td>
                <button class="btn btn-sm btn-secondary" onclick="copyShareLink('\${share.shareId}')">复制链接</button>
                <button class="btn btn-sm btn-danger" onclick="deleteShare('\${share.shareId}')">删除</button>
              </td>
            </tr>
          \`).join('');
        }
      } catch (error) {
        showToast('加载分享列表失败', 'error');
      } finally {
        showLoading(false);
      }
    }

    async function loadUsers() {
      showLoading(true);
      try {
        const response = await fetch('/api/admin/users');
        const data = await response.json();

        if (data.success) {
          const tbody = document.getElementById('usersTable');
          const guestUser = data.users.find(u => u.email === '__guest__');
          const normalUsers = data.users.filter(u => u.email !== '__guest__');

          let rowsHtml = '';
          
          if (guestUser) {
            rowsHtml += \`
              <tr>
                <td>👤 游客（公共访问）</td>
                <td><span class="badge badge-guest">游客 · \${guestUser.enabled ? '已启用' : '已禁用'}</span></td>
                <td>-</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="showUserPermsModal('__guest__')">权限</button>
                  <button class="btn btn-sm btn-secondary" onclick="switchTab('settings')">⚙ 开关</button>
                </td>
              </tr>
            \`;
          }

          if (normalUsers.length === 0) {
            rowsHtml += '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">暂无注册用户</td></tr>';
          } else {
            rowsHtml += normalUsers.map(user => \`
              <tr>
                <td>\${escapeHtml(user.email)}</td>
                <td>\${user.role === 'admin' ? '管理员' : '普通用户'}</td>
                <td>\${user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="showUserPermsModal('\${escapeHtml(user.email)}')">权限</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteUser('\${encodeURIComponent(user.email)}')">撤销授权</button>
                </td>
              </tr>
            \`).join('');
          }

          tbody.innerHTML = rowsHtml;
        }
      } catch (error) {
        showToast('加载用户列表失败', 'error');
      } finally {
        showLoading(false);
      }
    }

    function showAddUserModal() {
      document.getElementById('newUserEmail').value = '';
      document.getElementById('newUserPassword').value = '';
      document.getElementById('addUserModal').classList.add('active');
    }

    async function addUser(event) {
      event.preventDefault();
      const email = document.getElementById('newUserEmail').value;
      const password = document.getElementById('newUserPassword').value;
      closeModal('addUserModal');
      await apiCall('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }, '用户添加成功', loadUsers);
    }

    async function deleteUser(email) {
      if (!confirm('确定要撤销该用户的授权吗？')) return;
      await apiCall('/api/admin/users/' + email, { method: 'DELETE' }, '用户已删除', loadUsers);
    }

    async function deleteShare(shareId) {
      if (!confirm('确定要删除该分享链接吗？')) return;
      await apiCall('/api/admin/shares/' + shareId, { method: 'DELETE' }, '分享链接已删除', loadShares);
    }

    function copyShareLink(shareId) {
      const url = window.location.origin + '/s/' + shareId;
      navigator.clipboard.writeText(url).then(() => {
        showToast('链接已复制', 'success');
      }).catch(() => {
        showToast('复制失败', 'error');
      });
    }
    let _userPermsEmail = '';

    async function loadSettings() {
      try {
        const r = await fetch('/api/admin/settings');
        const d = await r.json();
        if (d.success && d.settings) {
          document.getElementById('guestLoginToggle').checked = d.settings.guestLogin !== false;
          document.getElementById('guestLoginLabel').textContent = d.settings.guestLogin !== false ? '已开启' : '已关闭';
          document.getElementById('globalMaxUpload').value = d.settings.maxUploadSize || 0;
          document.getElementById('webdavEnabledToggle').checked = d.settings.webdavEnabled !== false;
          document.getElementById('webdavEnabledLabel').textContent = d.settings.webdavEnabled !== false ? '已开启' : '已关闭';
          document.getElementById('webdavReadOnlyToggle').checked = !!d.settings.webdavReadOnly;
          document.getElementById('webdavReadOnlyLabel').textContent = d.settings.webdavReadOnly ? '已开启' : '已关闭';
          document.getElementById('webdavUrlDisplay').textContent = window.location.origin + '/dav/';
        }
      } catch (e) { showToast('加载设置失败', 'error'); }
    }

    function toggleGuestLogin() {
      const on = document.getElementById('guestLoginToggle').checked;
      document.getElementById('guestLoginLabel').textContent = on ? '已开启' : '已关闭';
    }
    function toggleWebdavEnabled() {
      const on = document.getElementById('webdavEnabledToggle').checked;
      document.getElementById('webdavEnabledLabel').textContent = on ? '已开启' : '已关闭';
    }
    function toggleWebdavReadOnly() {
      const on = document.getElementById('webdavReadOnlyToggle').checked;
      document.getElementById('webdavReadOnlyLabel').textContent = on ? '已开启' : '已关闭';
    }

    async function saveSettings() {
      const guestLogin = document.getElementById('guestLoginToggle').checked;
      const maxUploadSize = parseInt(document.getElementById('globalMaxUpload').value) || 0;
      const webdavEnabled = document.getElementById('webdavEnabledToggle').checked;
      const webdavReadOnly = document.getElementById('webdavReadOnlyToggle').checked;
      const msgEl = document.getElementById('settingsMsg');
      try {
        const r = await fetch('/api/admin/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestLogin, maxUploadSize, webdavEnabled, webdavReadOnly })
        });
        const d = await r.json();
        if (d.success) {
          msgEl.textContent = '设置已保存';
          msgEl.style.color = 'var(--success)';
        } else {
          msgEl.textContent = d.message || '保存失败';
          msgEl.style.color = 'var(--error)';
        }
      } catch (e) {
        msgEl.textContent = '网络错误';
        msgEl.style.color = 'var(--error)';
      }
      setTimeout(() => { msgEl.textContent = ''; }, 3000);
    }
    async function showUserPermsModal(email) {
      _userPermsEmail = email;
      const isGuest = email === '__guest__';
      document.getElementById('permsUserEmail').textContent = isGuest ? '游客' : email;
      const roleGroup = document.getElementById('permsRole').parentElement;
      roleGroup.style.display = isGuest ? 'none' : '';
      document.getElementById('permsRole').value = 'user';
      document.getElementById('permsMaxUpload').value = 0;
      document.getElementById('permsFolders').value = isGuest ? 'guest' : '';
      document.getElementById('permsWebdavToggle').checked = true;
      document.getElementById('permsWebdavLabel').textContent = '已开启';
      document.getElementById('permsWebdavReadOnlyToggle').checked = false;
      document.getElementById('permsWebdavReadOnlyLabel').textContent = '已关闭';
      try {
        const r = await fetch('/api/admin/users/' + encodeURIComponent(email) + '/settings');
        const d = await r.json();
        if (d.success && d.limits) {
          document.getElementById('permsRole').value = d.limits.role || 'user';
          document.getElementById('permsMaxUpload').value = d.limits.maxUploadSize || 0;
          const savedFolders = d.limits.allowedFolders;
          if (savedFolders && savedFolders.length > 0) {
            document.getElementById('permsFolders').value = savedFolders.join(', ');
          } else if (!isGuest) {
            document.getElementById('permsFolders').value = '';
          }
          const wdEnabled = d.limits.webdavEnabled !== false;
          document.getElementById('permsWebdavToggle').checked = wdEnabled;
          document.getElementById('permsWebdavLabel').textContent = wdEnabled ? '已开启' : '已关闭';
          const wdReadOnly = !!d.limits.webdavReadOnly;
          document.getElementById('permsWebdavReadOnlyToggle').checked = wdReadOnly;
          document.getElementById('permsWebdavReadOnlyLabel').textContent = wdReadOnly ? '已开启' : '已关闭';
        }
      } catch (e) {}
      document.getElementById('userPermsModal').classList.add('active');
    }

    async function saveUserPerms() {
      const isGuest = _userPermsEmail === '__guest__';
      const role = document.getElementById('permsRole').value;
      const maxUploadSize = parseInt(document.getElementById('permsMaxUpload').value) || 0;
      const foldersRaw = document.getElementById('permsFolders').value.trim();
      const allowedFolders = foldersRaw ? foldersRaw.split(',').map(f => f.trim()).filter(f => f.length > 0) : [];
      const webdavEnabled = document.getElementById('permsWebdavToggle').checked;
      const webdavReadOnly = document.getElementById('permsWebdavReadOnlyToggle').checked;

      const body = { maxUploadSize, allowedFolders, webdavEnabled, webdavReadOnly };
      if (!isGuest) body.role = role;

      await apiCall('/api/admin/users/' + encodeURIComponent(_userPermsEmail) + '/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, '用户权限已更新', () => { closeModal('userPermsModal'); loadUsers(); });
    }

    function togglePermsWebdav() {
      const on = document.getElementById('permsWebdavToggle').checked;
      document.getElementById('permsWebdavLabel').textContent = on ? '已开启' : '已关闭';
    }

    function togglePermsWebdavReadOnly() {
      const on = document.getElementById('permsWebdavReadOnlyToggle').checked;
      document.getElementById('permsWebdavReadOnlyLabel').textContent = on ? '已开启' : '已关闭';
    }

    ${SHARED_SCRIPTS}

    checkAdminAuth();
    loadStats();
  </script>
</body>
</html>
`;

const SHARE_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>文件分享</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()</script>
  ${CSS_STYLES}
</head>
<body>
  <div class="login-container">
    <button class="theme-toggle" onclick="toggleTheme()" title="切换主题" style="position:fixed;top:16px;right:16px;z-index:10;"></button>
    <div class="share-card" id="shareCard">
      <div id="loadingState">
        <div class="spinner" style="margin: 0 auto 20px;"></div>
        <div>加载中...</div>
      </div>

      <div id="expiredState" style="display: none;">
        <div class="share-icon">⚠️</div>
        <div class="share-expired">分享链接已过期或不存在</div>
        <p style="color: var(--text-muted); margin-top: 16px;">请联系分享者获取新的链接</p>
      </div>

      <div id="shareContent" style="display: none;">
        <div class="share-icon">📄</div>
        <div class="share-filename" id="fileName"></div>
        <div class="share-filesize" id="fileSize"></div>

        <div id="passwordForm" style="display: none;">
          <div class="form-group">
            <label class="form-label">请输入分享密码</label>
            <input type="password" id="sharePassword" class="form-input" placeholder="输入密码">
          </div>
        </div>

        <button class="btn btn-primary" style="width: 100%; margin-top: 20px;" onclick="downloadFile()">
          下载文件
        </button>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <script>
    let shareId = '';
    let requiresPassword = false;

    async function loadShareInfo() {
      
      const pathParts = window.location.pathname.split('/');
      shareId = pathParts[pathParts.length - 1];

      if (!shareId) {
        showExpired();
        return;
      }

      try {
        const response = await fetch('/api/share/' + shareId);
        const data = await response.json();

        if (!data.success) {
          showExpired();
          return;
        }

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('shareContent').style.display = 'block';

        document.getElementById('fileName').textContent = data.fileName;
        document.getElementById('fileSize').textContent = data.fileSizeFormatted;

        requiresPassword = data.requiresPassword;
        if (requiresPassword) {
          document.getElementById('passwordForm').style.display = 'block';
        }
      } catch (error) {
        showExpired();
      }
    }

    function showExpired() {
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('expiredState').style.display = 'block';
    }

    async function downloadFile() {
      const password = document.getElementById('sharePassword')?.value || '';

      if (requiresPassword && !password) {
        showToast('请输入分享密码', 'error');
        return;
      }

      try {
        const response = await fetch('/api/share/' + shareId + '/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        if (response.ok) {
          
          const contentDisposition = response.headers.get('Content-Disposition');
          let filename = 'download';
          if (contentDisposition) {
            const match = contentDisposition.match(/filename\\*?=(?:UTF-8'')?["']?([^"';\\n]+)/i);
            if (match) {
              filename = decodeURIComponent(match[1]);
            }
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showToast('下载开始', 'success');
        } else {
          const data = await response.json();
          showToast(data.message || '下载失败', 'error');
        }
      } catch (error) {
        showToast('下载失败: ' + error.message, 'error');
      }
    }

    ${SHARED_SCRIPTS}

    loadShareInfo();
  </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (path === '/favicon.ico' || path === '/robots.txt' || path === '/.well-known' || path.startsWith('/.well-known/')) {
      return new Response(null, { status: 404 });
    }

    try {
      if (path.startsWith('/dav')) {
        return await handleWebDAV(request, env);
      }

      if (path.startsWith('/api/')) {
        
        if (path === '/api/login' && method === 'POST') {
          return await handleLogin(request, env);
        }

        if (path === '/api/logout' && method === 'POST') {
          return await handleLogout();
        }

        if (path === '/api/auth/check') {
          return await handleCheckAuth(request, env);
        }

        if (path === '/api/files' && method === 'POST') {
          return await handleCreateFile(request, env);
        }

        if (path === '/api/folders' && method === 'POST') {
          return await handleCreateFolder(request, env);
        }

        if (path.startsWith('/api/files')) {
          const filePath = path.slice('/api/files'.length) || '/';

          if (method === 'GET') {
            return await handleListFiles(request, env, filePath);
          }
          if (method === 'POST') {
            return await handleUploadFile(request, env, filePath);
          }
          if (method === 'PUT') {
            return await handleRenameFile(request, env, filePath);
          }
          if (method === 'DELETE') {
            return await handleDeleteFile(request, env, filePath);
          }
        }

        if (path.startsWith('/api/download')) {
          return await serveFile(request, env, path.slice('/api/download'.length), { download: true });
        }

        if (path.startsWith('/api/preview')) {
          return await serveFile(request, env, path.slice('/api/preview'.length), { cache: true });
        }

        if (path.startsWith('/api/edit')) {
          return await handleEditFile(request, env, path.slice('/api/edit'.length));
        }

        if (path === '/api/share' && method === 'POST') {
          return await handleCreateShare(request, env);
        }

        if (path.match(/^\/api\/share\/[^/]+$/) && method === 'GET') {
          const shareId = path.split('/').pop();
          return await handleGetShareInfo(request, env, shareId);
        }

        if (path.match(/^\/api\/share\/[^/]+\/download$/) && method === 'POST') {
          const shareId = path.split('/')[3];
          return await handleShareDownload(request, env, shareId);
        }

        if (path === '/api/admin/stats' && method === 'GET') {
          return await handleGetStats(request, env);
        }

        if (path === '/api/admin/shares' && method === 'GET') {
          return await handleListShares(request, env);
        }

        if (path.match(/^\/api\/admin\/shares\/[^/]+$/) && method === 'DELETE') {
          const shareId = path.split('/').pop();
          return await handleDeleteShare(request, env, shareId);
        }

        if (path === '/api/admin/users' && method === 'GET') {
          return await handleListUsers(request, env);
        }

        if (path === '/api/admin/users' && method === 'POST') {
          return await handleCreateUser(request, env);
        }

        if (path.match(/^\/api\/admin\/users\/[^/]+$/) && method === 'DELETE') {
          const email = path.split('/').pop();
          return await handleDeleteUser(request, env, email);
        }

        if (path === '/api/admin/settings' && method === 'GET') {
          return await handleGetSettings(request, env);
        }

        if (path === '/api/admin/settings' && method === 'PUT') {
          return await handleUpdateSettings(request, env);
        }

        if (path.match(/^\/api\/admin\/users\/[^/]+\/settings$/) && method === 'GET') {
          const email = path.split('/')[4];
          return await handleGetUserSettings(request, env, decodeURIComponent(email));
        }

        if (path.match(/^\/api\/admin\/users\/[^/]+\/settings$/) && method === 'PUT') {
          const email = path.split('/')[4];
          return await handleUpdateUserSettings(request, env, decodeURIComponent(email));
        }

        if (path === '/api/search' && method === 'GET') {
          return await handleSearchFiles(request, env);
        }

        if (path === '/api/favorites' && method === 'GET') {
          return await handleGetFavorites(request, env);
        }
        if (path === '/api/favorites' && method === 'POST') {
          return await handleAddFavorite(request, env);
        }
        if (path === '/api/favorites' && method === 'DELETE') {
          return await handleRemoveFavorite(request, env);
        }
        if (path === '/api/favorites/order' && method === 'PUT') {
          return await handleReorderFavorites(request, env);
        }

        return jsonResponse({ success: false, message: 'API 路径不存在' }, 404);
      }

      if (path.startsWith('/s/')) {
        return htmlResponse(SHARE_PAGE);
      }

      if (path === '/login.html' || path === '/login') {
        return htmlResponse(LOGIN_PAGE);
      }

      if (path === '/admin.html' || path === '/admin') {
        const auth = await verifyAuth(request, env);
        if (!auth) {
          return Response.redirect(url.origin + '/login.html', 302);
        }
        const initJson = JSON.stringify({ role: auth.role, email: auth.email || null });
        return htmlResponse(ADMIN_PAGE.replace('</head>', `<script>window.__INIT__=${initJson};</script></head>`));
      }

      if (path === '/' || path === '/index.html') {
        const auth = await verifyAuth(request, env);
        if (!auth) {
          return Response.redirect(url.origin + '/login.html', 302);
        }
        const favKey = getFavoritesKey(auth);
        const favRaw = await env.KV_STORE.get(favKey);
        const favorites = favRaw ? JSON.parse(favRaw) : [];
        const initData = {
          role: auth.role,
          email: auth.email || null,
          favorites: favorites || []
        };
        if (auth.role === 'guest') {
          const limits = await getUserLimits(env, '__guest__');
          const allowedFolders = (limits && limits.allowedFolders && limits.allowedFolders.length > 0)
            ? limits.allowedFolders
            : ['guest'];
          initData.guestRoot = allowedFolders[0];
        }
        const initJson = JSON.stringify(initData);
        return htmlResponse(INDEX_PAGE.replace('</head>', `<script>window.__INIT__=${initJson};</script></head>`));
      }

      return Response.redirect(url.origin + '/', 302);

    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ success: false, message: '服务器错误: ' + error.message }, 500);
    }
  }
};