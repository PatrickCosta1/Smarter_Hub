#!/usr/bin/env node

import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const sourceFile = path.join(root, 'docs', 'PC2', 'gantt_chart_pc2.xlsx');
const outputArg = process.argv[2];
const targetFile = outputArg
  ? path.resolve(root, outputArg)
  : path.join(root, 'docs', 'PC3', 'gantt_chart_pc3.xlsx');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(sourceFile);

const gantt = workbook.getWorksheet('Gantt Corrigido');
const notes = workbook.getWorksheet('Notas');

if (!gantt) {
  throw new Error('Folha "Gantt Corrigido" não encontrada no ficheiro PC2.');
}

// Atualiza o título mantendo o mesmo layout do template original.
for (let col = 2; col <= 74; col += 1) {
  gantt.getRow(1).getCell(col).value = 'SMARTER HUB — Plano Atualizado PROES 2025/2026 (PC3)';
}

const setTask = (rowNumber, updates) => {
  const row = gantt.getRow(rowNumber);
  if (updates.task !== undefined) row.getCell(2).value = updates.task;
  if (updates.type !== undefined) row.getCell(3).value = updates.type;
  if (updates.owner !== undefined) row.getCell(4).value = updates.owner;
  if (updates.start !== undefined) row.getCell(5).value = new Date(updates.start);
  if (updates.end !== undefined) row.getCell(6).value = new Date(updates.end);
  if (updates.duration !== undefined) row.getCell(7).value = updates.duration;
  if (updates.progress !== undefined) row.getCell(8).value = updates.progress;
  if (updates.predecessors !== undefined) row.getCell(9).value = updates.predecessors;
  if (updates.deliverable !== undefined) row.getCell(10).value = updates.deliverable;
};

const businessDaysInclusive = (startISO, endISO) => {
  const start = new Date(startISO);
  const end = new Date(endISO);
  let days = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
};

// Snapshot até 22/05/2026: continuidade do plano do PC2 com atualização de progresso real.
setTask(5, {
  progress: 0.56,
  deliverable: 'Plano global atualizado ao estado PC3 (22/05/2026)'
});

setTask(21, {
  progress: 1,
  deliverable: 'PC3 entregue (estado consolidado em 22/05)'
});

setTask(22, {
  task: 'Desenvolvimento da Solução (escopo PC3)',
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-04-22', '2026-05-22'),
  progress: 1,
  deliverable: 'Escopo de desenvolvimento do PC3 concluido e validado em 22/05'
});

setTask(23, {
  progress: 1,
  deliverable: 'Base tecnica, autenticacao local/OAuth e sessao estaveis'
});

setTask(24, {
  progress: 1,
  deliverable: 'Ficha de colaborador, alteracoes e aprovacoes implementadas'
});

setTask(25, {
  progress: 1,
  deliverable: 'Ferias/ausencias PT-BR com validacoes e exportacao XLSX'
});

setTask(26, {
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-12', '2026-05-22'),
  progress: 1,
  deliverable: 'Workflow multi-nivel com versionamento e regras PT/BR ativo'
});

setTask(27, {
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-15', '2026-05-22'),
  progress: 1,
  deliverable: 'Permissoes, acesso total e trilho de auditoria funcionais'
});

setTask(28, {
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-19', '2026-05-22'),
  progress: 1,
  deliverable: 'Notificacoes persistentes com leitura individual e em lote'
});

setTask(29, {
  task: 'Banco de horas (BR), plano de carreira e admissoes',
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-22', '2026-05-22'),
  progress: 1,
  deliverable: 'Banco de horas com PDF semanal, carreira basica e onboarding ativos'
});

setTask(30, {
  task: 'Saude e bem-estar, internacionalizacao e assistente interno',
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-22', '2026-05-22'),
  progress: 1,
  deliverable: 'I18n PT-PT/PT-BR concluido; wellness e assistente em expansao controlada'
});

setTask(31, {
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-04', '2026-05-22'),
  progress: 1,
  deliverable: 'Suite de testes unitarios/integracao consolidada e E2E em evolucao'
});

setTask(32, {
  end: '2026-05-22',
  duration: businessDaysInclusive('2026-05-04', '2026-05-22'),
  progress: 1,
  deliverable: 'Documentacao PROES e especificacao funcional alinhadas ao codigo'
});

setTask(34, {
  progress: 0.2,
  deliverable: 'Consolidacao iniciada com backlog de refinamento para PC4+'
});

setTask(35, { progress: 0 });
setTask(36, { progress: 0 });
setTask(37, { progress: 0 });
setTask(38, { progress: 0 });
setTask(39, { progress: 0 });
setTask(40, { progress: 0 });

if (notes) {
  notes.getCell('A1').value = 'Notas da versão PC3 (continuação do PC2)';
  notes.getCell('A3').value = '1. Este ficheiro é uma continuação direta do template PC2, mantendo estrutura, layout e milestones.';
  notes.getCell('A4').value = '2. O progresso foi atualizado para snapshot de 22/05/2026 com base em evidências reais do sistema.';
  notes.getCell('A5').value = '3. Foram atualizadas tarefas de desenvolvimento para refletir adições do PC3 (banco de horas, carreira, admissoes, i18n).';
  notes.getCell('A6').value = '4. O marco PC3 foi marcado como concluído; PC4/PC5 mantêm-se planeados para fases seguintes.';
  notes.getCell('A7').value = '5. Mantém-se a fase de consolidação para refinamentos pós-piloto e hardening final.';
}

await workbook.xlsx.writeFile(targetFile);
console.log(`✅ Ficheiro atualizado por continuidade: ${targetFile}`);
