import React from "react";
import { Helmet } from "react-helmet-async";
import { Box, Stack, Typography, Skeleton } from "@mui/material";
import {
  PeopleOutlined,
  PersonAddAltOutlined,
  EventNoteOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";

import PageHeader from "./PageHeader";
import StatisticsCard from "./StatCard";
import PieChart from "./Charts/PieChart";
import LineChart from "./Charts/LineChart";
import FunnelChart from "./Charts/FunnelChart";
import CircleBarChart from "./Charts/CircleBarChart";
import NightingaleChart from "./Charts/NightangleChart";
import { useApiQuery } from "../hooks/useApiQuery";

const KPI_CONFIG = {
  TotalLeads:      { color: "blue",  icon: PeopleOutlined,        title: "Total Leads" },
  TodayNewLeads:   { color: "green", icon: PersonAddAltOutlined, title: "Today's New Leads" },
  TodayFollowups:  { color: "amber", icon: EventNoteOutlined,    title: "Today's Follow-ups" },
  MissedFollowups: { color: "red",   icon: WarningAmberOutlined, title: "Missed Follow-ups" },
};

const CHART_HEIGHT = 240;

const ChartCard = ({ title, children }) => (
  <Box
    sx={{
      backgroundColor: "background.paper",
      border: "1px solid",
      borderColor: "divider",
      borderRadius: 2,
      p: 1.5,
    }}
  >
    <Typography
      sx={{
        fontSize: "0.8667rem",
        fontWeight: 600,
        color: "text.primary",
        mb: 1,
      }}
    >
      {title}
    </Typography>
    {children}
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

  return (
    <Box>
      <Helmet>
        <title>PRD Infotech | Dashboard</title>
      </Helmet>
      <PageHeader title="DASHBOARD" subtitle="Overview of leads, follow-ups, and team activity" />

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

      {/* Charts grid */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: "repeat(2, 1fr)",
            xl: "repeat(3, 1fr)",
          },
          gap: 1.5,
        }}
      >
        <ChartCard title="Traffic Sources">
          <PieChart height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard title="Quarterly Activity">
          <LineChart height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard title="Conversion Funnel">
          <FunnelChart height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard title="Weekly Load">
          <CircleBarChart height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard title="Category Distribution">
          <NightingaleChart height={CHART_HEIGHT} />
        </ChartCard>
      </Box>
    </Box>
  );
};

export default Dashboard;
