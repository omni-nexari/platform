// Temporary diagnostic file — safe to delete
import postgres from 'postgres';

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://ds:Samsung%402026!@192.168.1.17:5432/ds',
);

// Grab a real workspace ID to test with
const [wsRow] = await sql`SELECT id FROM workspaces LIMIT 1`;
if (!wsRow) { console.error('No workspaces found'); await sql.end(); process.exit(1); }
const workspaceId = wsRow.id;
console.log('workspace:', workspaceId);

// Grab a real content item ID
const [contentRow] = await sql`SELECT id FROM content_items WHERE workspace_id = ${workspaceId} LIMIT 1`;
const entityIds = contentRow ? [contentRow.id] : [];
console.log('entityIds:', entityIds);

// Test 1: the raw ANY() query used in getAssignedTagsForEntities
try {
  const rows = await sql`
    SELECT
      ta.entity_id AS "entityId",
      wt.id,
      wt.name,
      wt.color,
      tc.id AS "categoryId",
      tc.name AS "categoryName",
      tc.color AS "categoryColor"
    FROM tag_assignments ta
    INNER JOIN workspace_tags wt ON wt.id = ta.tag_id
    INNER JOIN tag_categories tc ON tc.id = wt.category_id
    WHERE ta.workspace_id = ${workspaceId}
      AND ta.entity_type = ${'content'}
      AND ta.entity_id = ANY(${entityIds})
    ORDER BY tc.position ASC, wt.position ASC, wt.created_at ASC
  `;
  console.log('Test 1 (raw SQL ANY):', rows.length, 'rows - OK');
} catch (err) {
  console.error('Test 1 FAILED:', err.message);
}

// Test 2: check content_items columns
try {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_items'
    ORDER BY ordinal_position
  `;
  const names = cols.map(c => c.column_name);
  console.log('content_items columns:', names.join(', '));
  console.log('tags present?', names.includes('tags') ? 'YES (problem!)' : 'NO (correct)');
} catch (err) {
  console.error('Test 2 FAILED:', err.message);
}

// Test 3: basic select of content_items
try {
  const rows = await sql`SELECT id, name, type, status FROM content_items WHERE workspace_id = ${workspaceId} LIMIT 3`;
  console.log('Test 3 (content_items select):', rows.length, 'rows - OK');
} catch (err) {
  console.error('Test 3 FAILED:', err.message);
}

await sql.end();
console.log('Done');
