const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NTkwNTIzNS01MWI0LTQ4ODctOTcwNy1kMDc5NmViMjg3YmQiLCJ0eXBlIjoiZGV2aWNlIiwib3JnSWQiOiI1ZmIwZDU5OS1lMmNkLTQ2NWUtYjFjZS1jMmFkNDI4MDJlY2UiLCJ3b3Jrc3BhY2VJZCI6IjNlM2JhYTU0LTMzZTQtNGEyYi04ODM1LTM2Y2VlNTY4M2VhZCIsImlhdCI6MTc3NDEyNDg5OCwiZXhwIjoyMDg5NDg0ODk4fQ.fSa7mIXcJJirAbuwYs8SqyuGwdFDlEFQu5slnZxcDyo';
const headers = { Authorization: `Bearer ${token}` };

const workspaceRes = await fetch('http://127.0.0.1:3000/api/v1/devices/device/workspace', { headers });
const scheduleRes = await fetch('http://127.0.0.1:3000/api/v1/devices/device/schedule', { headers });
const workspace = await workspaceRes.json();
const schedule = await scheduleRes.json();

console.log(JSON.stringify({
  workspaceStatus: workspaceRes.status,
  scheduleStatus: scheduleRes.status,
  publishedContent: workspace.publishedContent ? {
    id: workspace.publishedContent.id,
    name: workspace.publishedContent.name,
    type: workspace.publishedContent.type,
    filePath: workspace.publishedContent.filePath,
    webUrl: workspace.publishedContent.webUrl,
  } : null,
  publishedPlaylist: workspace.publishedPlaylist ? {
    id: workspace.publishedPlaylist.id,
    items: workspace.publishedPlaylist.items?.length ?? 0,
  } : null,
  publishedSchedule: workspace.publishedSchedule ? {
    id: workspace.publishedSchedule.id,
    slots: workspace.publishedSchedule.slots?.length ?? 0,
  } : null,
  defaultPlaylistItems: workspace.defaultPlaylist?.items?.length ?? 0,
  scheduleCount: schedule.schedules?.length ?? 0,
}, null, 2));
