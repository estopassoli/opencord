import type { ReactNode } from 'react';
import './settings.css';
import '../admin/admin.css';
import '../admin/server-settings.css';

/** Seção com título dentro de um painel. */
export function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {description && <p className="muted small settings-desc">{description}</p>}
      {children}
    </section>
  );
}
