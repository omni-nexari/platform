export interface AssignedTag {
  id: string;
  name: string;
  color: string | null;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
}

interface Props {
  tags?: AssignedTag[] | null | undefined;
  size?: 'sm' | 'xs';
  emptyText?: string | null;
}

export default function AssignedTagPills({ tags, size = 'xs', emptyText = null }: Props) {
  const items = tags ?? [];

  if (items.length === 0) {
    return emptyText ? <span className="text-[11px] text-[var(--text-muted)]">{emptyText}</span> : null;
  }

  const baseClass = size === 'sm'
    ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-white'
    : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white';

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((tag) => {
        const color = tag.color ?? tag.categoryColor;
        return (
          <span
            key={tag.id}
            className={baseClass}
            style={{ background: color }}
            title={`${tag.categoryName}: ${tag.name}`}
          >
            {tag.name}
          </span>
        );
      })}
    </div>
  );
}
