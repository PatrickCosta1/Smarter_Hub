import { useEffect, useState } from 'react';

export type FeedbackTone = 'success' | 'error' | 'info';

type FeedbackToastState = {
  tone: FeedbackTone;
  message: string;
  visible: boolean;
};

const DEFAULT_TIMEOUT_MS = 3200;

export function useFeedbackToast(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [toast, setToast] = useState<FeedbackToastState>({
    tone: 'info',
    message: '',
    visible: false,
  });

  useEffect(() => {
    if (!toast.visible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
    }, timeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [toast.visible, timeoutMs]);

  function showToast(tone: FeedbackTone, message: string) {
    setToast({ tone, message, visible: true });
  }

  function hideToast() {
    setToast((current) => ({ ...current, visible: false }));
  }

  return {
    toast,
    showToast,
    hideToast,
  };
}
