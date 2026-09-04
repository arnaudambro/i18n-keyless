import { T } from "i18n-keyless-react";
import { HomeContent } from "../../components/HomeContent";

// Server component. <T> is rendered here directly: i18n-keyless-react ships the
// "use client" directive (>= 3.6.1), so a Server Component can hand it to the client
// boundary without re-exporting it from a client module of your own.
export default function Page() {
  return (
    <>
      <p className="muted">
        <T>Ce paragraphe est rendu par un composant serveur.</T>
      </p>
      <HomeContent />
    </>
  );
}
