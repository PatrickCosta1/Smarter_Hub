export type UserRole = 'colaborador' | 'manager' | 'coordenador' | 'admin' | 'convidado';

export type PortalPage = 'home' | 'profile' | 'perfil' | 'notifications' | 'aprovacoes' | 'equipas' | 'formacoes' | 'ferias' | 'banco-horas' | 'admin' | 'colaboradores';

export type MenuItem = {
  id: string;
  label: string;
  path: string;
};

export type ProfileData = {
  nomeCompleto: string;
  nomeAbreviado: string;
  dataNascimento: string;
  genero: string;
  estadoCivil: string;
  habilitacoesLiterarias: string;
  curso: string;
  faculdade: string;
  nacionalidade: string;
  emailPessoal: string;
  telemovel: string;
  githubUser: string;
  moradaFiscal: string;
  endereco: string;
  localidade: string;
  codigoPostal: string;
  matriculaCarro: string;
  localNascimentoPais: string;
  localNascimentoCidade: string;
  nomePai: string;
  nomeMae: string;
  cartaoCidadao: string;
  validadeCartaoCidadao: string;
  nif: string;
  cpf: string;
  pis: string;
  ctps: string;
  ctpsSerie: string;
  ctpsDataExpedicao: string;
  rg: string;
  rgOrgaoEmissor: string;
  rgDataExpedicao: string;
  cnh: string;
  cnhCategoria: string;
  cnhDataValidade: string;
  tituloEleitor: string;
  zonaEleitoral: string;
  secaoEleitoral: string;
  certificadoReservista: string;
  niss: string;
  iban: string;
  situacaoIrs: string;
  numeroDependentes: string;
  declaracaoIrs: string;
  irsJovem: string;
  anoPrimeiroDesconto: string;
  primeiroEmprego: boolean;
  recebeAposentadoria: boolean;
  recebeSeguroDesemprego: boolean;
  valeTransporte: boolean;
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
  categoriaProfissional: string;
  numeroMecanografico: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
  workCountry: 'PT' | 'BR';
  brWorkState: '' | 'SP' | 'RS';
  photoUrl: string;
  certificadoHabilitacoesUrl: string;
  cartaConducaoUrl: string;
  criminalRecordUrl: string;
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
    costCenter?: string | null;
  } | null;
};
