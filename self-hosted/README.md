# i18n-keyless Self-Hosted

The two files a self-hoster downloads: `docker-compose.yml` and `.env.example`. Guide:
<https://docs.i18n-keyless.com/docs/guides/self-hosting>. Buy the licence:
<https://i18n-keyless.com/self-hosted>.

```bash
mkdir i18n-keyless && cd i18n-keyless
curl -fsSL https://raw.githubusercontent.com/arnaudambro/i18n-keyless/main/self-hosted/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/arnaudambro/i18n-keyless/main/self-hosted/.env.example -o .env
# fill LICENSE_KEY and the AI_* lines
docker compose up -d
```

With [ONCE](https://once.com) you need neither file: add the app `ghcr.io/ambroselli-io/i18n-keyless:latest`
in its console. The image's source lives with the service; this public repository only
carries the SDKs and these two files.
