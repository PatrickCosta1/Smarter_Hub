import { markAdmissionCompleted, sendAdmissionCompletedEmail } from './complete-admission.service.js';

type AdmissionContractPayload = {
  companyEmail: string;
  companyUsername: string;
  cargo: string;
  categoriaProfissional: string;
  numeroMecanografico: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
  horasSemanaisContrato?: string;
};

type AdmissionSnapshot = {
  id: string;
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
  personalData: unknown;
};

type CreateManagedUserFn = (params: {
  actorUserId: string;
  username: string;
  email: string;
  fullName: string;
  role: 'COLABORADOR';
  workCountry: 'PT' | 'BR';
  profile: Record<string, unknown>;
}) => Promise<unknown>;

export async function completeAdmissionAndCreateUser(input: {
  actorUserId: string;
  admission: AdmissionSnapshot;
  contract: AdmissionContractPayload;
  derivedHourBankLimitHours?: number;
  createManagedUser: CreateManagedUserFn;
}) {
  const profile = {
    ...((input.admission.personalData as Record<string, unknown>) ?? {}),
    cargo: input.contract.cargo,
    categoriaProfissional: input.contract.categoriaProfissional,
    numeroMecanografico: input.contract.numeroMecanografico,
    funcao: input.contract.funcao,
    dataInicioContrato: input.contract.dataInicioContrato,
    dataFimContrato: input.contract.dataFimContrato,
    tipoContrato: input.contract.tipoContrato,
    regimeHorario: input.contract.regimeHorario,
    horasSemanaisContrato: input.contract.horasSemanaisContrato ?? '',
    ...(typeof input.derivedHourBankLimitHours === 'number' ? { hourBankLimitHours: input.derivedHourBankLimitHours } : {}),
    workCountry: input.admission.workCountry,
    brWorkState: input.admission.brWorkState,
  };

  const createdUser = await input.createManagedUser({
    actorUserId: input.actorUserId,
    username: input.contract.companyUsername,
    email: input.contract.companyEmail,
    fullName: input.admission.fullName,
    role: 'COLABORADOR',
    workCountry: input.admission.workCountry,
    profile,
  });

  await markAdmissionCompleted({
    admissionId: input.admission.id,
    reviewerId: input.actorUserId,
    contract: input.contract,
  });

  await sendAdmissionCompletedEmail({
    personalEmail: input.admission.personalEmail,
    fullName: input.admission.fullName,
    companyUsername: input.contract.companyUsername,
    companyEmail: input.contract.companyEmail,
  });

  return createdUser;
}
