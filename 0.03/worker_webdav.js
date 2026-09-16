/**
 * name = "mycloud-single"
 * WebDAV-only 精简版 —— 只保留 WebDAV 功能，无 UI
 *
 * 认证方式：HTTP Basic Auth（用户在 WebDAV 客户端中输入密码）
 * WebDAV 端点：/dav/
 *
 * [[r2_buckets]]
 * binding = "R2_BUCKET"
 * bucket_name = "你的R2桶名"
 *
 * [vars]
 * ADMIN_PASSWORD = "你的管理员密码"
 */

// --- 工具函数 ---

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

function normalizePath(p) {
  if (!p) return '';
  if (p.startsWith('/')) p = p.slice(1);
  return p;
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
  await env.R2_BUCKET.delete(key);
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

async function verifyDavAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const decoded = atob(authHeader.slice(6));
    const colon = decoded.indexOf(':');
    const pass = decoded.slice(colon + 1);
    if (pass !== env.ADMIN_PASSWORD) return null;
    return { role: 'admin' };
  } catch {
    return null;
  }
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
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, 'xml');

  try {
    const depth = request.headers.get('Depth') || 'infinity';
    const baseUrl = new URL(request.url).origin + '/dav/';
    const fileObj = davPath ? await env.R2_BUCKET.get(davPath) : null;
    if (fileObj) {
      const name = davPath.split('/').pop();
      const mtime = fileObj.uploaded || new Date();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${xmlEscape(baseUrl + davPath)}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(name)}</d:displayname>
        <d:resourcetype/>
        <d:getlastmodified>${rfc1123Date(mtime)}</d:getlastmodified>
        <d:getcontentlength>${fileObj.size || 0}</d:getcontentlength>
        <d:getetag>"${fileObj.etag || ''}"</d:getetag>
        <d:getcontenttype>${xmlEscape(fileObj.httpMetadata?.contentType || 'application/octet-stream')}</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
    }
    const prefix = davPath ? davPath + '/' : '';
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
          const folderName = dp.replace(prefix, '').replace(/\/$/, '');
          if (folderName) folders.add(folderName);
        }
      }
      cursor = batch.truncated ? batch.cursor : null;
    } while (cursor);

    let xml = '<d:multistatus xmlns:d="DAV:">\n';
    if (depth !== '1') {
      xml += `  <d:response>
    <d:href>${xmlEscape(baseUrl + (davPath ? davPath + '/' : ''))}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(davPath ? davPath.split('/').pop() : '/')}</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>${rfc1123Date(new Date())}</d:getlastmodified>
        <d:getcontentlength>0</d:getcontentlength>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
    }

    if (depth === '0') {
      xml += '</d:multistatus>';
      return davXmlResponse(xml);
    }
    for (const folderName of folders) {
      const folderPath = (davPath ? davPath + '/' : '') + folderName;
      xml += `  <d:response>
    <d:href>${xmlEscape(baseUrl + folderPath + '/')}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(folderName)}</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>${rfc1123Date(new Date())}</d:getlastmodified>
        <d:getcontentlength>0</d:getcontentlength>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
    }
    for (const obj of objects) {
      const objPath = obj.key;
      const name = objPath.split('/').pop();
      const mtime = obj.uploaded || new Date();
      xml += `  <d:response>
    <d:href>${xmlEscape(baseUrl + objPath)}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(name)}</d:displayname>
        <d:resourcetype/>
        <d:getlastmodified>${rfc1123Date(mtime)}</d:getlastmodified>
        <d:getcontentlength>${obj.size || 0}</d:getcontentlength>
        <d:getetag>"${obj.etag || ''}"</d:getetag>
        <d:getcontenttype>${xmlEscape(obj.httpMetadata?.contentType || 'application/octet-stream')}</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
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
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) {
      const list = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
      if (list.objects?.length > 0 || list.delimitedPrefixes?.length > 0) {
        return handleDavPropfind(request, env, davPath);
      }
      return new Response('Not Found', { status: 404 });
    }

    const filename = key.split('/').pop();
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || getMimeType(filename),
        'Content-Length': obj.size,
        'ETag': obj.etag ? `"${obj.etag}"` : '',
        'Last-Modified': rfc1123Date(obj.uploaded),
      }
    });
  } catch (e) {
    return new Response('Internal Server Error: ' + e.message, { status: 500 });
  }
}

async function handleDavHead(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) {
      const list = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
      if (list.objects?.length > 0 || list.delimitedPrefixes?.length > 0) {
        return new Response(null, { status: 200, headers: { 'Content-Type': 'httpd/unix-directory' } });
      }
      return new Response(null, { status: 404 });
    }

    const filename = key.split('/').pop();
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || getMimeType(filename),
        'Content-Length': obj.size,
        'ETag': obj.etag ? `"${obj.etag}"` : '',
        'Last-Modified': rfc1123Date(obj.uploaded),
      }
    });
  } catch (e) {
    return new Response(null, { status: 500 });
  }
}

async function handleDavPut(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const overwrite = request.headers.get('Overwrite') !== 'F';
    const folderCheck = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
    if (folderCheck.objects?.length > 0 || folderCheck.delimitedPrefixes?.length > 0) {
      return new Response('Target is a collection', { status: 405 });
    }

    if (!overwrite) {
      const existing = await env.R2_BUCKET.get(key);
      if (existing) return new Response(null, { status: 412 });
    }

    const contentType = request.headers.get('Content-Type') || getMimeType(key) || 'application/octet-stream';
    await env.R2_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('Upload failed: ' + e.message, { status: 500 });
  }
}

async function handleDavDelete(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    await deleteR2Folder(env, davPath);
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response('Delete failed: ' + e.message, { status: 500 });
  }
}

async function handleDavMkcol(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const existing = await env.R2_BUCKET.get(key);
    if (existing) {
      return new Response(null, { status: 405, headers: { 'Allow': 'GET,OPTIONS,PROPFIND' } });
    }

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
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    const { srcKey, dstKey } = parsed;

    const overwrite = request.headers.get('Overwrite') !== 'F';

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

    if (!overwrite) {
      const destExists = await env.R2_BUCKET.get(dstKey);
      if (destExists) return new Response(null, { status: 412 });
    }
    await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
    await env.R2_BUCKET.delete(srcKey);
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MOVE failed: ' + e.message, { status: 500 });
  }
}

async function handleDavCopy(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    const { srcKey, dstKey } = parsed;

    const overwrite = request.headers.get('Overwrite') !== 'F';
    const depth = request.headers.get('Depth') || 'infinity';

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (srcObj) {
      if (!overwrite) {
        const destExists = await env.R2_BUCKET.get(dstKey);
        if (destExists) return new Response(null, { status: 412 });
      }
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      return new Response(null, { status: 201 });
    }

    const srcList = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
    if (srcList.objects?.length > 0 || srcList.delimitedPrefixes?.length > 0) {
      if (depth === '0') {
        await env.R2_BUCKET.put(dstKey + '/.keep', '', { httpMetadata: { contentType: 'text/plain' } });
        return new Response(null, { status: 201 });
      }
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const method = request.method;
    if (method === 'OPTIONS' && path.startsWith('/dav')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, OPTIONS, HEAD, LOCK, UNLOCK',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, Destination, Overwrite, Range',
        }
      });
    }

    try {
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
