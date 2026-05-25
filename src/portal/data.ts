import { MenuItem, ProfileData, UserRole } from './types';

export const roleMenus: Record<UserRole, MenuItem[]> = {
  colaborador: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
    { id: 'equipas', label: 'Equipas', path: '/equipas' },
    { id: 'formacoes', label: 'Formações', path: '/formacoes' },
    { id: 'ferias', label: 'Férias', path: '/ferias' }
  ],
  coordenador: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'equipas', label: 'Equipas', path: '/equipas' },
    { id: 'colaboradores', label: 'Colaboradores', path: '/colaboradores' },
    { id: 'aprovacoes', label: 'Aprovações', path: '/aprovacoes' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
    { id: 'formacoes', label: 'Formações', path: '/formacoes' },
    { id: 'ferias', label: 'Férias', path: '/ferias' }
  ],
  manager: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
    { id: 'equipas', label: 'Equipas', path: '/equipas' },
    { id: 'aprovacoes', label: 'Aprovações', path: '/aprovacoes' },
    { id: 'formacoes', label: 'Formações', path: '/formacoes' },
    { id: 'ferias', label: 'Férias', path: '/ferias' }
  ],
  admin: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
    { id: 'equipas', label: 'Equipas', path: '/equipas' },
    { id: 'colaboradores', label: 'Colaboradores', path: '/colaboradores' },
    { id: 'admin', label: 'Administração', path: '/admin' },
    { id: 'aprovacoes', label: 'Aprovações', path: '/aprovacoes' },
    { id: 'formacoes', label: 'Formações', path: '/formacoes' },
    { id: 'ferias', label: 'Férias', path: '/ferias' },
    { id: 'notifications', label: 'Notificações', path: '/notifications' },
  ],
  convidado: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'Onboarding', path: '/profile' },
    { id: 'notifications', label: 'Notificações', path: '/notifications' },
  ],
};

export const roleLabels: Record<UserRole, string> = {
  colaborador: 'Membro',
  manager: 'Liderança',
  coordenador: 'Liderança',
  admin: 'Administração',
  convidado: 'Acesso limitado',
};

export const situacaoIrsOptions = [
  'Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes',
  'Solteiro(a), Separado(a) ou Divorciado(a), com 1 dependente',
  'Solteiro(a), Separado(a) ou Divorciado(a), com 2 ou mais dependentes',
  'Casado(a), 1 titular, sem dependentes',
  'Casado(a), 1 titular, com 1 dependente',
  'Casado(a), 1 titular, com 2 ou mais dependentes',
  'Casado(a), 2 titulares, sem dependentes',
  'Casado(a), 2 titulares, com 1 dependente',
  'Casado(a), 2 titulares, com 2 ou mais dependentes',
  'Viuvo(a), sem dependentes',
  'Viuvo(a), com 1 dependente',
  'Viuvo(a), com 2 ou mais dependentes',
];

export const parentescoOptions = ['Pai/Mãe', 'Cônjuge', 'Filho(a)', 'Irmão/Irmã', 'Outro'];
export const habilitacoesOptions = ['12 ano', 'Licenciatura', 'Mestrado', 'Outro'];
export const generoOptions = ['Feminino', 'Masculino', 'Prefiro não indicar'];
export const estadoCivilOptions = ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)'];
export const cargoOptions = ['Colaborador', 'Especialista', 'Coordenador', 'Manager'];
export const tipoContratoOptions = ['Sem termo', 'Estágio Curricular', 'Estágio IEFP', 'Termo certo', 'Termo incerto'];
export const regimeHorarioOptions = ['10%', '20%', '50%', '100%'];
export const irsJovemOptions = ['Sim', 'Nao'];

export const initialProfileData: ProfileData = {
  nomeCompleto: '',
  nomeAbreviado: '',
  dataNascimento: '',
  genero: '',
  estadoCivil: '',
  habilitacoesLiterarias: '',
  curso: '',
  faculdade: '',
  nacionalidade: '',
  emailPessoal: '',
  telemovel: '',
  githubUser: '',
  moradaFiscal: '',
  endereco: '',
  localidade: '',
  codigoPostal: '',
  matriculaCarro: '',
  localNascimentoPais: '',
  localNascimentoCidade: '',
  nomePai: '',
  nomeMae: '',
  cartaoCidadao: '',
  validadeCartaoCidadao: '',
  nif: '',
  cpf: '',
  pis: '',
  ctps: '',
  ctpsSerie: '',
  ctpsDataExpedicao: '',
  rg: '',
  rgOrgaoEmissor: '',
  rgDataExpedicao: '',
  cnh: '',
  cnhCategoria: '',
  cnhDataValidade: '',
  tituloEleitor: '',
  zonaEleitoral: '',
  secaoEleitoral: '',
  certificadoReservista: '',
  niss: '',
  iban: '',
  situacaoIrs: '',
  numeroDependentes: '',
  declaracaoIrs: '',
  irsJovem: '',
  anoPrimeiroDesconto: '',
  primeiroEmprego: false,
  recebeAposentadoria: false,
  recebeSeguroDesemprego: false,
  valeTransporte: false,
  numeroCartaoContinente: '',
  voucherNosData: '',
  comprovativoMoradaFiscal: '',
  comprovativoCartaoCidadao: '',
  comprovativoIban: '',
  comprovativoCartaoContinente: '',
  contactoEmergenciaNome: '',
  contactoEmergenciaParentesco: '',
  contactoEmergenciaNumero: '',
  cargo: '',
  categoriaProfissional: '',
  numeroMecanografico: '',
  funcao: '',
  dataInicioContrato: '',
  dataFimContrato: '',
  tipoContrato: '',
  regimeHorario: '',
  horasSemanaisContrato: '',
  workCountry: 'PT',
  brWorkState: '',
  photoUrl: '',
  certificadoHabilitacoesUrl: '',
  cartaConducaoUrl: '',
  criminalRecordUrl: '',
};

export function detectRoleByUsername(currentUsername: string): UserRole {
  const normalized = currentUsername.trim().toLowerCase();

  if (normalized.includes('admin')) {
    return 'admin';
  }

  if (normalized.includes('manager') || normalized.includes('mgr')) {
    return 'manager';
  }

  if (normalized.includes('coord')) {
    return 'coordenador';
  }

  if (normalized.includes('guest') || normalized.includes('convidado')) {
    return 'convidado';
  }

  return 'colaborador';
}
