import { MappingsControl } from "@/components/mappings-control";
import { PageHeader } from "@/components/ui";

export default function MappingsPage() {
  return <><PageHeader title="Product mappings" description="Reconcile Shopify products to one or more RepSpark style numbers." /><MappingsControl /></>;
}
