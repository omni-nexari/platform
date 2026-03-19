import { apiFetch } from './client.js';

export interface ScheduleResponse {
  schedules: unknown[];
}

export async function fetchSchedule(): Promise<ScheduleResponse> {
  const res = await apiFetch('/devices/device/schedule');
  if (!res.ok) throw new Error(`schedule fetch failed: ${res.status}`);
  return res.json() as Promise<ScheduleResponse>;
}

export interface WorkspaceResponse {
  workspace: {
    id: string;
    name: string;
    timezone: string;
    defaultPlaylistId: string | null;
    logoUrl: string | null;
  };
  defaultPlaylist: unknown | null;
}

export async function fetchWorkspace(): Promise<WorkspaceResponse> {
  const res = await apiFetch('/devices/device/workspace');
  if (!res.ok) throw new Error(`workspace fetch failed: ${res.status}`);
  return res.json() as Promise<WorkspaceResponse>;
}

export interface EmergencyResponse {
  emergency: {
    id: string;
    contentType: 'text' | 'media';
    contentText: string | null;
    contentItemId: string | null;
  } | null;
}

export async function fetchEmergency(): Promise<EmergencyResponse> {
  const res = await apiFetch('/devices/device/emergency');
  if (!res.ok) throw new Error(`emergency fetch failed: ${res.status}`);
  return res.json() as Promise<EmergencyResponse>;
}
