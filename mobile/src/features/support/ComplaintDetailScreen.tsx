import type { StackScreenProps } from "@react-navigation/stack";

import type { RootStackParamList } from "../../navigation/RootNavigator";
import { Screen } from "../../ui";
import { ComplaintDetailBody } from "./ComplaintDetailBody";

type Props = StackScreenProps<RootStackParamList, "ComplaintDetail">;

/** A pushed complaint (E 11). The body is shared with the T2 detail pane. */
export default function ComplaintDetailScreen({ route, navigation }: Props) {
  return (
    <Screen band>
      <ComplaintDetailBody
        ticketId={route.params.ticketId}
        onBack={navigation.goBack}
        onEdit={(ticketId) => navigation.navigate("ComplaintForm", { ticketId })}
        onDeleted={navigation.goBack}
        onOpenTicket={(ticketId) => navigation.push("ComplaintDetail", { ticketId })}
      />
    </Screen>
  );
}
