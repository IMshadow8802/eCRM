import type { StackScreenProps } from "@react-navigation/stack";

import { useActionBar } from "../../navigation/Shell";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { Screen } from "../../ui";
import { LeadDetailBody } from "./LeadDetailBody";

type Props = StackScreenProps<RootStackParamList, "LeadDetail">;

/** A lead pushed on the stack (E 15): its actions are the Shell's action bar, or the band at the rail. */
export default function LeadDetailScreen({ route, navigation }: Props) {
  return (
    <Screen band>
      <LeadDetailBody leadId={route.params.leadId} navigation={navigation} onBack={navigation.goBack} useBar={useActionBar} />
    </Screen>
  );
}
