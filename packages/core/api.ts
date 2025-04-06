export const api = {
  fetchTranslation: async (url: string, options: RequestInit) => {
    return fetch(url, options)
      .then((res) => res.json())
      .catch((err) => {
        return { ok: false, error: err.message };
      });
  },
  fetchTranslationsForOneLanguage: async (url: string, options: RequestInit) => {
    return fetch(url, options)
      .then((res) => res.json())
      .catch((err) => {
        return { ok: false, error: err.message };
      });
  },
  fetchAllTranslationsForAllLanguages: async (url: string, options: RequestInit) => {
    return fetch(url, options)
      .then((res) => res.json())
      .catch((err) => {
        return { ok: false, error: err.message };
      });
  },
};
