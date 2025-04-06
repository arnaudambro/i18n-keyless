export const api = {
  fetchTranslations: async (url: string, options: RequestInit) => {
    return fetch(url, options)
      .then((res) => res.json())
      .catch((err) => {
        return { ok: false, error: err.message };
      });
  },
  fetchTranslation: async (url: string, options: RequestInit) => {
    return fetch(url, options)
      .then((res) => res.json())
      .catch((err) => {
        return { ok: false, error: err.message };
      });
  },
};
