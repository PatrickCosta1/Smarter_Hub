#!/usr/bin/env node

import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Date utilities
const dateRange = (start, end) => {
  const diff = Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
  return diff;
};

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Gantt PC3');

// Set column widths
sheet.columns = [
  { header: 'Bloco', key: 'bloco', width: 30 },
  { header: 'Tarefa', key: 'tarefa', width: 40 },
  { header: 'Início', key: 'inicio', width: 12 },
  { header: 'Fim', key: 'fim', width: 12 },
  { header: 'Duração (dias)', key: 'duracao', width: 15 },
  { header: 'Status', key: 'status', width: 12 }
];

// Add header styling
const headerRow = sheet.getRow(1);
headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1856B8' } };

// Planning blocks
const blocks = [
  {
    name: 'Iniciação e Arranque',
    startDate: '2026-04-07',
    endDate: '2026-04-15',
    status: '100%',
    tasks: [
      { name: 'Onboarding e integração', start: '2026-04-07', end: '2026-04-10', status: '100%' },
      { name: 'Formação contexto Tlantic', start: '2026-04-08', end: '2026-04-15', status: '100%' },
      { name: 'Levantamento do problema', start: '2026-04-10', end: '2026-04-15', status: '100%' }
    ]
  },
  {
    name: 'Planeamento Inicial',
    startDate: '2026-04-16',
    endDate: '2026-05-01',
    status: '100%',
    tasks: [
      { name: 'Definição backlog inicial', start: '2026-04-16', end: '2026-04-20', status: '100%' },
      { name: 'Estrutura documental', start: '2026-04-16', end: '2026-04-25', status: '100%' },
      { name: 'Setup repositório e infra', start: '2026-04-21', end: '2026-04-25', status: '100%' },
      { name: 'PC2 - Entrega planeamento', start: '2026-04-26', end: '2026-05-01', status: '100%' }
    ]
  },
  {
    name: 'Análise, Desenho e Arquitetura',
    startDate: '2026-04-22',
    endDate: '2026-05-22',
    status: '100%',
    tasks: [
      { name: 'Análise requisitos férias/ausências', start: '2026-04-22', end: '2026-05-01', status: '100%' },
      { name: 'Análise requisitos permissões/RBAC', start: '2026-04-24', end: '2026-05-05', status: '100%' },
      { name: 'Análise requisitos banco horas BR', start: '2026-05-01', end: '2026-05-10', status: '100%' },
      { name: 'Análise requisitos plano carreira', start: '2026-05-02', end: '2026-05-08', status: '100%' },
      { name: 'Análise requisitos admissões', start: '2026-05-03', end: '2026-05-10', status: '100%' },
      { name: 'Desenho funcional e UX', start: '2026-05-01', end: '2026-05-15', status: '100%' },
      { name: 'Arquitetura técnica e BD', start: '2026-05-08', end: '2026-05-18', status: '100%' },
      { name: 'Definição de API e contratos', start: '2026-05-12', end: '2026-05-22', status: '100%' }
    ]
  },
  {
    name: 'Desenvolvimento da Solução',
    startDate: '2026-04-22',
    endDate: '2026-06-12',
    status: '95%',
    tasks: [
      { name: 'Implementação autenticação', start: '2026-04-22', end: '2026-05-01', status: '100%' },
      { name: 'Implementação perfil e alterações', start: '2026-04-28', end: '2026-05-08', status: '100%' },
      { name: 'Implementação férias PT/BR', start: '2026-04-29', end: '2026-05-18', status: '100%' },
      { name: 'Implementação permissões e acesso total', start: '2026-05-01', end: '2026-05-12', status: '100%' },
      { name: 'Implementação notificações', start: '2026-05-02', end: '2026-05-10', status: '100%' },
      { name: 'Implementação equipas e hierarquia', start: '2026-05-03', end: '2026-05-10', status: '100%' },
      { name: 'Implementação banco de horas (BR)', start: '2026-05-05', end: '2026-05-15', status: '100%' },
      { name: 'Implementação plano de carreira', start: '2026-05-06', end: '2026-05-12', status: '100%' },
      { name: 'Implementação processo de admissões', start: '2026-05-07', end: '2026-05-16', status: '100%' },
      { name: 'Implementação formações', start: '2026-05-08', end: '2026-05-14', status: '100%' },
      { name: 'Implementação dashboard', start: '2026-05-10', end: '2026-05-18', status: '100%' },
      { name: 'Internacionalização PT-PT/PT-BR', start: '2026-05-12', end: '2026-05-20', status: '100%' },
      { name: 'Testes unitários e integração', start: '2026-05-01', end: '2026-05-22', status: '95%' },
      { name: 'Testes E2E (Playwright)', start: '2026-05-15', end: '2026-05-22', status: '85%' },
      { name: 'Relatórios semanal de horas (PDF)', start: '2026-05-18', end: '2026-05-22', status: '100%' },
      { name: 'Exportação XLSX férias/calendário', start: '2026-05-19', end: '2026-05-22', status: '100%' }
    ]
  },
  {
    name: 'Consolidação e Fecho',
    startDate: '2026-06-15',
    endDate: '2026-07-03',
    status: '20%',
    tasks: [
      { name: 'Refinamentos pós-piloto', start: '2026-06-15', end: '2026-06-25', status: '0%' },
      { name: 'Correção de bugs críticos', start: '2026-06-20', end: '2026-06-28', status: '0%' },
      { name: 'Otimizações de performance', start: '2026-06-24', end: '2026-06-30', status: '0%' },
      { name: 'Preparação apresentação e defesa', start: '2026-06-28', end: '2026-07-03', status: '0%' }
    ]
  }
];

let rowNumber = 2;

// Add data
blocks.forEach((block) => {
  // Block header
  const blockRow = sheet.addRow({
    bloco: block.name,
    inicio: new Date(block.startDate),
    fim: new Date(block.endDate),
    duracao: dateRange(block.startDate, block.endDate),
    status: block.status
  });

  blockRow.font = { bold: true, size: 11 };
  blockRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6FA' } };

  // Tasks
  block.tasks.forEach((task) => {
    const taskRow = sheet.addRow({
      tarefa: `  └─ ${task.name}`,
      inicio: new Date(task.start),
      fim: new Date(task.end),
      duracao: dateRange(task.start, task.end),
      status: task.status
    });

    // Color code status
    const statusCell = taskRow.getCell('status');
    if (task.status === '100%') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      statusCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    } else if (task.status === '95%' || task.status === '85%') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE07B00' } };
      statusCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    } else {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90A4AE' } };
      statusCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    }
  });

  rowNumber += block.tasks.length + 1;
});

// Format date columns
sheet.columns.forEach((col) => {
  if (col.key === 'inicio' || col.key === 'fim') {
    col.numFmt = 'dd/mm/yyyy';
  }
});

// Write file
const outputPath = join(__dirname, '..', 'docs', 'PC3', 'gantt_chart_pc3.xlsx');
await workbook.xlsx.writeFile(outputPath);

console.log(`✅ Gantt chart PC3 created: ${outputPath}`);
