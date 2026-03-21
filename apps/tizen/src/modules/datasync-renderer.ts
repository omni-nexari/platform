/**
 * datasync-renderer.ts — DataSync Live Schedule Renderer (DS Tizen Player)
 *
 * Renders a live transport schedule table into #content-container.
 * Opens a dedicated WebSocket to /api/v1/datasync for live cell/train updates.
 *
 * Public API (namespace):
 *   DataSyncRenderer.render(contentId, cmsUrl, deviceId) → Promise<void>
 *   DataSyncRenderer.disconnect()
 *   DataSyncRenderer.handleWSMessage(msg)   ← called by player WS handler
 */

namespace DataSyncRenderer {

    // ─── Types ──────────────────────────────────────────────────────────────
    interface DSCell {
        id: string;
        trainId: string;
        stationId: string;
        value: string | null;
        note: string | null;
        status: string;
        delayMins: number | null;
    }
    interface DSTrain   { id: string; number: string; days?: string | null; status?: string; }
    interface DSStation { id: string; name: string; tag?: string | null; section?: string | null; type: string; position: number; }
    interface DSTableData { title?: string; subtitle?: string; trains: DSTrain[]; stations: DSStation[]; cells: DSCell[]; }
    interface CellUpdateEvent { trainId: string; stationId: string; field: string; value: any; }

    // ─── Private state ────────────────────────────────────────────────────────
    let _ws: WebSocket | null = null;
    let _contentId: string    = '';
    let _cmsUrl: string       = '';
    let _deviceId: string     = '';
    let _loading: boolean     = false;

    // ── Reconnect / keepalive state ────────────────────────────────────────────
    let _intentionalDisconnect: boolean = false;
    let _reconnectTimer: number | null  = null;
    let _reconnectAttempts: number      = 0;
    let _pingInterval: number | null    = null;
    const MAX_RECONNECT_ATTEMPTS        = 5;
    const RECONNECT_BASE_DELAY_MS       = 2_000; // doubles: 2s, 4s, 8s, 16s, 32s

    // ─── Public API ──────────────────────────────────────────────────────────

    export async function render(contentId: string, cmsUrl: string, deviceId: string): Promise<void> {
        if (_loading) { dsLog('render: already loading, skipping'); return; }
        _loading   = true;
        _contentId = contentId;
        _cmsUrl    = cmsUrl;
        _deviceId  = deviceId;

        _cancelReconnect();
        if (_ws) { _ws.onclose = null; _ws.close(1000, 'Re-render'); _ws = null; }

        showLoading();

        dsLog(`Fetching table for content ${contentId}`);
        try {
            const url  = `${cmsUrl}/api/v1/devices/${encodeURIComponent(deviceId)}/datasync/${encodeURIComponent(contentId)}/table`;
            const resp = await withTimeout(fetch(url, {
                headers: { 'X-Device-Id': deviceId },
            }), 15_000);

            if (!resp.ok) {
                dsLog(`Table fetch failed: HTTP ${resp.status}`);
                showError(`Schedule data unavailable (HTTP ${resp.status})`);
                return;
            }
            const tableData: DSTableData = await resp.json();
            buildTable(tableData);
            connectWS(cmsUrl, contentId);
        } catch (e: any) {
            dsLog(`render error: ${e.message}`);
            showError('Could not load schedule data');
        } finally {
            _loading = false;
        }
    }

    export function disconnect(): void {
        _intentionalDisconnect = true;
        _loading = false;
        _cancelReconnect();
        if (_ws) {
            _ws.onclose = null;
            _ws.close(1000, 'Content switch');
            _ws = null;
            dsLog('Disconnected (intentional)');
        }
    }

    /** Forward WS messages from the player's main socket (table.reload / cell.update / train.status). */
    export function handleWSMessage(msg: any): void {
        handleWsMsg(msg);
    }

    // ─── Table Builder ────────────────────────────────────────────────────────

