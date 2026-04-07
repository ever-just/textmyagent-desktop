interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  const paddings = { sm: 'p-3', md: 'p-4', lg: 'p-6' };
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] ${paddings[padding]} ${className}`}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
}

export function StatCard({ label, value, subtitle, icon }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[12px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
          {subtitle && <p className="text-[12px] text-[var(--color-text-tertiary)] mt-0.5">{subtitle}</p>}
        </div>
        {icon && <div className="text-[var(--color-text-tertiary)]" aria-hidden="true">{icon}</div>}
      </div>
    </Card>
  );
}
