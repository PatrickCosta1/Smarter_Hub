import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { translateToBrazilian, translateWithLibreTranslate } from '../lib/translationService';
import { activateBrazilianTranslation, deactivateBrazilianTranslation } from '../lib/domTranslator';

export type Language = 'pt-PT' | 'pt-BR';

interface LanguageContextType {
  /** Variante activa */
  language: Language;
  /** Altera a variante e persiste em localStorage */
  setLanguage: (lang: Language) => void;
  /**
   * Tradução síncrona via dicionário estático.
   * Em PT-PT devolve o texto intacto.
   * Em PT-BR aplica substituição lexical PT-PT → PT-BR.
   */
  t: (text: string) => string;
  /**
   * Tradução assíncrona via LibreTranslate.
   * Útil para conteúdo dinâmico (ex: mensagens de erro em inglês → PT).
   */
  translateAsync: (text: string, source?: string, target?: string) => Promise<string>;
}

const STORAGE_KEY = 'smarter_hub_language';

const defaultContext: LanguageContextType = {
  language: 'pt-PT',
  setLanguage: () => undefined,
  t: (text) => text,
  translateAsync: async (text) => text,
};

const LanguageContext = createContext<LanguageContextType>(defaultContext);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'pt-BR' ? 'pt-BR' : 'pt-PT';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    if (lang === 'pt-BR') {
      /* Aguarda o React renderizar antes de caminhar o DOM */
      setTimeout(activateBrazilianTranslation, 100);
    } else {
      deactivateBrazilianTranslation();
    }
  }, []);

  /* Ativa na montagem inicial se o idioma guardado for PT-BR */
  useEffect(() => {
    if (language === 'pt-BR') {
      /* Aguarda o React montar todos os componentes */
      const id = setTimeout(activateBrazilianTranslation, 300);
      return () => clearTimeout(id);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = useCallback(
    (text: string): string => {
      if (language === 'pt-PT') return text;
      return translateToBrazilian(text);
    },
    [language],
  );

  const translateAsync = useCallback(
    async (text: string, source = 'en', target = 'pt'): Promise<string> => {
      return translateWithLibreTranslate(text, source, target);
    },
    [],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t, translateAsync }),
    [language, setLanguage, t, translateAsync],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Hook para consumir o contexto de idioma em qualquer componente. */
export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext);
}
