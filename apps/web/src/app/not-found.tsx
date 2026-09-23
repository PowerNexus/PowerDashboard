import { Button, EmptyState } from "@gamedashboard/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <EmptyState
        icon={<SearchX />}
        title={t("title")}
        description={t("description")}
        action={
          <Button asChild>
            <Link href="/">{t("home")}</Link>
          </Button>
        }
      />
    </div>
  );
}
