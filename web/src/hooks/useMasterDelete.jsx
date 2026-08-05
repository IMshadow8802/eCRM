import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";

/**
 * The delete-confirm handler shared by the Master pages (Users, Teams,
 * Projects). All three had the same 30-line block, differing only in the noun.
 *
 * Deliberately NOT built on `useApiMutation`, even though that hook exists and
 * covers most of this. Its error path reports `error.response?.data?.message ||
 * error.message`, so a dropped connection would surface the raw "Network Error"
 * to the user; pinning `errorMessage` instead would suppress the server's own
 * explanation, which is the more useful message when there is one. These pages
 * want both — the server's message when it sent one, a written sentence when it
 * did not — and that is the one shape the hook cannot express. Preserving
 * behaviour beat reusing the abstraction here.
 *
 * The four caches are invalidated together because deleting any one of these
 * entities can change the others: a user leaves their teams, a team drops off
 * its projects, and tasks reference all three.
 */
const MASTER_CACHE_KEYS = [["users"], ["teams"], ["tasks"], ["projects"]];

export function useMasterDelete({ remove, entity }) {
  const queryClient = useQueryClient();
  // useSnackbar(), not the module-level enqueueSnackbar, because that is what
  // the Master pages use — and what their tests mock.
  const { enqueueSnackbar } = useSnackbar();
  const noun = entity.toLowerCase();

  return useCallback(
    async (id) => {
      try {
        const response = await remove({ Id: id });

        if (response.data.success) {
          enqueueSnackbar(`${entity} deleted successfully!`, { variant: "success" });
          MASTER_CACHE_KEYS.forEach((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          );
        } else {
          // The server's reason when it gave one — it is more specific than
          // anything written here ("still has active members", say).
          enqueueSnackbar(response.data.message || `Failed to delete ${noun}!`, {
            variant: "error",
          });
        }
      } catch (error) {
        console.error(`Error deleting ${noun}:`, error);
        enqueueSnackbar(`Failed to delete ${noun}!`, { variant: "error" });
        // Re-thrown so the confirmation dialog stays open. Note the asymmetry,
        // preserved from the original: a REQUEST failure keeps the dialog open,
        // while a server `success: false` closes it. Debatable, but changing it
        // is a UX decision rather than part of this extraction.
        throw error;
      }
    },
    [remove, entity, noun, queryClient, enqueueSnackbar],
  );
}

export default useMasterDelete;
