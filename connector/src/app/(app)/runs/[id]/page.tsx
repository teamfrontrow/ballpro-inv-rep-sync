import { RunDetail } from "@/components/run-detail";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <RunDetail id={(await params).id} />;
}
