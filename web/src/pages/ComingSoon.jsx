import { ConstructionOutlined } from "@mui/icons-material";

import EmptyState from "../components/ui/EmptyState";

// ponytail: route target for scaffolded-but-unbuilt sections (/sales/*,
// /settings/*). Swap for the real page component once its task lands —
// don't build the real UI here, that's later tasks' job.
const ComingSoon = ({ title }) => (
  <EmptyState
    icon={<ConstructionOutlined fontSize="inherit" />}
    title={title}
    description="This section is under construction."
  />
);

export default ComingSoon;
