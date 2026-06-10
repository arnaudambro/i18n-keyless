import http from "node:http";
import { renderPage, langFromUrl } from "./render";

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  try {
    const html = await renderPage(langFromUrl(req.url ?? "/"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  } catch (error) {
    console.error(error);
    res.writeHead(500).end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`i18n-keyless node example on http://localhost:${PORT}  (try /?lang=en)`);
});
