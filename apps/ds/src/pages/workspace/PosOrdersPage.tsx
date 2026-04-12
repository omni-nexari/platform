import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList, CreditCard, RefreshCw, Search, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import { formatDistanceToNow } from '../utils/time.js';
import {
  Badge,
  Callout,
  EmptyState,
  FilterChip,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

type PosOrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';

interface PosRestaurant {
  currency: string;
}

interface PosOrderLineItem {
  id: string;
  itemName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents?: number;
  notes?: string | null;
}

interface PosOrder {
  id: string;
  orderNumber: number;
  status: PosOrderStatus;
  totalCents: number;
  customerName: string | null;
  notes: string | null;
  createdAt: string;
  items: PosOrderLineItem[];
}

interface PosPayment {
  id: string;
  method: 'cash' | 'card' | 'split';
  amountCents: number;
  tipCents: number;
  changeCents: number;
  reference: string | null;
  createdAt: string;
}

interface OrderHistoryEntry {
  type: 'created' | 'completed' | 'cancelled' | 'payment';
  at: string;
  label: string;
  amountCents?: number;
}

interface OrderHistoryResponse {
  order: PosOrder;
  payments: PosPayment[];
  history: OrderHistoryEntry[];
}

const STATUS_TONES = {
  pending: 'warning',
  preparing: 'accent',
  ready: 'success',
  completed: 'neutral',
  cancelled: 'danger',
} as const;

const HISTORY_TONES = {
  created: 'neutral',
  completed: 'success',
  cancelled: 'danger',
  payment: 'accent',
} as const;

const STATUS_FILTERS = ['all', 'pending', 'preparing', 'ready', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function buildOrdersUrl(wsId: string, statusFilter: StatusFilter) {
  if (statusFilter === 'all') {
    return `/pos/mgmt/orders?workspaceId=${wsId}`;
  }

  return `/pos/mgmt/orders?workspaceId=${wsId}&status=${statusFilter}`;
}

export default function PosOrdersPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PosOrder | null>(null);

  const orderLookup = orderSearch.trim();
  const isSearchActive = orderLookup.length > 0;
  const isSearchValid = /^\d+$/.test(orderLookup);

  async function invalidatePosQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-order-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-order-history'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-orders-kitchen'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-orders-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-analytics-top-items'] }),
    ]);
  }

  const { data: restaurant } = useQuery<PosRestaurant | null>({
    queryKey: ['pos-restaurant', wsId],
    queryFn: () => api.get(`/pos/restaurant?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const currency = restaurant?.currency ?? 'USD';

  const { data: orders = [], isLoading, isFetching } = useQuery<PosOrder[]>({
    queryKey: ['pos-orders', wsId, statusFilter, orderLookup],
    queryFn: async () => {
      if (!wsId) return [];

      if (isSearchActive) {
        if (!isSearchValid) return [];

        try {
          const order = await api.get<PosOrder>(`/pos/mgmt/orders/by-number/${orderLookup}?workspaceId=${wsId}`);
          return [order];
        } catch (error) {
          if (error instanceof Error && error.message.includes('Order not found')) {
            return [];
          }
          throw error;
        }
      }

      return api.get(buildOrdersUrl(wsId, statusFilter));
    },
    enabled: !!wsId,
    refetchInterval: isSearchActive ? false : 10_000,
  });

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;

  const {
    data: orderHistory,
    isLoading: isOrderHistoryLoading,
    isFetching: isOrderHistoryFetching,
  } = useQuery<OrderHistoryResponse>({
    queryKey: ['pos-order-history', selectedOrderId],
    queryFn: () => api.get(`/pos/mgmt/orders/${selectedOrderId}/history`),
    enabled: !!selectedOrderId,
  });

  const detailOrder = orderHistory?.order ?? selectedOrder;

  const statusMut = useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: 'confirm' | 'ready' }) => {
      if (action === 'confirm') {
        return api.post(`/pos/mgmt/orders/${orderId}/confirm`);
      }

      return api.patch(`/pos/mgmt/orders/${orderId}/status`, { status: 'ready' });
    },
    onSuccess: async (_data, variables) => {
      await invalidatePosQueries();
      toast.success(variables.action === 'confirm' ? 'Order confirmed' : 'Order marked ready');
    },
    onError: (_error, variables) => {
      toast.error(variables.action === 'confirm' ? 'Failed to confirm order' : 'Failed to mark order ready');
    },
  });

  const cancelMut = useMutation({
    mutationFn: (orderId: string) => api.post(`/pos/mgmt/orders/${orderId}/cancel`),
    onSuccess: async (_data, orderId) => {
      await invalidatePosQueries();
      if (selectedOrderId === orderId) {
        setSelectedOrderId(null);
      }
      setCancelTarget(null);
      toast.success('Order cancelled');
    },
    onError: () => toast.error('Failed to cancel order'),
  });

  function openPayment(order: Pick<PosOrder, 'id' | 'totalCents'>) {
    navigate(`/workspaces/${wsId}/pos/payment?orderId=${order.id}&total=${order.totalCents}`);
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Orders"
        subtitle="Live order queue with detail history"
        action={
          <button
            className="ui-btn-secondary flex items-center gap-1.5"
            onClick={() => void invalidatePosQueries()}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <FilterChip
              key={status}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            >
              {status === 'all' ? 'All' : status}
            </FilterChip>
          ))}
        </div>

        <label className="relative flex w-full items-center lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="search"
            value={orderSearch}
            onChange={(event) => setOrderSearch(event.target.value)}
            placeholder="Find order number"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-9 pr-10 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)]"
          />
          {isSearchActive ? (
            <button
              type="button"
              onClick={() => setOrderSearch('')}
              className="absolute right-2 rounded-full p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
              aria-label="Clear order search"
            >
              <XCircle className="h-4 w-4" />
            </button>
          ) : null}
        </label>
      </div>

      {isFetching && !isLoading ? (
        <p className="text-xs text-[var(--text-muted)]">Refreshing order queue…</p>
      ) : null}

      {isSearchActive && !isSearchValid ? (
        <Callout tone="warning">Search accepts a numeric order number such as 1042.</Callout>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-8 h-8" />}
          title="No orders"
          description={
            isSearchActive
              ? (isSearchValid ? `Order #${orderLookup} was not found.` : 'Enter a numeric order number to search the queue.')
              : (statusFilter === 'all' ? 'No orders have been created yet.' : `No ${statusFilter} orders right now.`)
          }
          action={
            isSearchActive ? (
              <button className="ui-btn-secondary" onClick={() => setOrderSearch('')}>
                Clear Search
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((order) => (
            <div key={order.id} className="ui-card p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-lg font-bold tabular-nums text-[var(--text)]">
                    #{order.orderNumber}
                  </span>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {order.customerName || 'Walk-in'}
                  </p>
                </div>
                <Badge tone={STATUS_TONES[order.status]}>{order.status}</Badge>
              </div>

              <ul className="space-y-1 text-sm text-[var(--text)]">
                {order.items.slice(0, 4).map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {item.quantity}× {item.itemName}
                    </span>
                    <span className="text-[var(--text-muted)] shrink-0">
                      {formatPrice((item.lineTotalCents ?? item.unitPriceCents * item.quantity), currency)}
                    </span>
                  </li>
                ))}
                {order.items.length > 4 ? (
                  <li className="text-xs text-[var(--text-muted)]">
                    +{order.items.length - 4} more item{order.items.length - 4 === 1 ? '' : 's'}
                  </li>
                ) : null}
              </ul>

              {order.notes ? (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  {order.notes}
                </p>
              ) : null}

              <div className="flex items-center justify-between text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
                <span>{formatDistanceToNow(order.createdAt)}</span>
                <span className="font-semibold text-[var(--text)]">{formatPrice(order.totalCents, currency)}</span>
              </div>

              <div className="flex gap-2">
                <button
                  className="flex-1 ui-btn-secondary text-xs py-1.5"
                  onClick={() => setSelectedOrderId(order.id)}
                >
                  Details
                </button>

                {order.status === 'pending' ? (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5"
                    disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate({ orderId: order.id, action: 'confirm' })}
                  >
                    Confirm
                  </button>
                ) : null}

                {order.status === 'preparing' ? (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5"
                    disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate({ orderId: order.id, action: 'ready' })}
                  >
                    Mark Ready
                  </button>
                ) : null}

                {order.status === 'ready' ? (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
                    onClick={() => openPayment(order)}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    Payment
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedOrderId ? (
        <Modal onClose={() => setSelectedOrderId(null)} size="lg">
          <ModalHeader
            title={detailOrder ? `Order #${detailOrder.orderNumber}` : 'Order details'}
            subtitle={
              detailOrder
                ? `${detailOrder.customerName || 'Walk-in'} · ${detailOrder.status}`
                : 'Loading the latest order history'
            }
            onClose={() => setSelectedOrderId(null)}
          />

          <ModalBody className="space-y-5 max-h-[75vh] overflow-y-auto">
            {isOrderHistoryLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-28 rounded-2xl" />
                <Skeleton className="h-48 rounded-2xl" />
                <Skeleton className="h-32 rounded-2xl" />
              </div>
            ) : orderHistory && detailOrder ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                <div className="space-y-5">
                  <SectionCard>
                    <SectionCardHeader>
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text)]">Items</h3>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Current line items on the order.</p>
                      </div>
                      <Badge tone="accent">{detailOrder.items.length} lines</Badge>
                    </SectionCardHeader>
                    <SectionCardBody className="space-y-3">
                      {detailOrder.items.map((item) => (
                        <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[var(--text)]">
                                {item.quantity}× {item.itemName}
                              </p>
                              {item.notes ? (
                                <p className="mt-1 text-xs text-[var(--text-muted)]">{item.notes}</p>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-[var(--text)]">
                              {formatPrice((item.lineTotalCents ?? item.unitPriceCents * item.quantity), currency)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </SectionCardBody>
                  </SectionCard>

                  <SectionCard>
                    <SectionCardHeader>
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text)]">Activity</h3>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {isOrderHistoryFetching ? 'Refreshing latest history…' : 'Status and payment events for this order.'}
                        </p>
                      </div>
                    </SectionCardHeader>
                    <SectionCardBody className="space-y-3">
                      {orderHistory.history.map((entry, index) => (
                        <div key={`${entry.type}-${entry.at}-${index}`} className="flex items-start gap-3">
                          <div className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-[var(--text)]">{entry.label}</p>
                              <Badge tone={HISTORY_TONES[entry.type]}>{entry.type}</Badge>
                              {typeof entry.amountCents === 'number' ? (
                                <span className="text-xs font-medium text-[var(--text-muted)]">
                                  {formatPrice(entry.amountCents, currency)}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {new Date(entry.at).toLocaleString()} · {formatDistanceToNow(entry.at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </SectionCardBody>
                  </SectionCard>
                </div>

                <div className="space-y-5">
                  <SectionCard>
                    <SectionCardHeader>
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text)]">Summary</h3>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Front-of-house snapshot for the current order.</p>
                      </div>
                    </SectionCardHeader>
                    <SectionCardBody>
                      <dl className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Status</dt>
                          <dd className="mt-2"><Badge tone={STATUS_TONES[detailOrder.status]}>{detailOrder.status}</Badge></dd>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Total</dt>
                          <dd className="mt-2 text-sm font-semibold text-[var(--text)]">{formatPrice(detailOrder.totalCents, currency)}</dd>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Placed</dt>
                          <dd className="mt-2 text-sm font-medium text-[var(--text)]">{formatDistanceToNow(detailOrder.createdAt)}</dd>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                          <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Customer</dt>
                          <dd className="mt-2 text-sm font-medium text-[var(--text)]">{detailOrder.customerName || 'Walk-in'}</dd>
                        </div>
                      </dl>
                    </SectionCardBody>
                  </SectionCard>

                  {detailOrder.notes ? (
                    <Callout tone="accent">{detailOrder.notes}</Callout>
                  ) : null}

                  {orderHistory.payments.length > 0 ? (
                    <SectionCard>
                      <SectionCardHeader>
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text)]">Payments</h3>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">Transactions recorded against this order.</p>
                        </div>
                      </SectionCardHeader>
                      <SectionCardBody className="space-y-3">
                        {orderHistory.payments.map((payment) => (
                          <div key={payment.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--text)]">
                                  {payment.method.toUpperCase()} payment
                                </p>
                                <p className="mt-1 text-xs text-[var(--text-muted)]">
                                  {new Date(payment.createdAt).toLocaleString()}
                                  {payment.reference ? ` · ${payment.reference}` : ''}
                                </p>
                              </div>
                              <span className="shrink-0 text-sm font-semibold text-[var(--text)]">
                                {formatPrice(payment.amountCents, currency)}
                              </span>
                            </div>
                            {payment.tipCents > 0 || payment.changeCents > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                                {payment.tipCents > 0 ? <span>Tip {formatPrice(payment.tipCents, currency)}</span> : null}
                                {payment.changeCents > 0 ? <span>Change {formatPrice(payment.changeCents, currency)}</span> : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </SectionCardBody>
                    </SectionCard>
                  ) : null}
                </div>
              </div>
            ) : (
              <Callout tone="danger">This order could not be loaded. Try refreshing the queue and reopening it.</Callout>
            )}
          </ModalBody>

          <ModalFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:w-auto">
              {detailOrder && detailOrder.status !== 'completed' && detailOrder.status !== 'cancelled' ? (
                <button
                  className="w-full sm:w-auto rounded-lg border border-red-300/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/15"
                  onClick={() => setCancelTarget(detailOrder)}
                >
                  Cancel Order
                </button>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  {detailOrder?.status === 'completed'
                    ? 'Completed orders remain read-only in the queue.'
                    : detailOrder?.status === 'cancelled'
                      ? 'Cancelled orders are kept for audit history.'
                      : ' '}
                </p>
              )}
            </div>

            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <ModalSecondaryButton onClick={() => setSelectedOrderId(null)}>
                Close
              </ModalSecondaryButton>

              {detailOrder?.status === 'pending' ? (
                <ModalPrimaryButton
                  disabled={statusMut.isPending}
                  onClick={() => statusMut.mutate({ orderId: detailOrder.id, action: 'confirm' })}
                >
                  Confirm Order
                </ModalPrimaryButton>
              ) : null}

              {detailOrder?.status === 'preparing' ? (
                <ModalPrimaryButton
                  disabled={statusMut.isPending}
                  onClick={() => statusMut.mutate({ orderId: detailOrder.id, action: 'ready' })}
                >
                  Mark Ready
                </ModalPrimaryButton>
              ) : null}

              {detailOrder?.status === 'ready' ? (
                <ModalPrimaryButton onClick={() => openPayment(detailOrder)}>
                  Open Payment
                </ModalPrimaryButton>
              ) : null}
            </div>
          </ModalFooter>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget ? `Cancel order #${cancelTarget.orderNumber}?` : 'Cancel order?'}
        message="This will remove the order from the active queue and keep it in history as cancelled."
        confirmLabel="Cancel Order"
        confirmPendingLabel="Cancelling…"
        variant="danger"
        isConfirming={cancelMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (cancelTarget) {
            cancelMut.mutate(cancelTarget.id);
          }
        }}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
