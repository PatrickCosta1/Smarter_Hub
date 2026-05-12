import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Language, useLanguage } from '../contexts/LanguageContext';

interface LangOption {
  code: Language;
  label: string;
  flag: string;
}

const LANGUAGES: LangOption[] = [
  { code: 'pt-PT', label: 'Portugal', flag: '🇵🇹' },
  { code: 'pt-BR', label: 'Brasil', flag: '🇧🇷' },
];

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  /** Fechar ao clicar fora */
  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedDropdown = dropdownRef.current?.contains(target);
      if (!clickedTrigger && !clickedDropdown) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  /** Fechar com Escape */
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dropdownWidth = dropdownRef.current?.offsetWidth ?? 160;
      const left = Math.max(8, rect.right - dropdownWidth);
      const top = rect.bottom + 6;
      setDropdownPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const selectLanguage = (code: Language) => {
    setLanguage(code);
    setOpen(false);
  };

  return (
    <div className="language-switcher" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="language-switcher__trigger icon-button icon-button--header"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Idioma: ${current.label}`}
        onClick={() => setOpen((prev) => !prev)}
        title={`Idioma: ${current.label}`}
      >
        <span className="language-switcher__flag" aria-hidden="true">
          {current.flag}
        </span>
        <span className="language-switcher__code">{current.code === 'pt-PT' ? 'PT' : 'BR'}</span>
      </button>

      {open && createPortal(
        <ul
          ref={dropdownRef}
          className="language-switcher__dropdown"
          role="listbox"
          aria-label="Selecionar idioma"
          style={{
            position: 'fixed',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            zIndex: 2147483647,
          }}
        >
          {LANGUAGES.map((lang) => (
            <li
              key={lang.code}
              role="option"
              aria-selected={lang.code === language}
              className={`language-switcher__option${lang.code === language ? ' language-switcher__option--active' : ''}`}
              onClick={() => selectLanguage(lang.code)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') selectLanguage(lang.code);
              }}
              tabIndex={0}
            >
              <span className="language-switcher__flag" aria-hidden="true">
                {lang.flag}
              </span>
              <span className="language-switcher__option-label">{lang.label}</span>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