    function buildTable(data: DSTableData): void {
        const container = document.getElementById('content-container');
        if (!container) { dsLog('content-container not found'); return; }

        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'ds-wrapper';

        // Title bar
        const titleBar = document.createElement('div');
        titleBar.className = 'ds-title-bar';
        titleBar.innerHTML =
            `<span class="ds-title">${escHtml(data.title || 'Schedule')}</span>` +
            (data.subtitle ? `<span class="ds-subtitle">${escHtml(data.subtitle)}</span>` : '');
        wrapper.appendChild(titleBar);

        // Table
        const table  = document.createElement('table');
        table.className = 'ds-table';
        const thead  = document.createElement('thead');
        const headRow = document.createElement('tr');

        const stationTh = document.createElement('th');
        stationTh.className = 'ds-col-station';
        stationTh.textContent = 'Station';
        headRow.appendChild(stationTh);

        for (const train of data.trains) {
            const th = document.createElement('th');
            th.className       = 'ds-col-train';
            th.dataset.trainId = train.id;
            th.innerHTML =
                `<span class="ds-train-number">${escHtml(train.number)}</span>` +
                (train.days ? `<span class="ds-train-days">${escHtml(train.days)}</span>` : '');
            if (train.status && train.status !== 'normal') th.dataset.status = train.status;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody       = document.createElement('tbody');
        let lastSection: string | null = null;

        for (const station of data.stations) {
            if (station.section && station.section !== lastSection) {
                lastSection = station.section;
                const sectionRow = document.createElement('tr');
                sectionRow.className = 'ds-section-row';
                const sectionTd = document.createElement('td');
                sectionTd.colSpan   = data.trains.length + 1;
                sectionTd.className = 'ds-section-header';
                sectionTd.textContent = station.section;
                sectionRow.appendChild(sectionTd);
                tbody.appendChild(sectionRow);
            }

            const row = document.createElement('tr');
            row.dataset.stationId = station.id;

            const nameTd = document.createElement('td');
            nameTd.className = 'ds-station-name';
            let stationLabel = escHtml(station.name);
            if (station.tag) stationLabel += ` <span class="ds-station-tag">${escHtml(station.tag)}</span>`;
            nameTd.innerHTML = stationLabel;
            row.appendChild(nameTd);

            for (const train of data.trains) {
                const cell = findCell(data.cells, train.id, station.id);
                const td   = document.createElement('td');
                td.className       = 'ds-cell';
                td.dataset.train   = train.id;
                td.dataset.station = station.id;
                if (cell) {
                    td.dataset.value      = cell.value     ?? '';
                    td.dataset.note       = cell.note      ?? '';
                    td.dataset.cellStatus = cell.status    ?? 'normal';
                    td.dataset.delayMins  = cell.delayMins != null ? String(cell.delayMins) : '';
                    renderCellContent(td, cell);
                } else {
                    td.textContent = '–';
                    td.classList.add('ds-cell-empty');
                }
                row.appendChild(td);
            }
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);

        const footer = document.createElement('div');
        footer.className = 'ds-footer';
        footer.id        = 'ds-footer';
        footer.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        wrapper.appendChild(footer);

        container.appendChild(wrapper);
        dsLog(`Table rendered: ${data.trains.length} trains × ${data.stations.length} stations`);
    }

    function renderCellContent(td: HTMLTableCellElement, cell: DSCell): void {
        const statusLower = (cell.status || 'normal').toLowerCase();
        td.dataset.status = statusLower;
        td.classList.remove('ds-cell-empty');

        let html = `<span class="ds-time">${escHtml(cell.value || '–')}</span>`;
        if (cell.note)  html += `<sup class="ds-note">${escHtml(cell.note)}</sup>`;
        if (statusLower === 'delayed' && cell.delayMins) {
            html += `<span class="ds-delay">+${cell.delayMins}'</span>`;
        }
        td.innerHTML = html;
    }

    function findCell(cells: DSCell[], trainId: string, stationId: string): DSCell | undefined {
        for (let i = 0; i < cells.length; i++) {
            if (cells[i].trainId === trainId && cells[i].stationId === stationId) return cells[i];
        }
        return undefined;
    }

    // ─── WebSocket ────────────────────────────────────────────────────────────

    function connectWS(cmsUrl: string, contentId: string): void {
        _intentionalDisconnect = false;
        _reconnectAttempts     = 0;
        _doConnect(cmsUrl, contentId);
    }

    function _doConnect(cmsUrl: string, contentId: string): void {
        _clearPing();
        try {
            const wsUrl   = cmsUrl.replace(/^http/, 'ws');
            const fullUrl = `${wsUrl}/api/v1/datasync`;
            dsLog(`WS connecting (attempt ${_reconnectAttempts + 1}): ${fullUrl}`);
            _ws = new WebSocket(fullUrl);

            _ws.onopen = () => {
                _reconnectAttempts = 0;
                dsLog('WS connected — subscribing to ' + contentId);
                _ws!.send(JSON.stringify({ event: 'subscribe', contentId, deviceId: _deviceId }));

                // 20 s ping to keep TCP alive during content playback
                _pingInterval = setInterval(() => {
                    if (_ws && _ws.readyState === WebSocket.OPEN) {
                        _ws.send(JSON.stringify({ event: 'ping' }));
                    }
                }, 20_000) as unknown as number;
            };
            _ws.onmessage = (evt: MessageEvent) => {
                try {
                    const msg = JSON.parse(evt.data as string);
                    if (msg.event !== 'pong') handleWsMsg(msg);
                } catch (e: any) { dsLog('WS parse error: ' + e.message); }
            };
            _ws.onerror  = () => { dsLog('WS error'); };
            _ws.onclose  = (evt: CloseEvent) => {
                dsLog(`WS closed code=${evt.code}`);
                _ws = null;
                _clearPing();

                if (_intentionalDisconnect) return;

                if (_reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, _reconnectAttempts);
                    _reconnectAttempts++;
                    dsLog(`WS reconnecting in ${delay / 1000}s (attempt ${_reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                    _reconnectTimer = setTimeout(() => {
                        _reconnectTimer = null;
                        _doConnect(cmsUrl, contentId);
                    }, delay) as unknown as number;
                } else {
                    dsLog(`WS gave up after ${MAX_RECONNECT_ATTEMPTS} attempts`);
                }
            };
        } catch (e: any) {
            dsLog('WS init error: ' + e.message);
        }
    }

    function _cancelReconnect(): void {
        if (_reconnectTimer !== null) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        _clearPing();
    }

    function _clearPing(): void {
        if (_pingInterval !== null) { clearInterval(_pingInterval); _pingInterval = null; }
    }

    function handleWsMsg(msg: any): void {
        switch (msg.event) {
            case 'cell.update':
                if (msg.data) patchCell(msg.data as CellUpdateEvent);
                break;
            case 'train.status':
                if (msg.data) applyTrainStatus(msg.data);
                break;
            case 'table.reload':
                render(_contentId, _cmsUrl, _deviceId);
                break;
            default:
                dsLog('Unknown WS event: ' + msg.event);
        }
    }

    // ─── Live Patching ────────────────────────────────────────────────────────

    function patchCell(data: CellUpdateEvent): void {
        const td = document.querySelector<HTMLTableCellElement>(
            `td[data-train="${data.trainId}"][data-station="${data.stationId}"]`
        );
        if (!td) { dsLog(`Cell not found: train=${data.trainId} station=${data.stationId}`); return; }

        switch (data.field) {
            case 'value':     td.dataset.value      = data.value ?? ''; break;
            case 'note':      td.dataset.note       = data.value ?? ''; break;
            case 'status':    td.dataset.cellStatus = data.value ?? 'normal'; break;
            case 'delayMins': td.dataset.delayMins  = data.value != null ? String(data.value) : ''; break;
        }

        const cell: DSCell = {
            id: '', trainId: data.trainId, stationId: data.stationId,
            value:     td.dataset.value      || null,
            note:      td.dataset.note       || null,
            status:    (td.dataset.cellStatus || 'normal'),
            delayMins: td.dataset.delayMins   ? parseInt(td.dataset.delayMins, 10) : null,
        };
        renderCellContent(td, cell);
        updateFooter();
        dsLog(`Cell patched: train=${data.trainId} station=${data.stationId} [${data.field}]=${JSON.stringify(data.value)}`);
    }

    function applyTrainStatus(data: { trainId: string; status: string; delayMins?: number | null }): void {
        const status = (data.status || 'normal').toLowerCase();

        const th = document.querySelector<HTMLElement>(`th[data-train-id="${data.trainId}"]`);
        if (th) {
            th.dataset.status = status;
            let delaySpan = th.querySelector<HTMLElement>('.ds-train-delay');
            if (status === 'delayed' && data.delayMins) {
                if (!delaySpan) {
                    delaySpan = document.createElement('span');
                    delaySpan.className = 'ds-train-delay';
                    th.appendChild(delaySpan);
                }
                delaySpan.textContent = `+${data.delayMins}'`;
            } else if (delaySpan) {
                delaySpan.remove();
            }
        }

        const dataCells = document.querySelectorAll<HTMLTableCellElement>(`td[data-train="${data.trainId}"]`);
        dataCells.forEach(td => {
            if (td.classList.contains('ds-cell-empty')) return;
            if (status === 'normal') {
                td.dataset.status    = td.dataset.cellStatus || 'normal';
                if (!td.dataset.cellStatus || td.dataset.cellStatus === 'normal') {
                    td.dataset.delayMins = '';
                }
            } else {
                td.dataset.status = status;
                if (status === 'delayed' && data.delayMins) td.dataset.delayMins = String(data.delayMins);
            }
            const cell: DSCell = {
                id: '', trainId: data.trainId, stationId: td.dataset.station!,
                value:     td.dataset.value     || null,
                note:      td.dataset.note      || null,
                status:    td.dataset.status!,
                delayMins: td.dataset.delayMins ? parseInt(td.dataset.delayMins, 10) : null,
            };
            renderCellContent(td, cell);
        });

        updateFooter();
        dsLog(`Train status applied: ${data.trainId} → ${status}`);
    }

    function updateFooter(): void {
        const footer = document.getElementById('ds-footer');
        if (footer) footer.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function showLoading(): void {
        const container = document.getElementById('content-container');
        if (container) container.innerHTML = '<div class="ds-wrapper"><div class="ds-loading">Loading schedule…</div></div>';
    }

    function showError(msg: string): void {
        const container = document.getElementById('content-container');
        if (container) container.innerHTML = `<div class="ds-wrapper"><div class="ds-error">${escHtml(msg)}</div></div>`;
    }

    function escHtml(s: string): string {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
        ]);
    }

    function dsLog(msg: string): void {
        console.log(`[DataSync ${new Date().toISOString()}] ${msg}`);
    }
}
