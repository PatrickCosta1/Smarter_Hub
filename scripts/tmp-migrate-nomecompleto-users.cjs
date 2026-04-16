const fs = require('fs');

const p = 'backend/src/routes/users.ts';
let s = fs.readFileSync(p, 'utf8');

s = s.replace(/nomeAbreviado: true,\s*primeiroNome: true,\s*apelido: true,/g, 'nomeAbreviado: true, nomeCompleto: true,');
s = s.replace(/primeiroNome: true,\s*apelido: true,/g, 'nomeCompleto: true,');
s = s.replace(/primeiroNome: user\.profile\.primeiroNome,\s*apelido: user\.profile\.apelido,/g, 'nomeCompleto: user.profile.nomeCompleto,');
s = s.replace(/\.\.\.\(data\.primeiroNome !== undefined \? \{ primeiroNome: data\.primeiroNome \} : \{\}\),\s*\.\.\.\(data\.apelido !== undefined \? \{ apelido: data\.apelido \} : \{\}\),/g, '...(data.nomeCompleto !== undefined ? { nomeCompleto: data.nomeCompleto } : {}),');

fs.writeFileSync(p, s, 'utf8');
