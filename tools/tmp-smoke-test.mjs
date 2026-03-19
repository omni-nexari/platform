const base = 'http://0.0.0.0:3000';
const unique = `smoke-${Date.now()}`;
const results = [];
const wsMessages = [];
let ws;

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(`${base}${path}`, { ...options, headers });
  const text = await res.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: res.status, ok: res.ok, data, text };
}

function ok(name, details) {
  results.push({ name, status: 'ok', details });
}

function fail(name, details) {
  results.push({ name, status: 'fail', details });
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const health = await request('/health');
  if (!health.ok) {
    throw new Error(`health failed: ${health.status} ${health.text}`);
  }
  ok('health', health.data);

  const saLogin = await request('/superadmin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@admin.com', password: 'q1w2e3r4' }),
  });
  if (!saLogin.ok) {
    throw new Error(`superadmin login failed: ${saLogin.status} ${saLogin.text}`);
  }
  const saToken = saLogin.data.accessToken;
  ok('superadmin_login', { user: saLogin.data.user?.email });

  const orgs = await request('/superadmin/orgs', { headers: auth(saToken) });
  if (!orgs.ok) {
    throw new Error(`org list failed: ${orgs.status} ${orgs.text}`);
  }
  const org = orgs.data.find((item) => item.slug === 'acme') || orgs.data[0];
  if (!org) {
    throw new Error('no org found');
  }
  ok('superadmin_org_list', { orgId: org.id, slug: org.slug });

  const impersonate = await request(`/superadmin/orgs/${org.id}/impersonate`, {
    method: 'POST',
    headers: auth(saToken),
  });
  if (!impersonate.ok) {
    throw new Error(`impersonation failed: ${impersonate.status} ${impersonate.text}`);
  }
  const impersonationToken = impersonate.data.accessToken;
  ok('impersonation_issue_token', {
    impersonatedUser: impersonate.data.user?.email,
    org: impersonate.data.org?.slug,
  });

  const meViaImpersonation = await request('/auth/me', {
    headers: auth(impersonationToken),
  });
  if (!meViaImpersonation.ok) {
    throw new Error(`impersonated /auth/me failed: ${meViaImpersonation.status} ${meViaImpersonation.text}`);
  }
  ok('impersonation_auth_me', {
    user: meViaImpersonation.data.user?.email,
    org: meViaImpersonation.data.org?.slug,
  });

  const userLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'owner@acme.local', password: 'Test@1234!' }),
  });
  if (!userLogin.ok) {
    throw new Error(`owner login failed: ${userLogin.status} ${userLogin.text}`);
  }
  const userToken = userLogin.data.accessToken;
  ok('owner_login', { user: userLogin.data.user?.email });

  const workspaces = await request('/workspaces', { headers: auth(userToken) });
  if (!workspaces.ok) {
    throw new Error(`workspace list failed: ${workspaces.status} ${workspaces.text}`);
  }
  const workspace = workspaces.data[0];
  if (!workspace) {
    throw new Error('no workspace found');
  }
  ok('workspace_list', { workspaceId: workspace.id, name: workspace.name });

  const categoryRes = await request('/tags/categories', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({
      workspaceId: workspace.id,
      name: `${unique}-category`,
      color: '#228be6',
      availableFor: ['device', 'content', 'playlist', 'schedule'],
    }),
  });
  if (!categoryRes.ok) {
    throw new Error(`tag category create failed: ${categoryRes.status} ${categoryRes.text}`);
  }
  const categoryId = categoryRes.data.id;

  const tagRes = await request(`/tags/categories/${categoryId}/tags`, {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({ name: `${unique}-tag`, color: '#15aabf' }),
  });
  if (!tagRes.ok) {
    throw new Error(`tag create failed: ${tagRes.status} ${tagRes.text}`);
  }
  const tagId = tagRes.data.id;
  ok('tag_setup', { categoryId, tagId });

  const contentRes = await request('/content/web-url', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({
      workspaceId: workspace.id,
      name: `${unique}-content`,
      webUrl: 'https://example.com',
      refreshInterval: 300,
    }),
  });
  if (!contentRes.ok) {
    throw new Error(`content create failed: ${contentRes.status} ${contentRes.text}`);
  }
  const contentId = contentRes.data.id;
  ok('content_create', { contentId, name: contentRes.data.name });

  const playlistRes = await request('/playlists', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({
      workspaceId: workspace.id,
      name: `${unique}-playlist`,
      description: 'smoke test playlist',
      loop: true,
    }),
  });
  if (!playlistRes.ok) {
    throw new Error(`playlist create failed: ${playlistRes.status} ${playlistRes.text}`);
  }
  const playlistId = playlistRes.data.id;
  ok('playlist_create', { playlistId, name: playlistRes.data.name });

  const scheduleRes = await request('/schedules', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({
      workspaceId: workspace.id,
      name: `${unique}-schedule`,
      description: 'smoke test schedule',
    }),
  });
  if (!scheduleRes.ok) {
    throw new Error(`schedule create failed: ${scheduleRes.status} ${scheduleRes.text}`);
  }
  const scheduleId = scheduleRes.data.id;
  ok('schedule_create', { scheduleId, name: scheduleRes.data.name });

  const pairOld = await request('/devices/pair/request', {
    method: 'POST',
    body: JSON.stringify({ duid: `${unique}-old`, modelName: 'SmokePanel' }),
  });
  if (!pairOld.ok) {
    throw new Error(`pair request old failed: ${pairOld.status} ${pairOld.text}`);
  }
  const oldCode = pairOld.data.code;

  const claimOld = await request('/devices/pair/claim', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({
      code: oldCode,
      workspaceId: workspace.id,
      name: `${unique}-device-old`,
    }),
  });
  if (!claimOld.ok) {
    throw new Error(`claim old device failed: ${claimOld.status} ${claimOld.text}`);
  }
  const oldDeviceId = claimOld.data.device.id;
  ok('device_claim_old', { oldDeviceId, code: oldCode });

  const pairStatus = await request(`/devices/pair/status?code=${encodeURIComponent(oldCode)}`);
  if (!pairStatus.ok || pairStatus.data.status !== 'claimed') {
    throw new Error(`pair status failed: ${pairStatus.status} ${pairStatus.text}`);
  }
  const oldDeviceToken = pairStatus.data.deviceToken;
  ok('device_pair_status_claimed', { oldDeviceId });

  ws = new WebSocket(`ws://0.0.0.0:3000/devices/ws/device?token=${encodeURIComponent(oldDeviceToken)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('device websocket open timeout')), 10000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener('message', (event) => {
      try {
        wsMessages.push(JSON.parse(event.data));
      } catch {
        wsMessages.push(event.data);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('device websocket error'));
    }, { once: true });
  });
  ok('device_ws_connect', { oldDeviceId });

  const zones = [
    {
      id: 'main',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      playlistId,
    },
  ];

  const patchZones = await request(`/devices/${oldDeviceId}`, {
    method: 'PATCH',
    headers: auth(userToken),
    body: JSON.stringify({ zones }),
  });
  if (!patchZones.ok) {
    throw new Error(`device patch zones failed: ${patchZones.status} ${patchZones.text}`);
  }
  ok('zone_save_patch', {
    zoneCount: Array.isArray(patchZones.data.zones) ? patchZones.data.zones.length : 0,
  });

  const pushZones = await request(`/devices/${oldDeviceId}/command`, {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({ command: 'set_zones', payload: { zones } }),
  });
  if (!pushZones.ok) {
    throw new Error(`zone push command failed: ${pushZones.status} ${pushZones.text}`);
  }
  await sleep(1000);
  const zoneCommandSeen = wsMessages.some((msg) => msg && msg.type === 'set_zones');
  if (!zoneCommandSeen) {
    throw new Error(`device websocket did not receive set_zones command: ${JSON.stringify(wsMessages)}`);
  }
  ok('zone_push_ws', { received: zoneCommandSeen });

  const bulkRequests = await Promise.all([
    request('/tags/bulk-assign', {
      method: 'POST',
      headers: auth(userToken),
      body: JSON.stringify({ workspaceId: workspace.id, entityType: 'content', entityIds: [contentId], tagIds: [tagId] }),
    }),
    request('/tags/bulk-assign', {
      method: 'POST',
      headers: auth(userToken),
      body: JSON.stringify({ workspaceId: workspace.id, entityType: 'playlist', entityIds: [playlistId], tagIds: [tagId] }),
    }),
    request('/tags/bulk-assign', {
      method: 'POST',
      headers: auth(userToken),
      body: JSON.stringify({ workspaceId: workspace.id, entityType: 'schedule', entityIds: [scheduleId], tagIds: [tagId] }),
    }),
    request('/tags/bulk-assign', {
      method: 'POST',
      headers: auth(userToken),
      body: JSON.stringify({ workspaceId: workspace.id, entityType: 'device', entityIds: [oldDeviceId], tagIds: [tagId] }),
    }),
  ]);
  if (!bulkRequests.every((response) => response.ok)) {
    throw new Error(`bulk assign failed: ${JSON.stringify(bulkRequests.map((response) => ({ status: response.status, data: response.data })))}`);
  }

  const assignmentChecks = await Promise.all([
    request(`/tags/assignments?workspaceId=${workspace.id}&entityId=${contentId}&entityType=content`, { headers: auth(userToken) }),
    request(`/tags/assignments?workspaceId=${workspace.id}&entityId=${playlistId}&entityType=playlist`, { headers: auth(userToken) }),
    request(`/tags/assignments?workspaceId=${workspace.id}&entityId=${scheduleId}&entityType=schedule`, { headers: auth(userToken) }),
    request(`/tags/assignments?workspaceId=${workspace.id}&entityId=${oldDeviceId}&entityType=device`, { headers: auth(userToken) }),
  ]);
  if (!assignmentChecks.every((response) => response.ok && Array.isArray(response.data) && response.data.includes(tagId))) {
    throw new Error(`assignment verification failed: ${JSON.stringify(assignmentChecks.map((response) => ({ status: response.status, data: response.data })))}`);
  }
  ok('bulk_tag_assign', { tagId });

  const folderCreate = await request('/content/folders', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({ workspaceId: workspace.id, name: `${unique}-folder-a` }),
  });
  if (!folderCreate.ok) {
    throw new Error(`folder create failed: ${folderCreate.status} ${folderCreate.text}`);
  }
  const folderId = folderCreate.data.id;

  const folderRename = await request(`/content/folders/${folderId}`, {
    method: 'PATCH',
    headers: auth(userToken),
    body: JSON.stringify({ name: `${unique}-folder-renamed` }),
  });
  if (!folderRename.ok) {
    throw new Error(`folder rename failed: ${folderRename.status} ${folderRename.text}`);
  }

  const moveIntoFolder = await request('/content/move-to-folder', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({ workspaceId: workspace.id, contentIds: [contentId], folderId }),
  });
  if (!moveIntoFolder.ok) {
    throw new Error(`move to folder failed: ${moveIntoFolder.status} ${moveIntoFolder.text}`);
  }

  const folderFiltered = await request(`/content?workspaceId=${workspace.id}&folderId=${folderId}`, {
    headers: auth(userToken),
  });
  if (!folderFiltered.ok || !folderFiltered.data.items.some((item) => item.id === contentId)) {
    throw new Error(`folder filter failed: ${folderFiltered.status} ${JSON.stringify(folderFiltered.data)}`);
  }

  const moveBackRoot = await request('/content/move-to-folder', {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({ workspaceId: workspace.id, contentIds: [contentId], folderId: null }),
  });
  if (!moveBackRoot.ok) {
    throw new Error(`move back to root failed: ${moveBackRoot.status} ${moveBackRoot.text}`);
  }

  const folderDelete = await request(`/content/folders/${folderId}`, {
    method: 'DELETE',
    headers: auth(userToken),
  });
  if (!folderDelete.ok) {
    throw new Error(`folder delete failed: ${folderDelete.status} ${folderDelete.text}`);
  }
  ok('content_folders_flow', { folderId });

  const searchRes = await request(`/search?q=${encodeURIComponent(unique)}&workspaceId=${workspace.id}`, {
    headers: auth(userToken),
  });
  if (!searchRes.ok) {
    throw new Error(`search failed: ${searchRes.status} ${searchRes.text}`);
  }
  const foundContent = searchRes.data.content?.some((item) => item.id === contentId);
  const foundPlaylists = searchRes.data.playlists?.some((item) => item.id === playlistId);
  const foundSchedules = searchRes.data.schedules?.some((item) => item.id === scheduleId);
  const foundDevices = searchRes.data.devices?.some((item) => item.id === oldDeviceId);
  if (!(foundContent && foundPlaylists && foundSchedules && foundDevices)) {
    throw new Error(`search results incomplete: ${JSON.stringify(searchRes.data)}`);
  }
  ok('workspace_search_api', { foundContent, foundPlaylists, foundSchedules, foundDevices });

  const pairNew = await request('/devices/pair/request', {
    method: 'POST',
    body: JSON.stringify({ duid: `${unique}-new`, modelName: 'SmokePanel2' }),
  });
  if (!pairNew.ok) {
    throw new Error(`pair request new failed: ${pairNew.status} ${pairNew.text}`);
  }
  const newCode = pairNew.data.code;

  const replacement = await request(`/devices/${oldDeviceId}/replace`, {
    method: 'POST',
    headers: auth(userToken),
    body: JSON.stringify({ newDeviceCode: newCode }),
  });
  if (!replacement.ok) {
    fail('device_replacement', { status: replacement.status, response: replacement.data });
  } else {
    ok('device_replacement', {
      replacedDeviceId: replacement.data.replacedDeviceId,
      newDeviceId: replacement.data.device?.id,
    });
  }

  if (ws) {
    ws.close();
  }

  console.log(JSON.stringify({ unique, results }, null, 2));
  if (results.some((entry) => entry.status === 'fail')) {
    process.exit(2);
  }
}

main().catch((error) => {
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  console.error(JSON.stringify({ unique, results, fatal: String(error?.stack || error) }, null, 2));
  process.exit(1);
});