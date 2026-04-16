const fs = require('fs');
const path = require('path');

// Target files for frontend migration
const targetDir = path.join(__dirname, '../src');
const files = [
  path.join(targetDir, 'pages/ProfilePage.tsx'),
  path.join(targetDir, 'pages/AdminPage.tsx'),
  path.join(targetDir, 'pages/ManagerTeamsPage.tsx'),
  path.join(targetDir, 'pages/CollaboratorsPage.tsx'),
  path.join(targetDir, 'pages/HomePage.tsx'),
  path.join(targetDir, 'pages/TrainingsPage.tsx'),
  path.join(targetDir, 'pages/PermissionsPage.tsx'),
  path.join(targetDir, 'pages/RHApprovalsPage.tsx'),
];

files.forEach((file) => {
  if (!fs.existsSync(file)) {
    console.log(`Skipping (not found): ${file}`);
    return;
  }

  let content = fs.readFileSync(file, 'utf-8');

  // Replace type definitions: primeiroNome?: string; apelido?: string; -> nomeCompleto?: string;
  content = content.replace(
    /primeiroNome\?:\s*string;\s*apelido\?:\s*string;/g,
    'nomeCompleto?: string;'
  );

  // Replace field labels: 'primeiroNome': 'Primeiro nome', 'apelido': 'Apelido' -> 'nomeCompleto': 'Nome completo'
  content = content.replace(
    /primeiroNome:\s*['"]Primeiro nome['"],\s*apelido:\s*['"]Apelido['"],/g,
    "nomeCompleto: 'Nome completo',"
  );

  // Replace in arrays: 'primeiroNome', 'apelido', -> 'nomeCompleto',
  content = content.replace(
    /'primeiroNome',\s*'apelido',/g,
    "'nomeCompleto',"
  );

  // Replace concatenations: `${user?.profile?.primeiroNome ?? ''} ${user?.profile?.apelido ?? ''}` -> user?.profile?.nomeCompleto ?? ''
  content = content.replace(
    /\$\{[^}]*\.profile\?\.primeiroNome\s*\?\?\s*['"]\1['"]\}\s*\$\{[^}]*\.profile\?\.apelido\s*\?\?\s*['"]\1['"] \}/g,
    (match) => {
      // Handle variations with quotes
      return match.replace(/\${[^}]*\.profile\?\.primeiroNome[^}]*}\s*\$\{[^}]*\.profile\?\.apelido[^}]*\}/g, "${item?.profile?.nomeCompleto ?? ''}");
    }
  );

  // Simpler concatenation patterns
  content = content.replace(
    /`\$\{([^}]+)\.profile\?\.primeiroNome\s*\?\?\s*['"]['"]\}\s*\$\{([^}]+)\.profile\?\.apelido\s*\?\?\s*['"]['"]\}`\.trim\(\)/g,
    (match, p1) => `${p1}?.profile?.nomeCompleto ?? ''`
  );

  // Handle: const first = input.profile?.primeiroNome?.trim() || ''; const last = input.profile?.apelido?.trim() || '';
  // Replace with: const fullName = input.profile?.nomeCompleto?.trim() || '';
  content = content.replace(
    /const first = ([^;]+)\.profile\?\.primeiroNome\?\.trim\(\) \|\| [''];\s*const last = ([^;]+)\.profile\?\.apelido\?\.trim\(\) \|\| [''];/g,
    (match, p1, p2) => {
      if (p1.trim() === p2.trim()) {
        return `const fullName = ${p1}?.profile?.nomeCompleto?.trim() || '';`;
      }
      return match;
    }
  );

  // Replace in handleProfileChange or similar: handleProfileChange('primeiroNome', ...) -> handleProfileChange('nomeCompleto', ...)
  content = content.replace(
    /handleProfileChange\(['"]primeiroNome['"]/g,
    "handleProfileChange('nomeCompleto'"
  );

  content = content.replace(
    /handleProfileChange\(['"]apelido['"]/g,
    "handleProfileChange('nomeAbreviado'"
  );

  // draftProfile.primeiroNome -> draftProfile.nomeCompleto
  content = content.replace(
    /draftProfile\.primeiroNome/g,
    'draftProfile.nomeCompleto'
  );

  content = content.replace(
    /draftProfile\.apelido/g,
    'draftProfile.nomeAbreviado'
  );

  // In form inputs: value={draftProfile.primeiroNome} -> value={draftProfile.nomeCompleto}
  content = content.replace(
    /value=\{draftProfile\.primeiroNome\}/g,
    '{draftProfile.nomeCompleto}'
  );

  content = content.replace(
    /value=\{draftProfile\.apelido\}/g,
    '{draftProfile.nomeAbreviado}'
  );

  // In error displays: profileErrors.primeiroNome -> profileErrors.nomeCompleto
  content = content.replace(
    /profileErrors\.primeiroNome/g,
    'profileErrors.nomeCompleto'
  );

  content = content.replace(
    /profileErrors\.apelido/g,
    'profileErrors.nomeAbreviado'
  );

  // Replace useMemo dependencies
  content = content.replace(
    /\[draftProfile\.apelido, draftProfile\.primeiroNome\]/g,
    '[draftProfile.nomeCompleto, draftProfile.nomeAbreviado]'
  );

  fs.writeFileSync(file, content, 'utf-8');
  console.log(`Updated: ${file}`);
});

console.log('Frontend migration complete!');
