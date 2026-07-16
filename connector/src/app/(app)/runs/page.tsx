import { RunsControl } from "@/components/runs-control";
import { SyncLauncher } from "@/components/sync-launcher";
import { PageHeader } from "@/components/ui";

export default function RunsPage() {
  return <><PageHeader title="Sync runs" description="Queue dry runs or live writes and monitor product-level outcomes." actions={<SyncLauncher compact />} /><RunsControl /></>;
}
