import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const updateProfileSchema = z.object({
  primeiroNome: z.string(),
  apelido: z.string(),
  nomeAbreviado: z.string(),
  dataNascimento: z.string(),
  genero: z.string(),
  estadoCivil: z.string(),
  habilitacoesLiterarias: z.string(),
  curso: z.string(),
  faculdade: z.string(),
  emailPessoal: z.string(),
  telemovel: z.string(),
  moradaFiscal: z.string(),
  endereco: z.string(),
  localidade: z.string(),
  codigoPostal: z.string(),
  matriculaCarro: z.string(),
  cartaoCidadao: z.string(),
  nif: z.string(),
  niss: z.string(),
  iban: z.string(),
  situacaoIrs: z.string(),
  numeroDependentes: z.string(),
  irsJovem: z.string(),
  anoPrimeiroDesconto: z.string(),
  numeroCartaoContinente: z.string(),
  voucherNosData: z.string(),
  comprovativoMoradaFiscal: z.string(),
  comprovativoCartaoCidadao: z.string(),
  comprovativoIban: z.string(),
  comprovativoCartaoContinente: z.string(),
  contactoEmergenciaNome: z.string(),
  contactoEmergenciaParentesco: z.string(),
  contactoEmergenciaNumero: z.string(),
  cargo: z.string(),
  funcao: z.string(),
  dataInicioContrato: z.string(),
  dataFimContrato: z.string(),
  remuneracao: z.string(),
  tipoContrato: z.string(),
  regimeHorario: z.string()
}).partial();

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
