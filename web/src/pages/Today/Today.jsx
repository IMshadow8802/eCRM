import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { PageHeader, Tabs } from "../../components/ui";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import { useApiQuery } from "../../hooks/useApiQuery";
import { TODAY } from "../../api/todayQueries";
import MyDay from "./MyDay";
import TeamDay from "./TeamDay";

export default function Today() {
  const [params, setParams] = useSearchParams();
  // The team tab exists only when the caller has someone to manage — a count, not the team's day.
  const { data } = useApiQuery({
    queryKey: ["today", "teamSize"],
    endpoint: TODAY.teamSize,
    staleTime: 300000,
    showErrorMessage: false,
  });
  const hasTeam = (data?.count ?? 0) > 0;
  const tab = hasTeam && params.get("tab") === "team" ? "team" : "mine";
  // My team's Day picker portals into the right end of the tab row (no row of its own).
  const [dayTarget, setDayTarget] = useState(null);
  const items = [{ value: "mine", label: "Mine" }, ...(hasTeam ? [{ value: "team", label: "My team" }] : [])];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
      <PageHeader title="Today" actions={<HelpGuide guide={HELP_GUIDES.today} />} />
      {hasTeam && (
        <div style={{ display: "flex", alignItems: "center", gap: "calc(12rem / 15)", flexWrap: "wrap", minWidth: 0 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <Tabs size="sm" value={tab} onChange={(v) => setParams((prev) => { prev.set("tab", v); return prev; })} items={items} data-testid="today-tabs" />
          </div>
          <div ref={setDayTarget} data-testid="today-tabs-end" style={{ marginLeft: "auto" }} />
        </div>
      )}
      {tab === "team" ? <TeamDay dayTarget={dayTarget} /> : <MyDay />}
    </div>
  );
}
