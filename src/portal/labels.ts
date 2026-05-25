export function formatRoleLabel(role: string) {
  switch (role) {
    case 'COLABORADOR':
      return 'Membro';
    case 'MANAGER':
      return 'Liderança';
    case 'COORDENADOR':
      return 'Liderança';
    case 'ADMIN':
      return 'Administração';
    case 'CONVIDADO':
      return 'Acesso limitado';
    default:
      return role;
  }
}

export function formatVacationStatusLabel(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pendente';
    case 'APPROVED':
      return 'Aprovado';
    case 'REJECTED':
      return 'Rejeitado';
    case 'CANCELLED':
      return 'Anulado';
    default:
      return status;
  }
}

export function getVacationStatusTone(status: string) {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function formatVacationTypeLabel(type: string) {
  switch (type) {
    case 'VACATION':
      return 'Férias';
    case 'ABSENCE_MEDICAL':
      return 'Ausência médica';
    case 'ABSENCE_TRAINING':
      return 'Ausência por formação';
    default:
      return type;
  }
}

export function formatTrainingStatusLabel(status?: string) {
  if (!status || status === 'CONCLUIDA') {
    return 'Concluída';
  }

  switch (status) {
    case 'ASSIGNED':
      return 'Atribuída';
    case 'EM_CURSO':
      return 'Em curso';
    case 'PENDING':
      return 'Pendente';
    case 'COMPLETED':
      return 'Concluída';
    default:
      return status;
  }
}

export function getTrainingStatusTone(status?: string) {
  if (!status || status === 'CONCLUIDA' || status === 'COMPLETED') {
    return 'approved';
  }

  switch (status) {
    case 'ASSIGNED':
    case 'EM_CURSO':
      return 'pending';
    case 'PENDING':
      return 'pending';
    default:
      return 'neutral';
  }
}

export function formatMembershipRoleLabel(role: string) {
  switch (role) {
    case 'PARTICIPANT':
      return 'Participante';
    case 'MANAGER':
      return 'Chefia';
    case 'COORDINATOR':
      return 'Coordenação';
    default:
      return role;
  }
}
