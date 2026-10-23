import { useEffect } from 'react';

/** Sets the browser tab title while the calling component is mounted, then restores the previous one. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
