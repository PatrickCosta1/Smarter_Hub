import Button from '../ui/Button';
import Modal from '../ui/Modal';

type AdmissionSettingsFieldOption = {
  key: string;
  label: string;
  defaultRequired: boolean;
};

type AdmissionFormSettingsResponse = {
  requiredFieldsByCountry: {
    PT: string[];
    BR: string[];
  };
  availableFieldsByCountry: {
    PT: AdmissionSettingsFieldOption[];
    BR: AdmissionSettingsFieldOption[];
  };
};

type AdmissionFormSettingsModalProps = {
  open: boolean;
  settingsCountry: 'PT' | 'BR';
  settingsDraftRequiredFields: string[];
  admissionSettings: AdmissionFormSettingsResponse | null;
  isSettingsSaving: boolean;
  settingsStatus: string;
  onClose: () => void;
  onCountryChange: (country: 'PT' | 'BR') => void;
  onToggleField: (fieldKey: string) => void;
  onToggleInternshipPreset: (enabled: boolean) => void;
  onSave: () => void;
};

export default function AdmissionFormSettingsModal({
  open,
  settingsCountry,
  settingsDraftRequiredFields,
  admissionSettings,
  isSettingsSaving,
  settingsStatus,
  onClose,
  onCountryChange,
  onToggleField,
  onToggleInternshipPreset,
  onSave,
}: AdmissionFormSettingsModalProps) {
  const internshipPresetFieldKeys: Record<'PT' | 'BR', string[]> = {
    PT: ['iban', 'numeroCartaoContinente', 'comprovativoIban', 'comprovativoCartaoContinente'],
    BR: ['comprovativoIban'],
  };

  const internshipPresetFields = internshipPresetFieldKeys[settingsCountry];
  const internshipPresetEnabled = internshipPresetFields.every((fieldKey) => !settingsDraftRequiredFields.includes(fieldKey));

  return (
    <Modal
      open={open}
      title="Configurar campos obrigatórios da admissão"
      onClose={onClose}
      width="min(820px, 96vw)"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, width: '100%' }}>
          <span style={{ color: '#475569', fontSize: 13, fontWeight: 600 }}>
            {settingsCountry === 'PT' ? 'Portugal' : 'Brasil'} · {settingsDraftRequiredFields.length} campo(s) obrigatório(s)
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="button" variant="primary" onClick={onSave} disabled={isSettingsSaving}>
              {isSettingsSaving ? 'A guardar...' : 'Guardar configuração'}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 14,
          alignItems: 'start',
          padding: '14px 16px',
          border: '1px solid #dbe7f6',
          borderRadius: 12,
          background: 'linear-gradient(180deg, #ffffff, #f8fbff)',
        }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ color: '#0f172a', fontSize: 15 }}>Definição por país de trabalho</strong>
            <span style={{ color: '#475569', fontSize: 13 }}>
              Seleciona o país e ajusta rapidamente os campos obrigatórios para esse contexto.
            </span>
          </div>

          <div style={{ display: 'grid', gap: 12, minWidth: 230 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: '#1e293b', fontSize: 12, fontWeight: 700, letterSpacing: 0.2 }}>PAÍS DE TRABALHO</span>
              <select
                value={settingsCountry}
                onChange={(event) => onCountryChange(event.target.value as 'PT' | 'BR')}
                style={{
                  minHeight: 40,
                  borderRadius: 10,
                  border: '1px solid #c9d7ea',
                  padding: '0 12px',
                  color: '#0f172a',
                  background: '#ffffff',
                  fontWeight: 600,
                }}
              >
                <option value="PT">Portugal</option>
                <option value="BR">Brasil</option>
              </select>
            </label>

            <label style={{
              display: 'grid',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={internshipPresetEnabled}
                  onChange={(event) => onToggleInternshipPreset(event.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ color: '#0f172a', fontSize: 14, fontWeight: 700 }}>Estágio Curricular</span>
                </div>
              </div>
            </label>
          </div>
        </div>

        {settingsStatus ? (
          <div style={{
            borderRadius: 10,
            padding: '10px 12px',
            background: settingsStatus.toLowerCase().includes('sucesso') ? '#ecfdf5' : '#fef2f2',
            color: settingsStatus.toLowerCase().includes('sucesso') ? '#065f46' : '#991b1b',
            fontSize: 13,
            border: settingsStatus.toLowerCase().includes('sucesso') ? '1px solid #a7f3d0' : '1px solid #fecaca',
          }}>
            {settingsStatus}
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, maxHeight: '48vh', overflowY: 'auto', paddingRight: 4 }}>
          {(admissionSettings?.availableFieldsByCountry[settingsCountry] ?? []).map((field) => {
            const checked = settingsDraftRequiredFields.includes(field.key);
            return (
              <label
                key={field.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: checked ? '1px solid #86b8f4' : '1px solid #e2e8f0',
                  background: checked ? '#eff6ff' : '#ffffff',
                  borderRadius: 12,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => onToggleField(field.key)} />
                <span style={{ color: '#0f172a', fontSize: 13, lineHeight: 1.4 }}>
                  {field.label}
                  {field.defaultRequired ? <strong style={{ color: '#1d4ed8' }}> (recomendado)</strong> : null}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
