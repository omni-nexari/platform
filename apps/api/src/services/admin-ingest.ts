// Standalone stub — support ticket forwarding to admin.nexari.ca disabled.
export async function ingestTicketCreated(_params: {
  ticketId: string;
  orgId?: string | null;
  subject: string;
  body: string;
  authorEmail: string;
  instanceUrl?: string | null;
}): Promise<void> { /* standalone — no admin ingest */ }

export async function ingestMessageAdded(_params: {
  ticketId: string;
  body: string;
  authorEmail: string;
  isStaffReply: boolean;
}): Promise<void> { /* standalone — no admin ingest */ }
