export function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export const MICROCOPY = {
  accountAccess: {
    loadError: 'Não foi possível carregar os dados da conta.',
    microsoftOnlyInfo: 'A autenticação é feita exclusivamente com Microsoft.',
  },
  notifications: {
    markAllReadSuccess: 'Notificações marcadas como lidas com sucesso.',
    markAllReadError: 'Não foi possível marcar as notificações como lidas.',
    markReadSuccess: 'Notificação marcada como lida com sucesso.',
    markReadError: 'Não foi possível marcar a notificação como lida.',
    deleteAllSuccess: 'Notificações apagadas com sucesso.',
    deleteAllError: 'Não foi possível apagar as notificações.',
    deleteOneSuccess: 'Notificação apagada com sucesso.',
    deleteOneError: 'Não foi possível apagar a notificação.',
  },
  approvals: {
    loadRequestsError: 'Não foi possível carregar os pedidos.',
    approveProfileSuccess: (name: string) => `Pedido de ${name} aprovado com sucesso.`,
    approveProfileError: 'Não foi possível aprovar o pedido de alteração de ficha.',
    rejectProfileSuccess: (name: string) => `Pedido de ${name} rejeitado com sucesso.`,
    rejectProfileError: 'Não foi possível rejeitar o pedido de alteração de ficha.',
    approveVacationSuccess: (name: string) => `Pedido de ${name} aprovado com sucesso.`,
    approveVacationError: 'Não foi possível aprovar o pedido de férias/ausência.',
    rejectVacationSuccess: (name: string) => `Pedido de ${name} rejeitado com sucesso.`,
    rejectVacationError: 'Não foi possível rejeitar o pedido de férias/ausência.',
  },
} as const;
