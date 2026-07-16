import { AppShell } from "@/components/app-shell";

export default function ControlPlaneLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
