import { VerifyControl } from "@/components/verify-control";
import { PageHeader } from "@/components/ui";

export default function VerifyPage() {
  return <><PageHeader title="Verify" description="Compare a product's latest RepSpark inventory against what is actually stored in its Shopify metafield." /><VerifyControl /></>;
}
