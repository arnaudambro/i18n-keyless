import { PassThrough } from "node:stream";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToPipeableStream } from "react-dom/server";
import { createReadableStreamFromReadable } from "@react-router/node";
import { getServerTranslations, runWithI18nKeyless } from "i18n-keyless-react";
import { initI18nServer, langFromRequest } from "./i18n";

await initI18nServer(); // once per server process

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  const lang = langFromRequest(request);

  // Wrap the whole render in the per-request i18n scope: <T> and getTranslation(...) both
  // resolve in `lang`, and each render records the keys it used.
  return getServerTranslations(lang).then(
    (translations) =>
      runWithI18nKeyless({ lang, translations }, () =>
        new Promise<Response>((resolve, reject) => {
          let shellRendered = false;
          const { pipe, abort } = renderToPipeableStream(
            <ServerRouter context={routerContext} url={request.url} />,
            {
              onShellReady() {
                shellRendered = true;
                const body = new PassThrough();
                responseHeaders.set("Content-Type", "text/html");
                resolve(
                  new Response(createReadableStreamFromReadable(body), {
                    headers: responseHeaders,
                    status: responseStatusCode,
                  })
                );
                pipe(body);
              },
              onShellError: reject,
              onError(error) {
                if (shellRendered) console.error(error);
              },
            }
          );
          setTimeout(abort, 10_000);
        })
      )
  );
}
