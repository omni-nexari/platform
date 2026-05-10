/**
 * datasync.ts — DataSync live transport schedule renderer for player-web.
 *
 * Ported from apps/nexari-tizen/src/modules/datasync-renderer.ts.
 * Namespace removed; now exports standalone functions.
 */

export interface DataSyncHandle { destroy(): void; handleWsMessage(msg: unknown): void; }

interface DSCell {
  id: string; trainId: string; stationId: string;
  value: string | null; note: string | null;
  status: string; delayMins: number | null;
}
interface DSTrain   { id: string; number: string; days?: string | null; status?: string; }
interface DSStation { id: string; name: string; tag?: string | null; section?: string | null; type: string; position: number; }
interface DSTableData { title?: string; subtitle?: string; trains: DSTrain[]; stations: DSStation[]; cells: DSCell[]; }
interface CellUpdateEvent { trainId: string; stationId: string; field: string; value: unknown; }

const RECONNECT_BASE   = 2_000;
const MAX_RECONNECTS   = 5;

function escHtml(s: unknown): string {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function findCell(cells: DSCell[], trainId: string, stationId: string): DSCell | undefined {
  return cells.find(c => c.trainId===trainId && c.stationId===stationId);
}

function renderCellContent(td: HTMLTableCellElement, cell: DSCell): void {
  const status = (cell.status||'normal').toLowerCase();
  td.dataset['status'] = status;
  td.classList.remove('ds-cell-empty');
  let html = `<span class="ds-time">${escHtml(cell.value||'–')}</span>`;
  if (cell.note) html += `<sup class="ds-note">${escHtml(cell.note)}</sup>`;
  if (status==='delayed' && cell.delayMins) html += `<span class="ds-delay">+${cell.delayMins}'</span>`;
  td.innerHTML = html;
}

const DS_STYLES = `
<style>
.ds-wrapper{display:flex;flex-direction:column;height:100%;background:#0a0e1a;color:#e2e8f0;font-family:'Segoe UI',Arial,sans-serif;overflow:hidden;}
.ds-title-bar{display:flex;align-items:baseline;justify-content:space-between;padding:16px 24px;background:#111827;border-bottom:2px solid #1e3a5f;flex-shrink:0;}
.ds-title{font-size:22px;font-weight:700;letter-spacing:0.5px;color:#93c5fd;}
.ds-subtitle{font-size:13px;color:#64748b;margin-left:16px;}
.ds-table{width:100%;border-collapse:collapse;font-size:15px;}
.ds-table thead th{background:#111827;color:#93c5fd;padding:10px 14px;text-align:center;font-weight:600;border-bottom:2px solid #1e3a5f;position:sticky;top:0;z-index:2;}
.ds-col-station{text-align:left!important;min-width:160px;}
.ds-train-number{display:block;font-size:16px;font-weight:700;}
.ds-train-days{display:block;font-size:11px;color:#64748b;margin-top:2px;}
.ds-train-delay{font-size:11px;color:#f59e0b;margin-top:2px;display:block;}
th[data-status="cancelled"]{opacity:0.5;text-decoration:line-through;}
th[data-status="delayed"]{color:#f59e0b!important;}
.ds-table tbody tr:nth-child(even){background:rgba(255,255,255,0.03);}
.ds-table tbody tr:hover{background:rgba(30,58,95,0.4);}
.ds-section-row .ds-section-header{background:#1e3a5f;color:#93c5fd;padding:6px 14px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
.ds-station-name{padding:10px 14px;color:#cbd5e1;font-weight:500;}
.ds-cell{padding:8px 14px;text-align:center;color:#e2e8f0;}
.ds-cell-empty{color:#374151;}
td[data-status="delayed"]{background:rgba(245,158,11,0.08);}
td[data-status="cancelled"]{opacity:0.5;}
td[data-status="departed"]{color:#4ade80;}
.ds-time{font-variant-numeric:tabular-nums;}
.ds-note{color:#60a5fa;font-size:10px;margin-left:2px;}
.ds-delay{display:block;font-size:11px;color:#f59e0b;margin-top:1px;}
.ds-footer{padding:8px 24px;font-size:11px;color:#374151;border-top:1px solid #1e3a5f;flex-shrink:0;}
</style>`;

export function renderDataSync(
  container: HTMLElement,
  contentId: string,
  apiBase: string,
  deviceId: string,
): DataSyncHandle {
  let ws: WebSocket | null = null;
  let intentionalDisconnect = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  const wsBase = apiBase.replace(/^http/, 'ws').replace(/\/api\/v1$/, '');

  const clearPing = () => { if (pingInterval) { clearInterval(pingInterval); pingInterval=null; } };
  const cancelReconnect = () => { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer=null; } clearPing(); };

  const updateFooter = () => {
    const footer = container.querySelector<HTMLElement>('#ds-footer');
    if (footer) footer.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  };

  const patchCell = (data: CellUpdateEvent) => {
    const td = container.querySelector<HTMLTableCellElement>(`td[data-train="${data.trainId}"][data-station="${data.stationId}"]`);
    if (!td) return;
    switch (data.field) {
      case 'value':     td.dataset['value']      = String(data.value??''); break;
      case 'note':      td.dataset['note']        = String(data.value??''); break;
      case 'status':    td.dataset['cellStatus']  = String(data.value??'normal'); break;
      case 'delayMins': td.dataset['delayMins']   = data.value!=null ? String(data.value) : ''; break;
    }
    const cell: DSCell = {
      id:'', trainId:data.trainId, stationId:data.stationId,
      value:td.dataset['value']||null, note:td.dataset['note']||null,
      status:td.dataset['cellStatus']||'normal',
      delayMins:td.dataset['delayMins'] ? parseInt(td.dataset['delayMins']!, 10) : null,
    };
    renderCellContent(td, cell);
    updateFooter();
  };

  const applyTrainStatus = (data: { trainId: string; status: string; delayMins?: number | null }) => {
    const status = (data.status||'normal').toLowerCase();
    const th = container.querySelector<HTMLElement>(`th[data-train-id="${data.trainId}"]`);
    if (th) {
      th.dataset['status'] = status;
      let delaySpan = th.querySelector<HTMLElement>('.ds-train-delay');
      if (status==='delayed'&&data.delayMins) {
        if (!delaySpan) { delaySpan=document.createElement('span'); delaySpan.className='ds-train-delay'; th.appendChild(delaySpan); }
        delaySpan.textContent = `+${data.delayMins}'`;
      } else if (delaySpan) delaySpan.remove();
    }
    const dataCells = container.querySelectorAll<HTMLTableCellElement>(`td[data-train="${data.trainId}"]`);
    dataCells.forEach(td => {
      if (td.classList.contains('ds-cell-empty')) return;
      td.dataset['status'] = status==='normal' ? (td.dataset['cellStatus']||'normal') : status;
    });
  };

  const handleWsMsg = (msg: Record<string, unknown>) => {
    switch (msg['event']) {
      case 'cell.update':   if (msg['data']) patchCell(msg['data'] as CellUpdateEvent); break;
      case 'train.status':  if (msg['data']) applyTrainStatus(msg['data'] as { trainId:string; status:string; delayMins?:number|null }); break;
      case 'table.reload':  void start(); break;
    }
  };

  const doConnect = () => {
    clearPing();
    if (destroyed) return;
    try {
      const fullUrl = `${wsBase}/api/v1/datasync`;
      ws = new WebSocket(fullUrl);
      ws.onopen = () => {
        reconnectAttempts = 0;
        ws!.send(JSON.stringify({ event:'subscribe', contentId, deviceId }));
        pingInterval = setInterval(() => {
          if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ event:'ping' }));
        }, 20_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
          if (msg['event']!=='pong') handleWsMsg(msg);
        } catch { /**/ }
      };
      ws.onerror = () => { /**/ };
      ws.onclose = () => {
        ws=null; clearPing();
        if (intentionalDisconnect||destroyed) return;
        if (reconnectAttempts < MAX_RECONNECTS) {
          const delay = RECONNECT_BASE * Math.pow(2, reconnectAttempts++);
          reconnectTimer = setTimeout(doConnect, delay);
        }
      };
    } catch { /**/ }
  };

  const buildTable = (data: DSTableData) => {
    container.innerHTML = DS_STYLES;
    const wrapper = document.createElement('div');
    wrapper.className = 'ds-wrapper';

    const titleBar = document.createElement('div');
    titleBar.className = 'ds-title-bar';
    titleBar.innerHTML = `<span class="ds-title">${escHtml(data.title||'Schedule')}</span>${data.subtitle?`<span class="ds-subtitle">${escHtml(data.subtitle)}</span>`:''}`;
    wrapper.appendChild(titleBar);

    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'flex:1;overflow:auto;';

    const table = document.createElement('table');
    table.className = 'ds-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const stationTh = document.createElement('th');
    stationTh.className = 'ds-col-station';
    stationTh.textContent = 'Station';
    headRow.appendChild(stationTh);
    for (const train of data.trains) {
      const th = document.createElement('th');
      th.className = 'ds-col-train';
      th.dataset['trainId'] = train.id;
      th.innerHTML = `<span class="ds-train-number">${escHtml(train.number)}</span>${train.days?`<span class="ds-train-days">${escHtml(train.days)}</span>`:''}`;
      if (train.status && train.status!=='normal') th.dataset['status'] = train.status;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    let lastSection: string | null = null;
    for (const station of data.stations) {
      if (station.section && station.section!==lastSection) {
        lastSection = station.section;
        const sRow = document.createElement('tr');
        sRow.className = 'ds-section-row';
        const sTd = document.createElement('td');
        sTd.colSpan = data.trains.length+1;
        sTd.className = 'ds-section-header';
        sTd.textContent = station.section;
        sRow.appendChild(sTd);
        tbody.appendChild(sRow);
      }
      const row = document.createElement('tr');
      row.dataset['stationId'] = station.id;
      const nameTd = document.createElement('td');
      nameTd.className = 'ds-station-name';
      nameTd.innerHTML = escHtml(station.name) + (station.tag ? ` <span class="ds-station-tag" style="font-size:11px;color:#60a5fa;">${escHtml(station.tag)}</span>` : '');
      row.appendChild(nameTd);
      for (const train of data.trains) {
        const cell = findCell(data.cells, train.id, station.id);
        const td = document.createElement('td');
        td.className = 'ds-cell';
        td.dataset['train'] = train.id;
        td.dataset['station'] = station.id;
        if (cell) { td.dataset['value']=cell.value??''; td.dataset['note']=cell.note??''; td.dataset['cellStatus']=cell.status??'normal'; td.dataset['delayMins']=cell.delayMins!=null?String(cell.delayMins):''; renderCellContent(td, cell); }
        else { td.textContent='–'; td.classList.add('ds-cell-empty'); }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    wrapper.appendChild(scrollWrap);

    const footer = document.createElement('div');
    footer.className = 'ds-footer';
    footer.id = 'ds-footer';
    footer.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    wrapper.appendChild(footer);
    container.appendChild(wrapper);
  };

  const showState = (msg: string) => {
    container.innerHTML = `${DS_STYLES}<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:18px;">${escHtml(msg)}</div>`;
  };

  const start = async () => {
    if (destroyed) return;
    cancelReconnect();
    if (ws) { ws.onclose=null; ws.close(1000,'re-render'); ws=null; }
    intentionalDisconnect = false;
    reconnectAttempts = 0;
    showState('Loading schedule…');
    try {
      const url = `${apiBase}/devices/${encodeURIComponent(deviceId)}/datasync/${encodeURIComponent(contentId)}/table`;
      const resp = await withTimeout(fetch(url, { headers:{ 'X-Device-Id':deviceId } }), 15_000);
      if (!resp.ok) { showState(`Schedule data unavailable (HTTP ${resp.status})`); return; }
      const data = await resp.json() as DSTableData;
      if (destroyed) return;
      buildTable(data);
      doConnect();
    } catch {
      if (!destroyed) showState('Could not load schedule data');
    }
  };

  void start();

  return {
    destroy() {
      destroyed = true;
      intentionalDisconnect = true;
      cancelReconnect();
      if (ws) { ws.onclose=null; ws.close(1000,'destroy'); ws=null; }
    },
    handleWsMessage(msg) {
      try { handleWsMsg(msg as Record<string, unknown>); } catch { /**/ }
    },
  };
}
