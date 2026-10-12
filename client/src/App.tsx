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
import { MembersPage } from "@/pages/app/MembersPage";
import { AgentsPage } from "@/pages/app/AgentsPage";
import { SettingsPage } from "@/pages/app/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="tables/:tableId" element={<TableDetailPage />} />
          <Route path="tables/:tableId/automations" element={<TableAutomationsPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
