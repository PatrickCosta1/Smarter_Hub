import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const optionalStringField = z.union([z.string(), z.null()]).transform((value) => value ?? '').optional();

const updateProfileSchema = z.object({
  primeiroNome: optionalStringField,
  apelido: optionalStringField,
  nomeAbreviado: optionalStringField,
  dataNascimento: optionalStringField,
  genero: optionalStringField,
  estadoCivil: optionalStringField,
  habilitacoesLiterarias: optionalStringField,
  curso: optionalStringField,
  faculdade: optionalStringField,
  emailPessoal: optionalStringField,
  telemovel: optionalStringField,
  moradaFiscal: optionalStringField,
  endereco: optionalStringField,
  localidade: optionalStringField,
  codigoPostal: optionalStringField,
  matriculaCarro: optionalStringField,
  cartaoCidadao: optionalStringField,
  nif: optionalStringField,
  niss: optionalStringField,
  iban: optionalStringField,
  situacaoIrs: optionalStringField,
  numeroDependentes: optionalStringField,
  irsJovem: optionalStringField,
  anoPrimeiroDesconto: optionalStringField,
  numeroCartaoContinente: optionalStringField,
  voucherNosData: optionalStringField,
  comprovativoMoradaFiscal: optionalStringField,
  comprovativoCartaoCidadao: optionalStringField,
  comprovativoIban: optionalStringField,
  comprovativoCartaoContinente: optionalStringField,
  contactoEmergenciaNome: optionalStringField,
  contactoEmergenciaParentesco: optionalStringField,
  contactoEmergenciaNumero: optionalStringField,
  cargo: optionalStringField,
  funcao: optionalStringField,
  dataInicioContrato: optionalStringField,
  dataFimContrato: optionalStringField,
  remuneracao: optionalStringField,
  tipoContrato: optionalStringField,
  regimeHorario: optionalStringField
});

router.get("/profile/me", requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const profile = await prisma.profile.findUnique({
    where: { userId }
  });

  if (!profile) {
    return res.status(404).json({ message: "Perfil nao encontrado." });
  }

  return res.json(profile);
});

router.put("/profile/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.authUser!.id;
    const data = updateProfileSchema.parse(req.body);

    const profile = await prisma.profile.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        ...data
      }
    });

    return res.json(profile);
  } catch (error) {
    return next(error);
  }
});

export { router as profileRouter };
