import { lazy, Suspense } from "react";
import { Toaster } from "@/components/controls/sonner";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MarketingLayout } from "@/layouts/MarketingLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import { AppShell } from "@/layouts/AppShell";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { HomePage } from "@/pages/HomePage";
import { BlogPage } from "@/pages/BlogPage";
import { BlogPostPage } from "@/pages/BlogPostPage";
import { DocsIndexPage } from "@/pages/docs/DocsIndexPage";
import { DocsArticlePage } from "@/pages/docs/DocsArticlePage";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { InvitePage } from "@/pages/InvitePage";
import { WorkspaceHomePage } from "@/pages/app/WorkspaceHomePage";
import { TablesPage } from "@/pages/app/TablesPage";
import { TableDetailPage } from "@/pages/app/TableDetailPage";
import { TableAutomationsPage } from "@/pages/app/TableAutomationsPage";
import { AutomationsPage } from "@/pages/app/AutomationsPage";
import { AutomationDetailPage } from "@/pages/app/AutomationDetailPage";
const ReportsPage = lazy(() => import("@/pages/app/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const ReportDetailPage = lazy(() => import("@/pages/app/ReportDetailPage").then((module) => ({ default: module.ReportDetailPage })));
import { MembersPage } from "@/pages/app/MembersPage";
import { AgentEditorPage } from "@/pages/app/AgentEditorPage";
import { AgentsPage } from "@/pages/app/AgentsPage";
import { SettingsPage } from "@/pages/app/SettingsPage";
import i18n from "@/i18n";
const SkillsPage = lazy(() => import("@/pages/app/SkillsPage").then((module) => ({ default: module.SkillsPage })));
const SkillDetailPage = lazy(() => import("@/pages/app/SkillDetailPage").then((module) => ({ default: module.SkillDetailPage })));

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="bottom-center" closeButton />
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route index element={<HomePage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPostPage />} />
          <Route path="docs" element={<DocsIndexPage />} />
          <Route path="docs/:slug" element={<DocsArticlePage />} />
        </Route>

        <Route element={<AuthLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
        </Route>

        <Route path="invite/:invitationId" element={<InvitePage />} />

        <Route
          path="app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<WorkspaceHomePage />} />
          <Route path="tables" element={<TablesPage />} />
          <Route path="integrations" element={<Navigate to="/app/settings?tab=agentmail" replace />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="automations/new" element={<AutomationDetailPage />} />
          <Route path="automations/:automationId" element={<AutomationDetailPage />} />
          <Route path="reports" element={<Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{i18n.t("reports:loadingReport")}</p>}><ReportsPage /></Suspense>} />
          <Route path="reports/new" element={<Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{i18n.t("reports:loadingReportEditor")}</p>}><ReportDetailPage /></Suspense>} />
          <Route path="reports/:reportId" element={<Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{i18n.t("reports:loadingReportEditor")}</p>}><ReportDetailPage /></Suspense>} />
          <Route path="tables/:tableId" element={<TableDetailPage />} />
          <Route path="tables/:tableId/automations" element={<TableAutomationsPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/new" element={<AgentEditorPage />} />
          <Route path="agents/:agentId/edit" element={<AgentEditorPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="skills" element={<Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{i18n.t("common:loadingSkills")}</p>}><SkillsPage /></Suspense>} />
          <Route path="skills/:skillId" element={<Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{i18n.t("common:loadingSkillDetail")}</p>}><SkillDetailPage /></Suspense>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
