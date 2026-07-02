import React from "react";
import { Helmet } from "react-helmet-async";
import { Box, Typography, Skeleton } from "@mui/material";
import {
  PeopleOutlined,
  PersonAddAltOutlined,
  EventNoteOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";

import PageHeader from "./PageHeader";
import StatisticsCard from "./StatCard";
import AreaTrend from "./Charts/AreaTrend";
import Donut from "./Charts/Donut";
import Funnel from "./Charts/Funnel";
import RadialGoal from "./Charts/RadialGoal";
import RadialLoad from "./Charts/RadialLoad";
import ActivityBar from "./Charts/ActivityBar";
import SparkBar from "./Charts/SparkBar";
import SparkLine from "./Charts/SparkLine";
import Gauge from "./Charts/Gauge";
import { useApiQuery } from "../hooks/useApiQuery";

const KPI_CONFIG = {
  TotalLeads:      { color: "blue",  icon: PeopleOutlined,        title: "Total Leads" },
  TodayNewLeads:   { color: "green", icon: PersonAddAltOutlined, title: "Today's New Leads" },
  TodayFollowups:  { color: "amber", icon: EventNoteOutlined,    title: "Today's Follow-ups" },
  MissedFollowups: { color: "red",   icon: WarningAmberOutlined, title: "Missed Follow-ups" },
};

/**
 * Bento tile. Sizes driven by CSS grid col/row spans on a 12-col track.
 * `spanCol` / `spanRow` are numbers; they collapse to 12-col on xs so mobile
 * stacks cleanly.
 */
const Tile = ({ children, title, subtitle, spanCol = 4, spanRow = 1 }) => (
  <Box
    sx={{
      gridColumn: { xs: "span 12", md: `span ${spanCol}` },
      gridRow: { xs: "auto", md: `span ${spanRow}` },
      position: "relative",
      borderRadius: 3,
      border: "1px solid",
      borderColor: "divider",
      backgroundColor: "background.paper",
      p: 2,
      display: "flex",
      flexDirection: "column",
      gap: 1,
      overflow: "hidden",
      minHeight: spanRow * 150, // floor so height:100% charts resolve on xs + first mount (recharts needs a definite parent height)
      transition:
        "border-color 240ms cubic-bezier(0.4,0,0.2,1), transform 240ms cubic-bezier(0.4,0,0.2,1)",
      "&:hover": {
        borderColor: "primary.main",
        transform: "translateY(-1px)",
      },
    }}
  >
    {(title || subtitle) && (
      <Box>
        {title && (
          <Typography
            sx={{
              fontSize: "0.8667rem",
              fontWeight: 600,
              color: "text.primary",
            }}
          >
            {title}
          </Typography>
        )}
        {subtitle && (
          <Typography
            sx={{ fontSize: "0.7333rem", color: "text.tertiary", mt: 0.25 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    )}
    <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
  </Box>
);

const Dashboard = () => {
  const { data: dashboardData, isLoading } = useApiQuery({
    queryKey: ["dashboard"],
    endpoint: "/api/reports/getDashboard",
    params: {},
    enabled: true,
  });

  const dashboardStats = dashboardData?.dashboard || [];
  const statBy = (type) =>
    Number(dashboardStats.find((s) => s.Type === type)?.Number) || 0;

  return (
    <Box>
      <Helmet>
        <title>PRD Infotech | Dashboard</title>
      </Helmet>
      <PageHeader
        title="DASHBOARD"
        subtitle="Overview of leads, follow-ups, and team activity"
      />

      {/* KPI row */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
          gap: 1.5,
          mb: 1.5,
        }}
      >
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={76} />
            ))
          : dashboardStats.map((stat) => {
              const config = KPI_CONFIG[stat.Type];
              if (!config) return null;
              const Icon = config.icon;
              return (
                <StatisticsCard
                  key={stat.Type}
                  color={config.color}
                  title={config.title}
                  value={stat.Number?.toLocaleString() || "0"}
                  icon={<Icon fontSize="small" />}
                />
              );
            })}
      </Box>

      {/* Bento grid — 12-col on md+, stacks on xs. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(12, 1fr)" },
          gridAutoRows: { xs: "auto", md: "150px" },
          gap: 1.5,
        }}
      >
        {/* Hero — weekly trend area (recharts). */}
        <Tile
          spanCol={8}
          spanRow={2}
          title="Leads this week"
          subtitle="New leads vs conversions — last 7 days"
        >
          <AreaTrend height={160} />
        </Tile>

        {/* Radial goal — single-number hero. */}
        <Tile spanCol={4} spanRow={2}>
          <RadialGoal
            value={statBy("TodayNewLeads") || 62}
            goal={100}
            label="Today's conversion"
            suffix="%"
            height={170}
          />
        </Tile>

        {/* Traffic sources — donut. */}
        <Tile spanCol={4} spanRow={2} title="Traffic sources">
          <Donut height={240} />
        </Tile>

        {/* Conversion funnel. */}
        <Tile spanCol={4} spanRow={2} title="Conversion funnel">
          <Funnel height={240} />
        </Tile>

        {/* Weekly load — radial bars. */}
        <Tile spanCol={4} spanRow={2} title="Team load">
          <RadialLoad height={240} />
        </Tile>

        {/* Sparkline — follow-ups (line+area with delta). */}
        <Tile spanCol={4} spanRow={1}>
          <SparkLine
            label="Follow-ups this week"
            value={statBy("TodayFollowups") || 47}
            tone="primary"
          />
        </Tile>

        {/* Gauge — missed follow-ups (half-circle alert gauge). */}
        <Tile spanCol={4} spanRow={1}>
          <Gauge
            label="Missed follow-ups"
            value={statBy("MissedFollowups") || 8}
            max={50}
          />
        </Tile>

        {/* Sparkline bar — new leads today (vertical bars). */}
        <Tile spanCol={4} spanRow={1}>
          <SparkBar
            label="New leads today"
            value={statBy("TodayNewLeads") || 26}
            tone="success"
          />
        </Tile>

        {/* Activity bar — quarterly grouped. */}
        <Tile spanCol={12} spanRow={2} title="Quarterly activity">
          <ActivityBar height={260} />
        </Tile>
      </Box>
    </Box>
  );
};

export default Dashboard;
