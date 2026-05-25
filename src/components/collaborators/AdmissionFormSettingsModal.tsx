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
  onSave,
}: AdmissionFormSettingsModalProps) {
  return (
    <Modal
      open={open}
      title="Configurar campos obrigatórios da admissão"
      onClose={onClose}
      width="min(980px, 96vw)"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, width: '100%' }}>
          <span style={{ color: '#475569', fontSize: 13, fontWeight: 600 }}>
            {settingsCountry === 'PT' ? 'Portugal' : 'Brasil'} · {settingsDraftRequiredFields.length} campo(s) obrigatório(s)
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="button" variant="primary" onClick={onSave} disabled={isSettingsSaving}>
              {isSettingsSaving ? 'A guardar...' : 'Guardar configuração'}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 14,
          alignItems: 'end',
          padding: '14px 16px',
          border: '1px solid #dbe7f6',
          borderRadius: 12,
          background: 'linear-gradient(180deg, #ffffff, #f8fbff)',
        }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ color: '#0f172a', fontSize: 15 }}>Definição por país de trabalho</strong>
            <span style={{ color: '#475569', fontSize: 13 }}>
              Selecione o país para configurar apenas os campos que existem na ficha desse contexto.
            </span>
          </div>

          <label style={{ display: 'grid', gap: 6, minWidth: 220 }}>
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
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12, maxHeight: '52vh', overflowY: 'auto', paddingRight: 4 }}>
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
                  padding: '11px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => onToggleField(field.key)} />
                <span style={{ color: '#0f172a', fontSize: 14, lineHeight: 1.4 }}>
                  {field.label}
                  {field.defaultRequired ? <strong style={{ color: '#1d4ed8' }}> (recomendado)</strong> : null}
                </span>
              </label>
            );
          })}
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
      </div>
    </Modal>
  );
}
