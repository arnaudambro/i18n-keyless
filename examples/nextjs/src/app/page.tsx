import { redirect } from "next/navigation";
import { PRIMARY } from "../i18n";

// Send the bare root to the primary language.
export default function RootPage() {
  redirect(`/${PRIMARY}`);
}
