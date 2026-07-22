"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Building2, GitMerge, History, Menu, Moon, Settings, ShieldCheck, Sun, Tags, X } from "lucide-react";

const sections = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: BarChart3 }] },
  { label: "Catalog", items: [
    { href: "/brands", label: "Brands", icon: Building2 },
    { href: "/mappings", label: "Mappings", icon: GitMerge },
    { href: "/variants", label: "Variant backfill", icon: Tags },
  ] },
  { label: "Operations", items: [
    { href: "/runs", label: "Sync runs", icon: History },
    { href: "/verify", label: "Verify", icon: ShieldCheck },
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ballpro-theme", next);
  }

  const navigation = (
    <>
      <div className="brand-lockup">
        <div className="brand-mark">B</div>
        <div><div className="brand-name">BallPro Inventory</div><div className="brand-subtitle">Connector control plane</div></div>
      </div>
      <nav aria-label="Primary navigation">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="nav-section">{section.label}</div>
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return <Link className={`nav-link ${active ? "active" : ""}`} href={item.href} key={item.href}><Icon size={17} />{item.label}</Link>;
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="theme-row"><span>Appearance</span><button className="icon-btn" onClick={toggleTheme} title={`Use ${theme === "dark" ? "light" : "dark"} theme`} aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button></div>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <div className="mobile-bar">
        <div className="mobile-title"><div className="brand-mark">B</div>BallPro Inventory</div>
        <button className="icon-btn" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close navigation" : "Open navigation"}>{open ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
      <aside className={`sidebar ${open ? "open" : ""}`}>{navigation}</aside>
      <main className="main-shell"><div className="page-wrap">{children}</div></main>
    </div>
  );
}
