import postgres from 'postgres';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = postgres(dbUrl);

// 1. Devices with QM in name
const devs = await sql`
  SELECT id, name, platform, published_sync_group_id
  FROM devices
  WHERE name ILIKE '%QM%'
  ORDER BY name
`;
console.log('\n=== Samsung Devices ===');
for (const d of devs) {
  console.log(`  id=${d.id} name="${d.name}" platform=${d.platform} syncGroupId=${d.published_sync_group_id}`);
}

// 2. Sync group details
const sgIds = [...new Set(devs.map(d => d.published_sync_group_id).filter(Boolean))];
if (sgIds.length > 0) {
  const sgs = await sql`SELECT id, name, group_id FROM sync_groups WHERE id = ANY(${sql.array(sgIds)}::uuid[])`;
  console.log('\n=== SyncGroups ===');
  for (const sg of sgs) {
    console.log(`  id=${sg.id} name="${sg.name}" numeric_group_id=${sg.group_id}`);
  }

  // All members of those sync groups (key: platform must ALL be tizen/tizen-sbb for allTizen)
  const members = await sql`
    SELECT d.id, d.name, d.platform
    FROM sync_group_members sgm
    JOIN devices d ON d.id = sgm.device_id
    WHERE sgm.sync_group_id = ANY(${sql.array(sgIds)}::uuid[])
    ORDER BY d.name
  `;
  console.log('\n=== All Members of those SyncGroups (allTizen requires ALL to be tizen/tizen-sbb) ===');
  for (const m of members) {
    const flag = (m.platform === 'tizen' || m.platform === 'tizen-sbb') ? 'OK' : '*** WRONG PLATFORM ***';
    console.log(`  id=${m.id} name="${m.name}" platform=${m.platform}  ${flag}`);
  }
}

// 3. Recent NativeSync + SyncRelay logs from these devices
const devIds = devs.map(d => d.id);
const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
if (devIds.length > 0) {
  const logs = await sql`
    SELECT created_at, level, device_id, message FROM log_entries
    WHERE device_id = ANY(${sql.array(devIds)}::uuid[])
      AND created_at >= ${since}
      AND (message ILIKE '%NativeSync%' OR message ILIKE '%SyncRelay%' OR message ILIKE '%allTizen%' OR message ILIKE '%startSyncPlay%')
    ORDER BY created_at DESC LIMIT 60
  `;
  console.log('\n=== Recent Sync Logs ===');
  for (const l of logs) {
    console.log(`[${l.created_at.toISOString()}] [${l.level}] dev=${l.device_id.slice(0,8)} ${l.message}`);
  }
  if (logs.length === 0) console.log('  (none in last 4h)');
}

await sql.end();
