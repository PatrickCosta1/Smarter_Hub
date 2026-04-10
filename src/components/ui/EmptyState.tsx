type EmptyStateProps = {
  title: string;
  message?: string;
};

export default function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <article className="ui-empty-state" role="status" aria-live="polite">
      <h3 className="ui-empty-state__title">{title}</h3>
      {message && <p className="ui-empty-state__message">{message}</p>}
    </article>
  );
}
