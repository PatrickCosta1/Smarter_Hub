/// <reference types="node" />

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("1212", 10);

  const user = await prisma.user.upsert({
    where: { username: "patrick" },
    update: {
      passwordHash,
      role: "COLABORADOR"
    },
    create: {
      username: "patrick",
      email: "patrick@smarterhub.pt",
      passwordHash,
      role: "COLABORADOR",
      profile: {
        create: {
          primeiroNome: "Patrick",
          apelido: "Costa",
          nomeAbreviado: "P. Costa",
          dataNascimento: "1994-07-11",
          genero: "Masculino",
          estadoCivil: "Solteiro(a)",
          habilitacoesLiterarias: "Mestrado",
          curso: "Engenharia Informatica",
          faculdade: "ISEP",
          emailPessoal: "patrick@smarterhub.pt",
          telemovel: "+351910000000",
          moradaFiscal: "Rua do Atlantico 120, Porto",
          endereco: "Rua do Atlantico 120",
          localidade: "Porto",
          codigoPostal: "4200-500",
          matriculaCarro: "12-AB-34",
          cartaoCidadao: "15345678 1 ZZ4",
          nif: "245123890",
          niss: "12345678901",
          iban: "PT50001200001234567890154",
          situacaoIrs: "Solteiro(a), Separado(a) ou Divorciado(a), sem dependentes",
          numeroDependentes: "0",
          irsJovem: "Nao",
          anoPrimeiroDesconto: "2018",
          contactoEmergenciaNome: "Maria Costa",
          contactoEmergenciaParentesco: "Pai/Mãe",
          contactoEmergenciaNumero: "+351919887766",
          cargo: "Colaborador",
          funcao: "Operacoes",
          dataInicioContrato: "2021-09-06",
          dataFimContrato: "",
          remuneracao: "2250",
          tipoContrato: "Sem termo",
          regimeHorario: "100%"
        }
      }
    }
  });

  const notificationsCount = await prisma.notification.count({
    where: { userId: user.id }
  });

  if (notificationsCount === 0) {
    await prisma.notification.createMany({
      data: [
        {
          userId: user.id,
          title: "Bem-vindo",
          message: "Backend PostgreSQL pronto para integracao."
        },
        {
          userId: user.id,
          title: "Proximo passo",
          message: "Liga o frontend a API e testa os fluxos reais."
        }
      ]
    });
  }

  console.log("Seed concluido com sucesso.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
