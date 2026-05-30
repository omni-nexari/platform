import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

// 1. Find devices with names containing QM43, QM50, QM55 (case-insensitive)
const devs = await sql`
  SELECT id, name, platform, published_sync_group_id
  FROM devices
  WHERE name ILIKE '%QM43%' OR name ILIKE '%QM50%' OR name ILIKE '%QM55%'
  ORDER BY name
`;
console.log('\n=== Devices ===');
for (const d of devs) {
  console.log(`  id=${d.id} name="${d.name}" platform=${d.platform} syncGroupId=${d.published_sync_group_id}`);
}

// 2. Get sync group details
const sgIds = [...new Set(devs.map(d => d.published_sync_group_id).filter(Boolean))];
if (sgIds.length > 0) {
  const sgs = await sql`
    SELECT id, name, group_id FROM sync_groups WHERE id = ANY(${sql.array(sgIds)})
  `;
  console.log('\n=== SyncGroups ===');
  for (const sg of sgs) {
    console.log(`  id=${sg.id} name="${sg.name}" numeric_group_id=${sg.group_id}`);
  }

  // Members of the sync group
  const members = await sql`
    SELECT d.id, d.name, d.platform FROM sync_group_members sgm
    JOIN devices d ON d.id = sgm.device_id
    WHERE sgm.sync_group_id = ANY(${sql.array(sgIds)})
  `;
  console.log('\n=== SyncGroup Members (all must be tizen/tizen-sbb for allTizen=true) ===');
  for (const m of members) {
    console.log(`  id=${m.id} name="${m.name}" platform=${m.platform}`);
  }
}

// 3. Recent [NativeSync] logs from these devices (last 4 hours)
const devIds = devs.map(d => d.id);
const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
if (devIds.length > 0) {
  const logs = await sql`
    SELECT created_at, level, device_id, message
    FROM log_entries
    WHERE device_id = ANY(${sql.array(devIds)})
      AND created_at >= ${since}
      AND message ILIKE '%NativeSync%'
    ORDER BY created_at DESC
    LIMIT 60
  `;
  console.log('\n=== Recent NativeSync Logs ===');
  for (const l of logs) {
    console.log(`[${l.created_at}] [${l.level}] devId=${l.device_id} ${l.message}`);
  }
  if (logs.length === 0) console.log('  (none)');

  // 4. Recent [SyncRelay] logs
  const relayLogs = await sql`
    SELECT created_at, level, device_id, message
    FROM log_entries
    WHERE device_id = ANY(${sql.array(devIds)})
      AND created_at >= ${since}
      AND message ILIKE '%SyncRelay%'
    ORDER BY created_at DESC
    LIMIT 40
  `;
  console.log('\n=== Recent SyncRelay Logs (should be empty for all-Samsung group) ===');
  for (const l of relayLogs) {
    console.log(`[${l.created_at}] [${l.level}] devId=${l.device_id} ${l.message}`);
  }
  if (relayLogs.length === 0) console.log('  (none)');

  // 5. Any recent error logs
  const errLogs = await sql`
    SELECT created_at, level, device_id, message
    FROM log_entries
    WHERE device_id = ANY(${sql.array(devIds)})
      AND created_at >= ${since}
      AND level IN ('error', 'warn')
    ORDER BY created_at DESC
    LIMIT 40
  `;
  console.log('\n=== Recent WARN/ERROR Logs ===');
  for (const l of errLogs) {
    console.log(`[${l.created_at}] [${l.level}] devId=${l.device_id} ${l.message}`);
  }
  if (errLogs.length === 0) console.log('  (none)');
}

await sql.end();

