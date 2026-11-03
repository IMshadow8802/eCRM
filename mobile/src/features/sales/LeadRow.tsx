import { memo } from "react";
import { CalendarClock, MapPin, Phone, Users, type LucideIcon } from "lucide-react-native";

import type { FollowUpType, Lead, Lookup } from "../../types/api";
import { colors, metrics } from "../../theme";
import { ListRow, Text } from "../../ui";
import { followUpLine, followUpTypeLabel, leadStatusBadge, parseDate, rupees, shortDay } from "./leadHelpers";

export interface LeadRowProps {
  lead: Lead;
  /** lead_status rows: the G1 rank of an open-coded status picks its badge. */
  statuses: Lookup[];
  onPress: (lead: Lead) => void;
  /** Two-pane: the lead open beside the list (T3). */
  selected?: boolean;
  /** The first row of a group draws no separator. */
  first?: boolean;
}

const LINE_INK = { default: "textSecondary", danger: "dangerText", muted: "textMuted" } as const;

/** G2: the types a row names; "other" and a missing type (DB without 119) read "Follow-up". */
const TYPE_ICON: Partial<Record<FollowUpType, LucideIcon>> = { call: Phone, visit: MapPin, meeting: Users };
const PREFIX = "Follow-up ";

/** "Follow-up tomorrow 11:00 am" → "Call tomorrow 11:00 am" when the next follow-up's type is known. */
function typedLine(lead: Lead, text: string): { text: string; icon: LucideIcon } {
  const type = lead.NextFollowupType;
  const icon = type ? TYPE_ICON[type] : undefined;
  if (!type || !icon || !text.startsWith(PREFIX)) return { text, icon: CalendarClock };
  return { text: `${followUpTypeLabel(type)} ${text.slice(PREFIX.length)}`, icon };
}

/**
 * One lead (E 14): status badge · name and ₹ · company · product with the
 * status pill · the next follow-up (G2). A lost lead reads muted and says why
 * and when instead.
 */
function LeadRowBase({ lead, statuses, onPress, selected = false, first = false }: LeadRowProps) {
  const badge = leadStatusBadge(statuses, lead.StatusCode, lead.StatusId);
  const lost = lead.StatusCode === "lost";
  const value = rupees(lead.EstValue);
  const lostAt = parseDate(lead.LostAt);
  const line = followUpLine(lead);
  const typed = typedLine(lead, line.text);
  const LineIcon = typed.icon;

  return (
    <ListRow
      align="top"
      badge={{ tone: badge.tone, icon: badge.icon, testID: "lead-badge" }}
      title={lead.Name}
      titleTone={lost ? "muted" : "default"}
      right={value ? { amount: value, muted: lost } : undefined}
      meta={[lead.Company, lead.ProductName].filter(Boolean).join(" · ") || undefined}
      chips={[{ label: lead.StatusName ?? "—", tone: badge.chip }]}
      line3={
        lost ? (
          <Text variant="label" color="textMuted" numberOfLines={1}>
            {[lead.LostReason, lostAt ? shortDay(lostAt) : null].filter(Boolean).join(" · ") || "Lost"}
          </Text>
        ) : (
          <>
            <LineIcon size={metrics.iconSm} color={colors[LINE_INK[line.tone]]} />
            <Text variant="label" color={LINE_INK[line.tone]} numberOfLines={1}>
              {typed.text}
            </Text>
          </>
        )
      }
      selected={selected}
      noSeparator={first}
      onPress={() => onPress(lead)}
      testID={`lead-row-${lead.Id}`}
    />
  );
}

export const LeadRow = memo(LeadRowBase);
export default LeadRow;
