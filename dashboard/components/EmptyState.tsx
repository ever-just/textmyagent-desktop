interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center" role="status">
      {icon && <div className="text-[var(--color-text-tertiary)] mb-4" aria-hidden="true">{icon}</div>}
      <h3 className="text-base font-semibold text-[var(--color-text)]">{title}</h3>
      {description && <p className="text-[13px] text-[var(--color-text-secondary)] mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
