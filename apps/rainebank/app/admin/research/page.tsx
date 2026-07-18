/**
 * /admin/research/page.tsx
 *
 * Research panel under the admin layout — same auth guard as deposits/withdrawals
 * is handled by app/admin/layout.tsx, so no extra RBAC needed here.
 */
import ResearchClient from '../../(vault)/research/ResearchClient';

export default function AdminResearchPage() {
  return <ResearchClient />;
}
