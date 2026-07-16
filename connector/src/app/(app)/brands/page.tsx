import { BrandsControl } from "@/components/brands-control";
import { PageHeader } from "@/components/ui";

export default function BrandsPage() {
  return <><PageHeader title="Brands" description="Enable inventory publishing and set optional per-brand quantity caps." /><BrandsControl /></>;
}
