import { prisma } from '../../lib/prisma.js';

export async function getProfileOptions() {
  const customOptions = await prisma.profileDropdownOption.findMany({
    where: { isActive: true },
    select: {
      id: true,
      type: true,
      label: true,
      groupLabel: true,
    },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  });

  return {
    cargo: customOptions
      .filter((option) => option.type === 'CARGO')
      .map((option) => ({ id: option.id, label: option.label, groupLabel: option.groupLabel })),
    funcao: customOptions
      .filter((option) => option.type === 'FUNCAO')
      .map((option) => ({ id: option.id, label: option.label, groupLabel: option.groupLabel })),
  };
}
