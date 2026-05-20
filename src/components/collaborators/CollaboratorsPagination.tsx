import Button from '../ui/Button';

type CollaboratorsPaginationProps = {
  visibleTotal: number;
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

export default function CollaboratorsPagination({
  visibleTotal,
  page,
  totalPages,
  onPreviousPage,
  onNextPage,
}: CollaboratorsPaginationProps) {
  return (
    <div className="trainings-form-actions trainings-form-actions--between">
      <small>Resultados: {visibleTotal}</small>
      <div className="trainings-form-actions__group">
        <Button type="button" variant="ghost" onClick={onPreviousPage} disabled={page <= 1}>Anterior</Button>
        <Button type="button" variant="ghost" onClick={onNextPage} disabled={page >= totalPages}>Seguinte</Button>
      </div>
    </div>
  );
}
