import { SettingsControl } from "@/components/settings-control";
import { PageHeader } from "@/components/ui";

export default function SettingsPage() {
  return <><PageHeader title="Settings" description="Configure connector-wide inventory payload defaults and Shopify API behavior." /><SettingsControl /></>;
}
