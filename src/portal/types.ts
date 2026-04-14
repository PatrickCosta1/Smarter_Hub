export type UserRole = 'colaborador' | 'manager' | 'coordenador' | 'admin' | 'convidado';

export type PortalPage = 'home' | 'profile' | 'perfil' | 'notifications' | 'aprovacoes' | 'equipas' | 'formacoes' | 'ferias' | 'recibos' | 'admin' | 'colaboradores';

export type MenuItem = {
  id: string;
  label: string;
  path: string;
};

export type ProfileData = {
  primeiroNome: string;
  apelido: string;
  nomeAbreviado: string;
  dataNascimento: string;
  genero: string;
  estadoCivil: string;
  habilitacoesLiterarias: string;
  curso: string;
  faculdade: string;
  emailPessoal: string;
  telemovel: string;
  moradaFiscal: string;
  endereco: string;
  localidade: string;
  codigoPostal: string;
  matriculaCarro: string;
  cartaoCidadao: string;
  nif: string;
  niss: string;
  iban: string;
  situacaoIrs: string;
  numeroDependentes: string;
  irsJovem: string;
  anoPrimeiroDesconto: string;
  numeroCartaoContinente: string;
  voucherNosData: string;
  comprovativoMoradaFiscal: string;
  comprovativoCartaoCidadao: string;
  comprovativoIban: string;
  comprovativoCartaoContinente: string;
  contactoEmergenciaNome: string;
  contactoEmergenciaParentesco: string;
  contactoEmergenciaNumero: string;
  cargo: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  remuneracao: string;
  tipoContrato: string;
  regimeHorario: string;
  workCountry: 'PT' | 'BR';
};

export type ProfileFieldError = Partial<Record<keyof ProfileData, string>>;

export type PortalNotification = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isActive?: boolean;
  isRootAccess?: boolean;
  hasAccessTotal?: boolean;
  team?: {
    id: string;
    name: string;
  } | null;
};
