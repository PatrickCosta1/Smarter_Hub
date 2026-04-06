import { MenuItem, ProfileData, UserRole } from './types';

export const roleMenus: Record<UserRole, MenuItem[]> = {
  colaborador: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
    { id: 'formacoes', label: 'Formações', path: '/formacoes' },
    { id: 'ferias', label: 'Férias', path: '/ferias' },
    { id: 'recibos', label: 'Recibos', path: '/recibos' }
  ],
  coordenador: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' }
  ],
  rh: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
  ],
  admin: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'A Minha Ficha', path: '/profile' },
  ],
  convidado: [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'profile', label: 'Onboarding', path: '/profile' },
  ],
};

export const roleLabels: Record<UserRole, string> = {
  colaborador: 'Colaborador',
  coordenador: 'Coordenador',
  rh: 'RH',
  admin: 'Admin',
  convidado: 'Convidado',
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
export const cargoOptions = ['Colaborador', 'Especialista', 'Coordenador', 'RH', 'Manager'];
export const tipoContratoOptions = ['Sem termo', 'Estágio Curricular', 'Estágio IEFP', 'Termo certo', 'Termo incerto'];
export const regimeHorarioOptions = ['10%', '20%', '50%', '100%'];
export const irsJovemOptions = ['Sim', 'Nao'];

export const initialProfileData: ProfileData = {
  primeiroNome: 'Patricia',
  apelido: 'Silva',
  nomeAbreviado: 'P. Silva',
  dataNascimento: '1994-07-11',
  genero: 'Feminino',
  estadoCivil: 'Casado(a)',
  habilitacoesLiterarias: 'Mestrado',
  curso: 'Engenharia Informatica',
  faculdade: 'ISEP',
  emailPessoal: 'patricia.silva@gmail.com',
  telemovel: '+351912345678',
  moradaFiscal: 'Rua do Atlantico 120, Porto',
  endereco: 'Rua do Atlantico 120',
  localidade: 'Porto',
  codigoPostal: '4200-500',
  matriculaCarro: '12-AB-34',
  cartaoCidadao: '15345678 1 ZZ4',
  nif: '245123890',
  niss: '12345678901',
  iban: 'PT50001200001234567890154',
  situacaoIrs: 'Casado(a), 1 titular, com 1 dependente',
  numeroDependentes: '1',
  irsJovem: 'Nao',
  anoPrimeiroDesconto: '2018',
  numeroCartaoContinente: '',
  voucherNosData: '',
  comprovativoMoradaFiscal: '',
  comprovativoCartaoCidadao: '',
  comprovativoIban: '',
  comprovativoCartaoContinente: '',
  contactoEmergenciaNome: 'Miguel Silva',
  contactoEmergenciaParentesco: 'Cônjuge',
  contactoEmergenciaNumero: '+351919887766',
  cargo: 'Coordenador',
  funcao: 'Coordenacao de operacoes e equipas',
  dataInicioContrato: '2021-09-06',
  dataFimContrato: '',
  remuneracao: '2250',
  tipoContrato: 'Sem termo',
  regimeHorario: '100%',
};

export function detectRoleByUsername(currentUsername: string): UserRole {
  const normalized = currentUsername.trim().toLowerCase();

  if (normalized.includes('admin')) {
    return 'admin';
  }

  if (normalized.includes('rh')) {
    return 'rh';
  }

  if (normalized.includes('coord')) {
    return 'coordenador';
  }

  if (normalized.includes('guest') || normalized.includes('convidado')) {
    return 'convidado';
  }

  return 'colaborador';
}
