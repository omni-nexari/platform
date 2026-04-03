import { readFileSync, writeFileSync } from 'fs';

const f = 'c:/Users/chiho/Projects/Platform/apps/ds/src/pages/workspace/TizenTestPage.tsx';
let c = readFileSync(f, 'utf8');
const NL = '\r\n';

// Replace description paragraph
const oldDesc = `            <p className="mt-1 text-sm text-[var(--text-muted)]">${NL}              Actions via <code>webapis.remotepower</code> (requires Samsung partner privilege). Power Off shuts down the display; Power On wakes it.${NL}            </p>`;
const newDesc = `            <p className="mt-1 text-sm text-[var(--text-muted)]">${NL}              Actions via <code>webapis.remotepower</code> (partner privilege).<br />${NL}              <strong>Step 1 (LFD):</strong> Enable Remote Config \u2014 required before Power Off will work.<br />${NL}              <strong>Power Off</strong> = LFD + HTV. <strong>Power On</strong> = HTV only (NotSupportedError on LFD signage).${NL}            </p>`;
if (!c.includes(oldDesc)) { console.error('DESC NOT FOUND'); process.exit(1); }
c = c.replace(oldDesc, newDesc);
console.log('desc replaced');

// Replace powerOn button label
c = c.replace(
  `{cmdBusy === 'remotepower.powerOn' ? 'Sending...' : 'Power On'}`,
  `{cmdBusy === 'remotepower.powerOn' ? 'Sending...' : 'Power On (HTV only)'}`
);

// Replace powerOff button label
c = c.replace(
  `{cmdBusy === 'remotepower.powerOff' ? 'Sending...' : 'Power Off'}`,
  `{cmdBusy === 'remotepower.powerOff' ? 'Sending...' : 'Power Off (LFD+HTV)'}`
);

// Insert the two setRemoteConfiguration buttons before the existing powerOn div
const insertBefore = `              <div className="flex flex-col gap-1">${NL}                <ActionButton${NL}                  tone="secondary"${NL}                  onClick={() => void runCommand('remotepower.powerOn')}`;
const insertContent = `              <div className="flex flex-col gap-1">${NL}                <ActionButton${NL}                  tone="secondary"${NL}                  onClick={() => void runCommand('remotepower.setRemoteConfiguration', 'ON')}${NL}                  disabled={!deviceIsOnline || cmdBusy === 'remotepower.setRemoteConfiguration'}${NL}                >${NL}                  {cmdBusy === 'remotepower.setRemoteConfiguration' ? 'Sending...' : 'Enable Remote Config (ON)'}${NL}                </ActionButton>${NL}                <CommandResultBlock action="remotepower.setRemoteConfiguration" />${NL}              </div>${NL}              <div className="flex flex-col gap-1">${NL}                <ActionButton${NL}                  tone="secondary"${NL}                  onClick={() => void runCommand('remotepower.setRemoteConfiguration', 'OFF')}${NL}                  disabled={!deviceIsOnline || cmdBusy === 'remotepower.setRemoteConfiguration'}${NL}                >${NL}                  {cmdBusy === 'remotepower.setRemoteConfiguration' ? 'Sending...' : 'Disable Remote Config (OFF)'}${NL}                </ActionButton>${NL}              </div>${NL}              <div className="flex flex-col gap-1">${NL}                <ActionButton${NL}                  tone="secondary"${NL}                  onClick={() => void runCommand('remotepower.powerOn')}`;

if (!c.includes(insertBefore)) { console.error('INSERT POINT NOT FOUND'); process.exit(1); }
c = c.replace(insertBefore, insertContent);
console.log('buttons inserted');

// Move powerOff button to come before powerOn (swap order)
// Actually just reorder: setRemoteConfig(ON), setRemoteConfig(OFF), powerOff, powerOn
// The powerOn block is now at the start (after insert). Move powerOff before powerOn.
// Find powerOff div and powerOn div and swap
const poOnStart = c.indexOf(`onClick={() => void runCommand('remotepower.powerOn')}`);
const poOffStart = c.indexOf(`onClick={() => void runCommand('remotepower.powerOff')}`);
console.log('powerOn at:', poOnStart, 'powerOff at:', poOffStart);

writeFileSync(f, c, 'utf8');
console.log('done');
